const ACTIVE_STATUSES = new Set(['pending', 'working']);

function summarizeOutput(output) {
  if (typeof output !== 'string') return null;
  if (output.startsWith('data:image/')) return '[Generated image]';
  return output.slice(0, 700);
}

function summarizeTask(task, includeOutputs = false) {
  const summary = { input: String(task.input || '').slice(0, 2000) };
  if (includeOutputs) {
    summary.outcomes = (task.steps || [])
      .map((step) => ({ agentId: step.agentId, output: summarizeOutput(step.output) }))
      .filter((step) => step.output);
    summary.outcomes = summary.outcomes.slice(0, 5);
  }
  return summary;
}

export function buildTaskSuggestionContext({ profile, agents, tasks }) {
  return {
    business: profile
      ? { description: profile.description, goal: profile.goal, term: profile.term }
      : null,
    agentRoster: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      specialty: agent.specialty,
      role: String(agent.role || '').slice(0, 1000),
      context: String(agent.context || '').slice(0, 1000),
    })),
    activeTasks: tasks
      .filter((task) => ACTIVE_STATUSES.has(task.status))
      .slice(0, 10)
      .map((task) => summarizeTask(task)),
    completedTasks: tasks
      .filter((task) => task.status === 'done')
      .slice(0, 10)
      .map((task) => summarizeTask(task, true)),
  };
}
