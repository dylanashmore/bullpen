import { Router } from 'express';
import { getBusinessProfile, saveBusinessProfile } from '../lib/businessProfileStore.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    res.json(await getBusinessProfile());
  } catch (err) {
    res.status(500).json({ error: 'Failed to load business profile', detail: err.message });
  }
});

// Partial update — at least one field required. Upserts: works whether or
// not a profile exists yet (first call, e.g. right after onboarding creates
// the starting team, creates the record).
router.patch('/', async (req, res) => {
  try {
    const body = req.body ?? {};
    const fields = {};
    for (const key of ['description', 'goal', 'term']) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== 'string' || !body[key].trim()) {
        return res.status(400).json({ error: `${key} must be a non-empty string` });
      }
      fields[key] = body[key].trim();
    }
    if (fields.term !== undefined && fields.term !== 'short' && fields.term !== 'long') {
      return res.status(400).json({ error: 'term must be either "short" or "long"' });
    }
    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: 'Provide at least one of: description, goal, term' });
    }
    res.json(await saveBusinessProfile(fields));
  } catch (err) {
    res.status(500).json({ error: 'Failed to save business profile', detail: err.message });
  }
});

export default router;
