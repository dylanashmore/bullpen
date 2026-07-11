import { Router } from 'express';
import { addAgent, getAgentById, getAllAgents, removeAgent } from '../agents/agentStore.js';
import { DEFAULT_AGENT_MODEL, isSupportedAgentModel, SUPPORTED_AGENT_MODELS } from '../lib/models.js';

const router = Router();

const VALID_OUTPUT_TYPES = ['text', 'image', 'structured', 'feedback'];
const REQUIRED_FIELDS = ['name', 'role', 'inputType', 'outputType'];

router.get('/', (req, res) => {
  res.json(getAllAgents().map((agent) => agent.toJSON()));
});

router.post('/', (req, res) => {
  const body = req.body ?? {};
  const missing = REQUIRED_FIELDS.filter((field) => !body[field] || typeof body[field] !== 'string');
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing or invalid required field(s): ${missing.join(', ')}` });
  }

  if (!VALID_OUTPUT_TYPES.includes(body.outputType)) {
    return res.status(400).json({ error: `outputType must be one of: ${VALID_OUTPUT_TYPES.join(', ')}` });
  }

  if (body.dependsOnAgent && !getAgentById(body.dependsOnAgent)) {
    return res.status(400).json({ error: `dependsOnAgent "${body.dependsOnAgent}" does not match an existing agent id` });
  }

  if (body.acceptsFiles !== undefined && typeof body.acceptsFiles !== 'boolean') {
    return res.status(400).json({ error: 'acceptsFiles must be a boolean' });
  }

  if (body.model !== undefined && !isSupportedAgentModel(body.model)) {
    return res.status(400).json({ error: `model must be one of: ${SUPPORTED_AGENT_MODELS.join(', ')}` });
  }

  try {
    const agent = addAgent({
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
    });
    res.status(201).json(agent.toJSON());
  } catch (err) {
    res.status(500).json({ error: 'Failed to create agent', detail: err.message });
  }
});

router.patch('/:id', (req, res) => {
  const agent = getAgentById(req.params.id);
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

  if (!changed) return res.status(400).json({ error: 'Provide model, directive, or specialty to update' });
  res.json(agent.toJSON());
});

router.delete('/:id', (req, res) => {
  if (!getAgentById(req.params.id)) return res.status(404).json({ error: 'Agent not found' });
  try {
    removeAgent(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

export default router;
