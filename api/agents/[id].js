import app from '../../src/app.js';

// Vercel does not consistently dispatch multi-segment URLs through the
// top-level api/[...path].js function. Keep an explicit function entrypoint
// for /api/agents/:id so PATCH and DELETE reach the shared Express app.
export default app;
