const API_BASE_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const OFFLINE_MESSAGE = import.meta.env.DEV
  ? "Cannot reach the Bullpen backend. Start it with npm run dev."
  : "The Bullpen service is temporarily unavailable. Please try again shortly.";

export class ApiError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, options);
  } catch {
    throw new ApiError(OFFLINE_MESSAGE);
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    throw new ApiError(payload?.error || `Request failed with status ${response.status}`, response.status, payload);
  }
  return payload;
}

export const api = {
  health: () => request("/api/health"),
  getAgents: () => request("/api/agents"),
  createAgent: (agent) => request("/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(agent),
  }),
  updateAgentModel: (id, model) => request(`/api/agents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  }),
  updateAgentInstructions: (id, directive) => request(`/api/agents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ directive }),
  }),
  // Generic multi-field update — used by the full agent setup editor.
  updateAgent: (id, fields) => request(`/api/agents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  }),
  // feedback, if passed, is purely a history tag — it's what lets the backend
  // log this context change as "from feedback" (with the original feedback
  // text) rather than "manual edit" in the agent's contextHistory.
  updateAgentContext: (id, context, feedback) => request(`/api/agents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context, ...(feedback ? { feedback } : {}) }),
  }),
  // Drafts a suggested context update from feedback on a completed step —
  // does not persist anything; pair with updateAgentContext to apply it.
  suggestContextFromFeedback: (id, { feedback, taskInput, stepOutput }) => request(`/api/agents/${encodeURIComponent(id)}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedback, taskInput, stepOutput }),
  }),
  // Drafts a starting team from a business description/goal/term — does not
  // create anything; pair with createAgent (once per kept row) to apply it.
  draftTeamForBusiness: ({ description, goal, term }) => request("/api/agents/draft-team", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, goal, term }),
  }),
  // The business description/goal/term captured during onboarding — a single
  // global record, persisted so it's still around after the starting team is
  // created (previously discarded the moment BusinessOnboarding unmounted),
  // and readable server-side by POST /api/tasks/suggestions. Both return
  // { profile }, not the profile directly.
  getWorkspaceProfile: () => request("/api/workspace"),
  saveWorkspaceProfile: ({ description, goal, term }) => request("/api/workspace", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, goal, term }),
  }),
  deleteAgent: (id) => request(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  optimizeText: (text, kind) => request("/api/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, kind }),
  }),
  getTasks: () => request("/api/tasks"),
  suggestTasks: () => request("/api/tasks/suggestions", { method: "POST" }),
  cancelTask: (id) => request(`/api/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  deleteTask: (id) => request(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // Re-runs one already-completed step with extra guidance, replacing its
  // output in place — distinct from suggestContextFromFeedback, which is
  // about the agent's durable memory, not this task's result.
  iterateStep: (taskId, agentId, details) => request(`/api/tasks/${encodeURIComponent(taskId)}/steps/${encodeURIComponent(agentId)}/iterate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ details }),
  }),
  createTask: ({ input, file, agentId = null, executionMode = "fast" }) => {
    if (file) {
      const body = new FormData();
      body.append("input", input);
      body.append("file", file);
      body.append("executionMode", executionMode);
      if (agentId) body.append("agentId", agentId);
      return request("/api/tasks", { method: "POST", body });
    }
    return request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input, executionMode, ...(agentId ? { agentId } : {}) }),
    });
  },
};
