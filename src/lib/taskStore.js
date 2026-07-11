import { randomUUID } from 'node:crypto';
import { redis, isPersistent, parseStored } from './persistence.js';

// In-memory fallback used when no KV/Upstash database is linked (e.g. local
// dev). When isPersistent is true this array is unused.
const memoryTasks = [];

const taskKey = (id) => `bullpen:task:${id}`;
const INDEX_KEY = 'bullpen:task:index';

// file: { name, mimeType } | null — metadata only, for display. The raw upload
// bytes are passed directly into runChain() and never stored here (or anywhere
// persistent) — they live only for the duration of that task's execution.
export async function createTask(input, file = null, assignedAgentId = null) {
  const task = {
    id: randomUUID(),
    input,
    status: 'pending', // pending | working | done | error
    steps: [],
    createdAt: new Date().toISOString(),
    file,
    assignedAgentId,
    cancelRequested: false,
  };
  if (isPersistent) {
    await redis.set(taskKey(task.id), JSON.stringify(task));
    await redis.lpush(INDEX_KEY, task.id); // newest first, matches GET /api/tasks contract
  } else {
    memoryTasks.unshift(task);
  }
  return task;
}

// Writes back a mutated task (status/step changes). Required under Redis
// mode since getTaskById() returns a fresh deserialized copy each time, not
// a live reference — mutating it alone doesn't persist the change.
export async function saveTask(task) {
  if (isPersistent) {
    await redis.set(taskKey(task.id), JSON.stringify(task));
  }
  // memory mode: `task` is already the live object sitting in memoryTasks.
}

export async function getAllTasks() {
  if (isPersistent) {
    const ids = await redis.lrange(INDEX_KEY, 0, -1);
    if (ids.length === 0) return [];
    const raw = await redis.mget(...ids.map(taskKey));
    return raw.filter(Boolean).map(parseStored);
  }
  return memoryTasks;
}

export async function getTaskById(id) {
  if (isPersistent) {
    const raw = await redis.get(taskKey(id));
    return raw ? parseStored(raw) : undefined;
  }
  return memoryTasks.find((t) => t.id === id);
}
