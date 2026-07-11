import { Router } from 'express';
import { addAgent, getAgentById, getAllAgents } from '../agents/agentStore.js';
import { enrichStyleReference } from '../lib/enrichStyle.js';

const router = Router();

const VALID_OUTPUT_TYPES = ['text', 'image', 'structured', 'feedback'];
const REQUIRED_FIELDS = ['name', 'role', 'inputType', 'outputType'];

router.get('/', (req, res) => {
  res.json(getAllAgents().map((agent) => agent.toJSON()));
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

  if (body.dependsOnAgent && !getAgentById(body.dependsOnAgent)) {
    return res.status(400).json({ error: `dependsOnAgent "${body.dependsOnAgent}" does not match an existing agent id` });
  }

  if (body.acceptsFiles !== undefined && typeof body.acceptsFiles !== 'boolean') {
    return res.status(400).json({ error: 'acceptsFiles must be a boolean' });
  }

  if (body.styleReference !== undefined && body.styleReference !== null && typeof body.styleReference !== 'string') {
    return res.status(400).json({ error: 'styleReference must be a string' });
  }

  // Enrichment is fail-safe by design (enrichStyleReference never throws) —
  // any failure or unrecognized input just resolves to null, same as if the
  // field had been left blank. Never blocks agent creation.
  const styleReference = await enrichStyleReference(body.styleReference);

  try {
    const agent = addAgent({
      name: body.name,
      role: body.role,
      inputType: body.inputType,
      outputType: body.outputType,
      dependsOnAgent: body.dependsOnAgent ?? null,
      tone: body.tone ?? null,
      acceptsFiles: body.acceptsFiles ?? false,
      styleReference,
    });
    res.status(201).json(agent.toJSON());
  } catch (err) {
    res.status(500).json({ error: 'Failed to create agent', detail: err.message });
  }
});

export default router;
