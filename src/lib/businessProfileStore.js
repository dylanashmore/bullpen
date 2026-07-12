import { redis, isPersistent, parseStored } from './persistence.js';

// A single global record — this app has no per-user/multi-tenant concept
// (one shared agent roster), so there's exactly one business profile, not a
// collection. Captured once during the mandatory onboarding flow
// (BusinessOnboarding) and editable afterward from the agents page, so it
// stays around instead of being discarded the moment the starting team is
// created. Intended to be readable by the orchestrator/task-suggestion side
// too (business context relevant to routing decisions), not just the UI.
const KEY = 'bullpen:business-profile';

let memoryProfile = null;

export async function getBusinessProfile() {
  if (isPersistent) {
    const raw = await redis.get(KEY);
    return raw ? parseStored(raw) : null;
  }
  return memoryProfile;
}

// Partial update — only the given fields change; term defaults to the
// existing value (or 'short') if never set. Creates the record on first call.
export async function saveBusinessProfile(fields) {
  const current = await getBusinessProfile();
  const profile = {
    description: fields.description ?? current?.description ?? '',
    goal: fields.goal ?? current?.goal ?? '',
    term: fields.term ?? current?.term ?? 'short',
    updatedAt: new Date().toISOString(),
  };
  if (isPersistent) {
    await redis.set(KEY, JSON.stringify(profile));
  } else {
    memoryProfile = profile;
  }
  return profile;
}
