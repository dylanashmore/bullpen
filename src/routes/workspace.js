import { Router } from 'express';
import { getWorkspaceProfile, saveWorkspaceProfile } from '../lib/workspaceStore.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    res.json({ profile: await getWorkspaceProfile() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load workspace profile', detail: err.message });
  }
});

router.put('/', async (req, res) => {
  const { description, goal, term } = req.body ?? {};
  if (!description || typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'description is required and must be a non-empty string' });
  }
  if (description.trim().length > 2000) {
    return res.status(400).json({ error: 'description must be 2000 characters or fewer' });
  }
  if (!goal || typeof goal !== 'string' || !goal.trim()) {
    return res.status(400).json({ error: 'goal is required and must be a non-empty string' });
  }
  if (goal.trim().length > 2000) {
    return res.status(400).json({ error: 'goal must be 2000 characters or fewer' });
  }
  if (term !== 'short' && term !== 'long') {
    return res.status(400).json({ error: 'term must be either "short" or "long"' });
  }

  try {
    const profile = await saveWorkspaceProfile({
      description: description.trim(),
      goal: goal.trim(),
      term,
    });
    res.json({ profile });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save workspace profile', detail: err.message });
  }
});

export default router;
