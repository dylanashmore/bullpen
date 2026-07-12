import { Router } from 'express';
import multer from 'multer';
import { createTask, getAllTasks, getTaskById, saveTask, removeTask } from '../lib/taskStore.js';
import { runChain, runAgentStepOnce } from '../orchestrator.js';
import { getAgentById, getAllAgents, saveAgent } from '../agents/agentStore.js';
import { DEFAULT_EXECUTION_MODE, EXECUTION_MODES, isExecutionMode } from '../lib/executionModes.js';
import { getWorkspaceProfile } from '../lib/workspaceStore.js';
import { buildTaskSuggestionContext } from '../lib/taskSuggestions.js';
import { suggestTasksForWorkspace } from '../lib/geminiClient.js';

const router = Router();

// Memory storage: the upload never touches disk. multer no-ops (leaves
// req.file/req.body untouched beyond field parsing) for non-multipart
// requests, so plain `Content-Type: application/json` requests are unaffected.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

router.get('/', async (req, res) => {
  try {
    res.json(await getAllTasks());
  } catch (err) {
    res.status(500).json({ error: 'Failed to load tasks', detail: err.message });
  }
});

router.post('/suggestions', async (req, res) => {
  try {
    const [profile, agents, tasks] = await Promise.all([
      getWorkspaceProfile(),
      getAllAgents(),
      getAllTasks(),
    ]);
    if (!profile && agents.length === 0 && tasks.length === 0) {
      return res.status(400).json({ error: 'Add business details, agents, or completed tasks before requesting suggestions' });
    }
    const context = buildTaskSuggestionContext({ profile, agents, tasks });
    const suggestions = await suggestTasksForWorkspace(context);
    res.json({ suggestions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to suggest tasks', detail: err.message });
  }
});

router.post('/:id/cancel', async (req, res) => {
  try {
    const task = await getTaskById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.status === 'done' || task.status === 'error' || task.status === 'cancelled') {
      return res.json(task);
    }

    task.cancelRequested = true;
    task.status = 'cancelled';
    await Promise.all(task.steps.map(async (step) => {
      if (step.status === 'pending' || step.status === 'working') step.status = 'cancelled';
      const agent = await getAgentById(step.agentId);
      if (agent) {
        agent.status = 'idle';
        await saveAgent(agent);
      }
    }));
    await saveTask(task);
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel task', detail: err.message });
  }
});

// Deletes a task's record outright (unlike /cancel, which just stops it and
// keeps it in the feed). Allowed at any status — if a chain is still running
// in the background for a task deleted mid-execution, its next saveTask()
// call will re-write the record (same class of caveat as the fire-and-forget
// runChain risk noted in api/[...path].js); harmless in practice since the
// frontend won't be polling for an id it no longer has locally.
router.delete('/:id', async (req, res) => {
  try {
    const task = await getTaskById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    await removeTask(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete task', detail: err.message });
  }
});

// Re-runs one already-completed step with extra user guidance folded into its
// original input, replacing its output in place — distinct from the
// feedback→context flow (POST /api/agents/:id/feedback), which is about
// updating the agent's durable memory for *future* tasks. This is about
// improving *this* task's result right now. Blocking (like optimizeText/
// suggestContextFromFeedback), not fire-and-forget like task creation — but
// step.phase is still written back after every phase via runAgentStepOnce's
// onPhase, so the independent GET /api/tasks poll shows live progress even
// while this request is still in flight.
router.post('/:id/steps/:agentId/iterate', async (req, res) => {
  try {
    const task = await getTaskById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const step = task.steps?.find((s) => s.agentId === req.params.agentId);
    if (!step) return res.status(404).json({ error: 'Step not found on this task' });
    if (step.status !== 'done') {
      return res.status(400).json({ error: 'Only a completed step can be iterated on' });
    }

    const details = req.body?.details;
    if (!details || typeof details !== 'string' || !details.trim()) {
      return res.status(400).json({ error: 'details is required and must be a non-empty string' });
    }

    const agent = await getAgentById(req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    // Steps don't store their own input — reconstruct it the same way runChain
    // resolves it: a root agent's input is the task's own input, a dependent
    // agent's input is whatever its upstream step produced.
    const baseInput = agent.dependsOnAgent
      ? task.steps.find((s) => s.agentId === agent.dependsOnAgent)?.output
      : task.input;
    const previousOutputText = typeof step.output === 'string' && !step.output.startsWith('data:image/')
      ? step.output
      : null;
    const iterationInput = previousOutputText
      ? `${baseInput}\n\nYou already produced this response:\n"""${previousOutputText}"""\n\nThe user wants it ` +
        `improved with this additional guidance:\n${details.trim()}\n\nProduce a new, improved version that ` +
        'incorporates this guidance.'
      : `${baseInput}\n\nAdditional guidance to incorporate:\n${details.trim()}`;

    const originalOutput = step.output;
    const originalPhase = step.phase;
    step.status = 'working';
    step.phase = 'Revising';
    await saveTask(task);
    agent.status = 'working';
    await saveAgent(agent);

    try {
      const { output, phase } = await runAgentStepOnce(agent, iterationInput, {
        executionMode: task.executionMode,
        onPhase: async (label) => {
          step.phase = label;
          await saveTask(task);
        },
      });
      // Logged only on success — a failed iteration leaves the step exactly
      // as it was (see the catch block below), so there's nothing to record.
      // previousOutput is null when the prior output was an image (computed
      // above as previousOutputText) rather than the raw data: URI — the
      // frontend renders that as "(was an image)"; repeating a full base64
      // image on every iteration would bloat the task record for no benefit.
      step.iterations = [
        ...(step.iterations || []),
        { timestamp: new Date().toISOString(), details: details.trim(), previousOutput: previousOutputText },
      ];
      step.output = output;
      step.phase = phase;
      step.status = 'done';
      await saveTask(task);
      res.json(task);
    } catch (err) {
      step.output = originalOutput;
      step.phase = originalPhase;
      step.status = 'done';
      await saveTask(task);
      res.status(500).json({ error: 'Failed to iterate on step', detail: err.message });
    } finally {
      agent.status = 'idle';
      await saveAgent(agent);
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to iterate on step', detail: err.message });
  }
});

router.post('/', upload.single('file'), async (req, res) => {
  try {
    const input = req.body?.input;
    if (!input || typeof input !== 'string' || !input.trim()) {
      return res.status(400).json({ error: 'input is required and must be a non-empty string' });
    }

    const assignedAgentId = req.body?.agentId || null;
    if (assignedAgentId && !(await getAgentById(assignedAgentId))) {
      return res.status(400).json({ error: `agentId "${assignedAgentId}" does not match an existing agent` });
    }

    const executionMode = req.body?.executionMode || DEFAULT_EXECUTION_MODE;
    if (!isExecutionMode(executionMode)) {
      return res.status(400).json({ error: `executionMode must be one of: ${EXECUTION_MODES.join(', ')}` });
    }

    const fileMeta = req.file ? { name: req.file.originalname, mimeType: req.file.mimetype } : null;
    const task = await createTask(input.trim(), fileMeta, assignedAgentId, executionMode);
    res.status(201).json(task);

    // Execution continues async; frontend polls GET /api/tasks for progress.
    // req.file.buffer (if present) is handed off here and never stored elsewhere.
    runChain(task, req.file?.buffer, assignedAgentId).catch(async (err) => {
      task.status = 'error';
      task.error = err.message;
      await saveTask(task);
      console.error(`Task ${task.id} failed unexpectedly:`, err);
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create task', detail: err.message });
  }
});

export default router;
