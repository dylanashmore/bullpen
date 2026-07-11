import { Router } from 'express';
import multer from 'multer';
import { createTask, getAllTasks, getTaskById } from '../lib/taskStore.js';
import { runChain } from '../orchestrator.js';
import { getAgentById } from '../agents/agentStore.js';

const router = Router();

// Memory storage: the upload never touches disk. multer no-ops (leaves
// req.file/req.body untouched beyond field parsing) for non-multipart
// requests, so plain `Content-Type: application/json` requests are unaffected.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

router.get('/', (req, res) => {
  res.json(getAllTasks());
});

router.post('/:id/cancel', (req, res) => {
  const task = getTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status === 'done' || task.status === 'error' || task.status === 'cancelled') {
    return res.json(task);
  }

  task.cancelRequested = true;
  task.status = 'cancelled';
  task.steps.forEach((step) => {
    if (step.status === 'pending' || step.status === 'working') step.status = 'cancelled';
    const agent = getAgentById(step.agentId);
    if (agent) agent.status = 'idle';
  });
  res.json(task);
});

router.post('/', upload.single('file'), (req, res) => {
  const input = req.body?.input;
  if (!input || typeof input !== 'string' || !input.trim()) {
    return res.status(400).json({ error: 'input is required and must be a non-empty string' });
  }

  const assignedAgentId = req.body?.agentId || null;
  if (assignedAgentId && !getAgentById(assignedAgentId)) {
    return res.status(400).json({ error: `agentId "${assignedAgentId}" does not match an existing agent` });
  }

  const fileMeta = req.file ? { name: req.file.originalname, mimeType: req.file.mimetype } : null;
  const task = createTask(input.trim(), fileMeta, assignedAgentId);
  res.status(201).json(task);

  // Execution continues async; frontend polls GET /api/tasks for progress.
  // req.file.buffer (if present) is handed off here and never stored elsewhere.
  runChain(task, req.file?.buffer, assignedAgentId).catch((err) => {
    task.status = 'error';
    task.error = err.message;
    console.error(`Task ${task.id} failed unexpectedly:`, err);
  });
});

export default router;
