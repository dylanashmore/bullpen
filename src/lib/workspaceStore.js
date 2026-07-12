import { redis, isPersistent, parseStored } from './persistence.js';

const PROFILE_KEY = 'bullpen:workspace:profile';
let memoryProfile = null;

export async function getWorkspaceProfile() {
  if (isPersistent) {
    const raw = await redis.get(PROFILE_KEY);
    return raw ? parseStored(raw) : null;
  }
  return memoryProfile;
}

export async function saveWorkspaceProfile({ description, goal, term }) {
  const profile = {
    description,
    goal,
    term,
    updatedAt: new Date().toISOString(),
  };
  if (isPersistent) {
    await redis.set(PROFILE_KEY, JSON.stringify(profile));
  } else {
    memoryProfile = profile;
  }
  return profile;
}
