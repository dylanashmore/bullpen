import app from '../src/app.js';

// Vercel maps every /api/* request to this catch-all function. Express keeps
// the original request path, so the same routers work locally and in production.
export default app;
