import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import agentsRouter from './routes/agents.js';
import tasksRouter from './routes/tasks.js';
import { seedDefaultAgents } from './agents/agentStore.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/agents', agentsRouter);
app.use('/api/tasks', tasksRouter);

app.get('/health', (req, res) => res.json({ ok: true }));

// Catches malformed JSON bodies (from express.json()) and any error thrown
// synchronously in a route handler, so a bad request never crashes the server.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON in request body' });
  }
  if (err.name === 'MulterError') {
    return res.status(400).json({ error: `File upload error: ${err.message}` });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

seedDefaultAgents();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bullpen backend listening on http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn('WARNING: GEMINI_API_KEY is not set — agent and orchestrator calls will fail. See .env.example.');
  }
});
