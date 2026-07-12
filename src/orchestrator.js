import { getAllAgents, getAgentById, saveAgent } from './agents/agentStore.js';
import { getTaskById, saveTask } from './lib/taskStore.js';
import { askOrchestrator, runAgentPromptPhase } from './lib/geminiClient.js';
import { generateImage } from './lib/imagenClient.js';
import { DEFAULT_EXECUTION_MODE } from './lib/executionModes.js';

// Fast mode makes one specialist call; Thorough retains the original two-pass
// gather/refine flow. Either way, an agent's final phase can still flag
// needsImage to produce a generated image instead of text — see
// runAgentPromptPhase in geminiClient.js and the needsImage branch below.
const TEXT_AGENT_PHASES = { fast: 1, thorough: 2 };

export function getTextAgentPhaseCount(executionMode) {
  return TEXT_AGENT_PHASES[executionMode] || TEXT_AGENT_PHASES.fast;
}

// Under a persistent store, `task` here and the object POST /api/tasks/:id/cancel
// fetches are two separate deserialized copies of the same record — so
// cancellation can't be read off the local `task` object. Re-fetch the
// canonical flag from the store instead.
async function isCancelled(taskId) {
  const fresh = await getTaskById(taskId);
  return Boolean(fresh?.cancelRequested);
}

// Asks Gemini which agent(s) a task needs, then expands that set to include
// any upstream agents implied by dependsOnAgent chains (e.g. the model calls
// only "artist", but artist depends on designer which depends on writer —
// both get pulled in automatically so the pipeline actually has inputs).
export async function pickChainForTask(input, agents = null) {
  const resolvedAgents = agents ?? (await getAllAgents());
  const calls = await askOrchestrator(input, resolvedAgents);
  const uniqueNames = [...new Set(calls.map((c) => c.name))];
  const existing = await Promise.all(uniqueNames.map(async (id) => ((await getAgentById(id)) ? id : null)));
  const calledIds = existing.filter(Boolean);

  if (calledIds.length === 0) {
    throw new Error('Orchestrator did not select any agent for this task');
  }

  return resolveAgentChain(calledIds);
}

// Builds a dependency-complete chain from one or more explicit agent ids.
// This is also used when the frontend assigns a task directly to one worker.
export async function resolveAgentChain(agentIds) {
  const chainIds = [];
  const seen = new Set();
  async function addWithAncestors(id) {
    if (seen.has(id)) return;
    const agent = await getAgentById(id);
    if (!agent) return;
    if (agent.dependsOnAgent) await addWithAncestors(agent.dependsOnAgent);
    seen.add(id);
    chainIds.push(id);
  }
  for (const id of agentIds) {
    await addWithAncestors(id);
  }

  const resolved = await Promise.all(chainIds.map((id) => getAgentById(id)));
  return resolved.filter(Boolean);
}

