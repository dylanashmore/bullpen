import app from '../../../../../src/app.js';

// Vercel does not consistently dispatch multi-segment URLs through the
// top-level api/[...path].js function. Keep an explicit function entrypoint
// for /api/tasks/:id/steps/:agentId/iterate so it reaches the shared Express app.
export default app;
