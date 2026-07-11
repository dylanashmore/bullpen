import { getAllAgents, getAgentById } from './agents/agentStore.js';
import { askOrchestrator, runAgentPrompt } from './lib/geminiClient.js';
import { generateImage } from './lib/imagenClient.js';

// Asks Gemini which agent(s) a task needs, then expands that set to include
// any upstream agents implied by dependsOnAgent chains (e.g. the model calls
// only "artist", but artist depends on designer which depends on writer —
// both get pulled in automatically so the pipeline actually has inputs).
export async function pickChainForTask(input, agents = getAllAgents()) {
  const calls = await askOrchestrator(input, agents);
  const calledIds = [...new Set(calls.map((c) => c.name))].filter((id) => getAgentById(id));

  if (calledIds.length === 0) {
    throw new Error('Orchestrator did not select any agent for this task');
  }

  const chainIds = new Set();
  const addWithAncestors = (id) => {
    if (chainIds.has(id)) return;
    const agent = getAgentById(id);
    if (!agent) return;
    if (agent.dependsOnAgent) addWithAncestors(agent.dependsOnAgent);
    chainIds.add(id);
  };
  calledIds.forEach(addWithAncestors);

  return [...chainIds].map((id) => getAgentById(id));
}

// Executes a task's agent chain, mutating `task` in place as steps progress
// so GET /api/tasks reflects live status. Agents with no unmet dependency run
// together via Promise.all (parallel); dependents wait for their upstream
// agent's output before becoming "ready".
//
// fileBuffer is the raw bytes of an optional task attachment (task.file holds
// its {name, mimeType}). It's only ever handed to root agents (no
// dependsOnAgent — the ones that receive the raw task input) that opted in
// via acceptsFiles; every other agent runs exactly as it did before files
// existed. The buffer lives only for this call and is never persisted.
export async function runChain(task, fileBuffer) {
  task.status = 'working';

  let chainAgents;
  try {
    chainAgents = await pickChainForTask(task.input);
  } catch (err) {
    task.status = 'error';
    task.error = err.message;
    return;
  }

  if (fileBuffer && task.file) {
    const canUseFile = chainAgents.some((agent) => !agent.dependsOnAgent && agent.acceptsFiles);
    if (!canUseFile) {
      task.fileWarning = `Attached file "${task.file.name}" was not used — no agent in this task's chain accepts file uploads.`;
    }
  }

  task.steps = chainAgents.map((agent) => ({ agentId: agent.id, status: 'pending', output: null }));
  const byId = new Map(chainAgents.map((agent) => [agent.id, agent]));
  const outputs = new Map();
  const remaining = new Set(chainAgents.map((agent) => agent.id));

  while (remaining.size > 0) {
    const readyIds = [...remaining].filter((id) => {
      const agent = byId.get(id);
      return !agent.dependsOnAgent || outputs.has(agent.dependsOnAgent);
    });

    if (readyIds.length === 0) {
      task.status = 'error';
      task.error = 'Dependency cycle detected while resolving agent chain';
      return;
    }

    await Promise.all(
      readyIds.map(async (id) => {
        const agent = byId.get(id);
        const step = task.steps.find((s) => s.agentId === id);
        step.status = 'working';
        agent.status = 'working';
        try {
          const stepInput = agent.dependsOnAgent ? outputs.get(agent.dependsOnAgent) : task.input;
          const stepFile = !agent.dependsOnAgent && agent.acceptsFiles && fileBuffer && task.file
            ? { buffer: fileBuffer, mimeType: task.file.mimeType, name: task.file.name }
            : undefined;
          const output = agent.outputType === 'image'
            ? await generateImage(stepInput)
            : await runAgentPrompt(agent, stepInput, stepFile);
          outputs.set(id, output);
          step.output = output;
          step.status = 'done';
        } catch (err) {
          step.status = 'error';
          step.output = err.message;
          task.status = 'error';
          task.error = `Agent "${id}" failed: ${err.message}`;
        } finally {
          agent.status = 'idle';
          remaining.delete(id);
        }
      })
    );

    if (task.status === 'error') return;
  }

  task.status = 'done';
}
