import { randomUUID } from 'node:crypto';

const tasks = [];

// file: { name, mimeType } | null — metadata only, for display. The raw upload
// bytes are passed directly into runChain() and never stored here (or anywhere
// persistent) — they live only for the duration of that task's execution.
export function createTask(input, file = null) {
  const task = {
    id: randomUUID(),
    input,
    status: 'pending', // pending | working | done | error
    steps: [],
    createdAt: new Date().toISOString(),
    file,
  };
  tasks.unshift(task); // newest first, matches GET /api/tasks contract
  return task;
}

export function getAllTasks() {
  return tasks;
}

export function getTaskById(id) {
  return tasks.find((t) => t.id === id);
}
