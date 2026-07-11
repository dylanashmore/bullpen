import { Router } from 'express';
import { addAgent, getAgentById, getAllAgents, removeAgent, saveAgent } from '../agents/agentStore.js';
import { DEFAULT_AGENT_MODEL, isSupportedAgentModel, SUPPORTED_AGENT_MODELS } from '../lib/models.js';
import { suggestContextFromFeedback } from '../lib/geminiClient.js';

const router = Router();

const VALID_OUTPUT_TYPES = ['text', 'image', 'structured', 'feedback'];
const REQUIRED_FIELDS = ['name', 'role', 'inputType', 'outputType'];

router.get('/', async (req, res) => {
  try {
    const agents = await getAllAgents();
    res.json(agents.map((agent) => agent.toJSON()));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load agents', detail: err.message });
  }
});

router.post('/', async (req, res) => {
  const body = req.body ?? {};
  const missing = REQUIRED_FIELDS.filter((field) => !body[field] || typeof body[field] !== 'string');
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing or invalid required field(s): ${missing.join(', ')}` });
  }

  if (!VALID_OUTPUT_TYPES.includes(body.outputType)) {
    return res.status(400).json({ error: `outputType must be one of: ${VALID_OUTPUT_TYPES.join(', ')}` });
  }

  if (body.acceptsFiles !== undefined && typeof body.acceptsFiles !== 'boolean') {
    return res.status(400).json({ error: 'acceptsFiles must be a boolean' });
  }

  if (body.model !== undefined && !isSupportedAgentModel(body.model)) {
    return res.status(400).json({ error: `model must be one of: ${SUPPORTED_AGENT_MODELS.join(', ')}` });
  }

  try {
    if (body.dependsOnAgent && !(await getAgentById(body.dependsOnAgent))) {
      return res.status(400).json({ error: `dependsOnAgent "${body.dependsOnAgent}" does not match an existing agent id` });
    }

    const agent = await addAgent({
      name: body.name,
      role: body.role,
      inputType: body.inputType,
      outputType: body.outputType,
      dependsOnAgent: body.dependsOnAgent ?? null,
      tone: body.tone ?? null,
      acceptsFiles: body.acceptsFiles ?? false,
      specialty: body.specialty ?? null,
      directive: body.directive ?? body.role,
      model: body.model ?? DEFAULT_AGENT_MODEL,
      style: body.style ?? null,
      inspiredBy: body.inspiredBy ?? null,
      context: body.context ?? null,
    });
    res.status(201).json(agent.toJSON());
  } catch (err) {
    res.status(500).json({ error: 'Failed to create agent', detail: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const agent = await getAgentById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const body = req.body ?? {};
    let changed = false;

    if (body.model !== undefined) {
      if (!isSupportedAgentModel(body.model)) {
        return res.status(400).json({ error: `model must be one of: ${SUPPORTED_AGENT_MODELS.join(', ')}` });
      }
      agent.model = body.model;
      changed = true;
    }

    if (body.directive !== undefined) {
      if (typeof body.directive !== 'string' || !body.directive.trim()) {
        return res.status(400).json({ error: 'directive must be a non-empty string' });
      }
      agent.directive = body.directive.trim();
      agent.role = body.directive.trim();
      changed = true;
    }

    if (body.specialty !== undefined) {
      if (typeof body.specialty !== 'string' || !body.specialty.trim()) {
        return res.status(400).json({ error: 'specialty must be a non-empty string' });
      }
      agent.specialty = body.specialty.trim();
      changed = true;
    }

    if (body.context !== undefined) {
      if (body.context !== null && typeof body.context !== 'string') {
        return res.status(400).json({ error: 'context must be a string or null' });
      }
      agent.context = typeof body.context === 'string' ? body.context.trim() || null : null;
      changed = true;
    }

    if (!changed) return res.status(400).json({ error: 'Provide model, directive, specialty, or context to update' });

    await saveAgent(agent);
    res.json(agent.toJSON());
  } catch (err) {
    res.status(500).json({ error: 'Failed to update agent', detail: err.message });
  }
});

// Suggestion-only: never writes to the agent. The caller reviews the
// suggested context and, if they want it, applies it themselves via the
// existing PATCH /:id (body { context }) — this endpoint just drafts it.
router.post('/:id/feedback', async (req, res) => {
  try {
    const agent = await getAgentById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const feedback = req.body?.feedback;
    if (!feedback || typeof feedback !== 'string' || !feedback.trim()) {
      return res.status(400).json({ error: 'feedback is required and must be a non-empty string' });
    }
    const taskInput = typeof req.body?.taskInput === 'string' ? req.body.taskInput : undefined;
    const stepOutput = typeof req.body?.stepOutput === 'string' ? req.body.stepOutput : undefined;

    const suggestedContext = await suggestContextFromFeedback(agent, { feedback: feedback.trim(), taskInput, stepOutput });
    res.json({ suggestedContext });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate context suggestion', detail: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  let agent;
  try {
    agent = await getAgentById(req.params.id);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to look up agent', detail: err.message });
  }
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  try {
    await removeAgent(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

export default router;
