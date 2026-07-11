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
  deleteAgent: (id) => request(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getTasks: () => request("/api/tasks"),
  cancelTask: (id) => request(`/api/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  createTask: ({ input, file, agentId = null }) => {
    if (file) {
      const body = new FormData();
      body.append("input", input);
      body.append("file", file);
      if (agentId) body.append("agentId", agentId);
      return request("/api/tasks", { method: "POST", body });
    }
    return request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input, ...(agentId ? { agentId } : {}) }),
    });
  },
};
