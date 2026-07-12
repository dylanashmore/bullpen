import express from 'express';
import cors from 'cors';
import agentsRouter from './routes/agents.js';
import tasksRouter from './routes/tasks.js';
import optimizeRouter from './routes/optimize.js';
import businessRouter from './routes/business.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/agents', agentsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/optimize', optimizeRouter);
app.use('/api/business-profile', businessRouter);

const healthHandler = (req, res) => res.json({
  ok: true,
  geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
});

app.get('/api/health', healthHandler);
app.get('/health', healthHandler);

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

export default app;
