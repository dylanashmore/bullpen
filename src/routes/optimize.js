import { Router } from 'express';
import { optimizeText } from '../lib/geminiClient.js';

const router = Router();

const VALID_KINDS = ['agent_directive', 'task_input', 'business_context'];

// Powers every "Optimize with Gemini" button in the app — agent-creation/
// instructions/context forms, the task dialog, step feedback and iteration,
// and the business profile (description/goal) — rewrites the given text in
// place, no preview step.
router.post('/', async (req, res) => {
  const { text, kind } = req.body ?? {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required and must be a non-empty string' });
  }
  if (kind !== undefined && !VALID_KINDS.includes(kind)) {
    return res.status(400).json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` });
  }

  try {
    const optimized = await optimizeText(text.trim(), kind);
    res.json({ optimized });
  } catch (err) {
    res.status(500).json({ error: 'Failed to optimize text', detail: err.message });
  }
});

export default router;
