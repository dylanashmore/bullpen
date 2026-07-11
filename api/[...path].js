import app from '../src/app.js';

// Handles the one-segment API endpoints (/api/health, /api/agents, etc.).
// Nested endpoint shapes have explicit files under api/ because Vercel's Vite
// route manifest treats this catch-all as a single path segment.
export default app;
