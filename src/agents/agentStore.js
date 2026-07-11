import { randomUUID } from 'node:crypto';
import { Agent } from './Agent.js';
import { DEFAULT_AGENT_MODEL } from '../lib/models.js';

const agents = new Map();

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function uniqueId(candidate) {
  if (!candidate || agents.has(candidate)) {
    let id = candidate || randomUUID();
    let suffix = 2;
    while (agents.has(id)) {
      id = `${candidate}_${suffix}`;
      suffix += 1;
    }
    return id;
  }
  return candidate;
}

// explicitId lets seeding assign stable, readable ids (e.g. "writer") that
// dependsOnAgent references and function-call routing rely on.
export function addAgent(
  {
    name,
    role,
    inputType,
    outputType,
    dependsOnAgent = null,
    tone = null,
    acceptsFiles = false,
    specialty = null,
    directive = null,
    model = DEFAULT_AGENT_MODEL,
    style = null,
    inspiredBy = null,
  },
  explicitId
) {
  const id = uniqueId(explicitId || slugify(name));
  const agent = new Agent({
    id,
    name,
    role,
    inputType,
    outputType,
    dependsOnAgent,
    tone,
    status: 'idle',
    acceptsFiles,
    specialty,
    directive,
    model,
    style,
    inspiredBy,
  });
  agents.set(id, agent);
  return agent;
}

export function getAllAgents() {
  return [...agents.values()];
}

export function getAgentById(id) {
  return agents.get(id);
}

export function removeAgent(id) {
  const dependent = getAllAgents().find((agent) => agent.dependsOnAgent === id);
  if (dependent) {
    throw new Error(`Agent is required by "${dependent.name}" and cannot be removed`);
  }
  return agents.delete(id);
}