// Executes a task's agent chain, mutating `task` in place as steps progress
// and writing back to the store after every transition so GET /api/tasks
// (and a concurrent cancel request) see live status. Agents with no unmet
// dependency run together via Promise.all (parallel); dependents wait for
// their upstream agent's output before becoming "ready".
//
// fileBuffer is the raw bytes of an optional task attachment (task.file holds
// its {name, mimeType}). It's only ever handed to root agents (no
// dependsOnAgent — the ones that receive the raw task input) that opted in
// via acceptsFiles; every other agent runs exactly as it did before files
// existed. The buffer lives only for this call and is never persisted.
export async function runChain(task, fileBuffer, assignedAgentId = null) {
  task.status = 'working';
  task.executionMode = task.executionMode || DEFAULT_EXECUTION_MODE;
  await saveTask(task);

  let chainAgents;
  try {
    chainAgents = assignedAgentId
      ? await resolveAgentChain([assignedAgentId])
      : await pickChainForTask(task.input);
  } catch (err) {
    task.status = 'error';
    task.error = err.message;
    await saveTask(task);
    return;
  }

  if (await isCancelled(task.id)) return;

  if (fileBuffer && task.file) {
    const canUseFile = chainAgents.some((agent) => !agent.dependsOnAgent && agent.acceptsFiles);
    if (!canUseFile) {
      task.fileWarning = `Attached file "${task.file.name}" was not used — no agent in this task's chain accepts file uploads.`;
    }
  }

  task.steps = chainAgents.map((agent) => ({ agentId: agent.id, status: 'pending', output: null }));
  await saveTask(task);

  const byId = new Map(chainAgents.map((agent) => [agent.id, agent]));
  const outputs = new Map();
  const remaining = new Set(chainAgents.map((agent) => agent.id));

  const cancelRemaining = async () => {
    for (const id of remaining) {
      const step = task.steps.find((item) => item.agentId === id);
      if (step && step.status !== 'done' && step.status !== 'error') step.status = 'cancelled';
      const agent = byId.get(id);
      if (agent) {
        agent.status = 'idle';
        await saveAgent(agent);
      }
    }
    await saveTask(task);
  };

  while (remaining.size > 0) {
    if (await isCancelled(task.id)) {
      await cancelRemaining();
      return;
    }
    const readyIds = [...remaining].filter((id) => {
      const agent = byId.get(id);
      return !agent.dependsOnAgent || outputs.has(agent.dependsOnAgent);
    });

    if (readyIds.length === 0) {
      task.status = 'error';
      task.error = 'Dependency cycle detected while resolving agent chain';
      await saveTask(task);
      return;
    }

    await Promise.all(
      readyIds.map(async (id) => {
        const agent = byId.get(id);
        const step = task.steps.find((s) => s.agentId === id);
        if (await isCancelled(task.id)) {
          step.status = 'cancelled';
          remaining.delete(id);
          return;
        }
        step.status = 'working';
        step.phase = task.executionMode === 'fast' ? 'Generating' : undefined;
        agent.status = 'working';
        await saveTask(task);
        await saveAgent(agent);
        try {
          const stepInput = agent.dependsOnAgent ? outputs.get(agent.dependsOnAgent) : task.input;
          const stepFile = !agent.dependsOnAgent && agent.acceptsFiles && fileBuffer && task.file
            ? { buffer: fileBuffer, mimeType: task.file.mimeType, name: task.file.name }
            : undefined;

          const totalPhases = getTextAgentPhaseCount(task.executionMode);
          let previousContent;
          let needsImage = false;
          let imagePrompt;
          for (let phaseNumber = 1; phaseNumber <= totalPhases; phaseNumber += 1) {
            const result = await runAgentPromptPhase(agent, {
              input: stepInput,
              phaseNumber,
              totalPhases,
              previousContent,
              file: phaseNumber === 1 ? stepFile : undefined,
              executionMode: task.executionMode,
            });
            step.phase = result.phase;
            await saveTask(task);
            previousContent = result.content;
            needsImage = result.needsImage;
            imagePrompt = result.imagePrompt;
            if (phaseNumber < totalPhases && (await isCancelled(task.id))) {
              step.status = 'cancelled';
              return;
            }
          }

          // No more dedicated "image" outputType — any agent's final phase can
          // flag needsImage when Gemini itself judges the task calls for a
          // generated image rather than text, and the platform generates it here.
          let output;
          if (needsImage) {
            step.phase = 'Generating image';
            await saveTask(task);
            output = await generateImage(imagePrompt || previousContent);
          } else {
            output = previousContent;
          }

          if (await isCancelled(task.id)) {
            step.status = 'cancelled';
            return;
          }
          outputs.set(id, output);
          step.output = output;
          step.status = 'done';
        } catch (err) {
          if (await isCancelled(task.id)) {
            step.status = 'cancelled';
          } else {
            step.status = 'error';
            step.output = err.message;
            task.status = 'error';
            task.error = `Agent "${id}" failed: ${err.message}`;
          }
        } finally {
          agent.status = 'idle';
          remaining.delete(id);
          await saveTask(task);
          await saveAgent(agent);
        }
      })
    );

    if (await isCancelled(task.id)) {
      await cancelRemaining();
      return;
    }
    if (task.status === 'error') return;
  }

  if (!(await isCancelled(task.id))) {
    task.status = 'done';
    await saveTask(task);
  }
}
