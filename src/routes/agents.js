import { Router } from 'express';
import { addAgent, getAgentById, getAllAgents, removeAgent, saveAgent } from '../agents/agentStore.js';
import { DEFAULT_AGENT_MODEL, isSupportedAgentModel, SUPPORTED_AGENT_MODELS } from '../lib/models.js';
import { suggestContextFromFeedback, draftTeamForBusiness } from '../lib/geminiClient.js';

const router = Router();

// 'image' retired 2026-07-11 — no more dedicated image-output agents; every
// agent can generate an image dynamically when a task calls for one (see
// needsImage/imagePrompt in geminiClient.js's runAgentPromptPhase).
const VALID_OUTPUT_TYPES = ['text', 'structured', 'feedback'];
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

// Suggestion-only: never creates anything. Powers the mandatory "describe
// your business" onboarding flow shown on an empty roster — the frontend
// reviews/edits the drafted team and creates whichever agents it keeps
// through the normal POST /api/agents path, one at a time.
router.post('/draft-team', async (req, res) => {
  try {
    const description = req.body?.description;
    const goal = req.body?.goal;
    const term = req.body?.term;
    if (!description || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ error: 'description is required and must be a non-empty string' });
    }
    if (!goal || typeof goal !== 'string' || !goal.trim()) {
      return res.status(400).json({ error: 'goal is required and must be a non-empty string' });
    }
    if (term !== 'short' && term !== 'long') {
      return res.status(400).json({ error: 'term must be either "short" or "long"' });
    }

    const draft = await draftTeamForBusiness({ description: description.trim(), goal: goal.trim(), term });
    res.json({ draft });
  } catch (err) {
    res.status(500).json({ error: 'Failed to draft a team', detail: err.message });
  }
});

// Walks dependsOnAgent pointers upward from candidateDependsOn; true if agentId
// is reached, meaning pointing agentId at candidateDependsOn would close a loop.
async function wouldCreateCycle(agentId, candidateDependsOn) {
  let currentId = candidateDependsOn;
  const seen = new Set();
  while (currentId) {
    if (currentId === agentId) return true;
    if (seen.has(currentId)) return false; // pre-existing cycle elsewhere; not this edit's problem
    seen.add(currentId);
    const current = await getAgentById(currentId);
    currentId = current?.dependsOnAgent ?? null;
  }
  return false;
}

router.patch('/:id', async (req, res) => {
  try {
    const agent = await getAgentById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const body = req.body ?? {};
    let changed = false;

    const requireNonEmptyString = (field, label) => {
      if (typeof body[field] !== 'string' || !body[field].trim()) {
        res.status(400).json({ error: `${label} must be a non-empty string` });
        return null;
      }
      return body[field].trim();
    };
    const requireOptionalString = (field, label) => {
      if (body[field] !== null && typeof body[field] !== 'string') {
        res.status(400).json({ error: `${label} must be a string or null` });
        return undefined;
      }
      return body[field]?.trim() || null;
    };

    if (body.model !== undefined) {
      if (!isSupportedAgentModel(body.model)) {
        return res.status(400).json({ error: `model must be one of: ${SUPPORTED_AGENT_MODELS.join(', ')}` });
      }
      agent.model = body.model;
      changed = true;
    }

    if (body.name !== undefined) {
      const name = requireNonEmptyString('name', 'name');
      if (name === null) return;
      agent.name = name;
      changed = true;
    }

    if (body.directive !== undefined) {
      const directive = requireNonEmptyString('directive', 'directive');
      if (directive === null) return;
      agent.directive = directive;
      agent.role = directive;
      changed = true;
    }

    if (body.specialty !== undefined) {
      const specialty = requireNonEmptyString('specialty', 'specialty');
      if (specialty === null) return;
      agent.specialty = specialty;
      changed = true;
    }

    if (body.inputType !== undefined) {
      const inputType = requireNonEmptyString('inputType', 'inputType');
      if (inputType === null) return;
      agent.inputType = inputType;
      changed = true;
    }

    if (body.outputType !== undefined) {
      if (!VALID_OUTPUT_TYPES.includes(body.outputType)) {
        return res.status(400).json({ error: `outputType must be one of: ${VALID_OUTPUT_TYPES.join(', ')}` });
      }
      agent.outputType = body.outputType;
      changed = true;
    }

    if (body.tone !== undefined) {
      const tone = requireOptionalString('tone', 'tone');
      if (tone === undefined) return;
      agent.tone = tone;
      changed = true;
    }

    if (body.style !== undefined) {
      const style = requireOptionalString('style', 'style');
      if (style === undefined) return;
      agent.style = style;
      changed = true;
    }

    if (body.inspiredBy !== undefined) {
      const inspiredBy = requireOptionalString('inspiredBy', 'inspiredBy');
      if (inspiredBy === undefined) return;
      agent.inspiredBy = inspiredBy;
      changed = true;
    }

    if (body.acceptsFiles !== undefined) {
      if (typeof body.acceptsFiles !== 'boolean') {
        return res.status(400).json({ error: 'acceptsFiles must be a boolean' });
      }
      agent.acceptsFiles = body.acceptsFiles;
      changed = true;
    }

    if (body.dependsOnAgent !== undefined) {
      const nextDependsOnAgent = body.dependsOnAgent || null;
      if (nextDependsOnAgent) {
        if (nextDependsOnAgent === agent.id) {
          return res.status(400).json({ error: 'An agent cannot depend on itself' });
        }
        if (!(await getAgentById(nextDependsOnAgent))) {
          return res.status(400).json({ error: `dependsOnAgent "${nextDependsOnAgent}" does not match an existing agent id` });
        }
        if (await wouldCreateCycle(agent.id, nextDependsOnAgent)) {
          return res.status(400).json({ error: `Setting dependsOnAgent to "${nextDependsOnAgent}" would create a dependency cycle` });
        }
      }
      agent.dependsOnAgent = nextDependsOnAgent;
      changed = true;
    }

    if (body.context !== undefined) {
      const context = requireOptionalString('context', 'context');
      if (context === undefined) return;
      // Only log an actual value change — re-saving the same context (e.g.
      // submitting the setup form with nothing touched) shouldn't grow the
      // history. `feedback`, if present, is purely a history tag: it's what
      // the frontend sends when applying a feedback-drafted suggestion (see
      // StepFeedback's apply flow) so this entry can be told apart from a
      // manual edit in AgentSetupSummary, which sends context alone.
      if (context !== agent.context) {
        const feedback = typeof body.feedback === 'string' && body.feedback.trim() ? body.feedback.trim() : null;
        agent.contextHistory = [
          ...(agent.contextHistory || []),
          {
            timestamp: new Date().toISOString(),
            previousContext: agent.context,
            newContext: context,
            source: feedback ? 'feedback' : 'manual',
            feedback,
          },
        ];
      }
      agent.context = context;
      changed = true;
    }

    if (!changed) return res.status(400).json({ error: 'Provide at least one field to update' });

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
