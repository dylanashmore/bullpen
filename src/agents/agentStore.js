import { randomUUID } from 'node:crypto';
import { Agent } from './Agent.js';
import { DEFAULT_AGENT_MODEL } from '../lib/models.js';
import { redis, isPersistent, parseStored } from '../lib/persistence.js';

// In-memory fallback used when no KV/Upstash database is linked (e.g. local
// dev). When isPersistent is true this Map is unused — every read/write goes
// through Redis instead so state survives across serverless instances.
const memoryAgents = new Map();

const agentKey = (id) => `bullpen:agent:${id}`;
const INDEX_KEY = 'bullpen:agent:index';

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function idExists(id) {
  if (isPersistent) return Boolean(await redis.get(agentKey(id)));
  return memoryAgents.has(id);
}

async function uniqueId(candidate) {
  if (!candidate || (await idExists(candidate))) {
    let id = candidate || randomUUID();
    let suffix = 2;
    while (await idExists(id)) {
      id = `${candidate}_${suffix}`;
      suffix += 1;
    }
    return id;
  }
  return candidate;
}

// explicitId lets seeding assign stable, readable ids (e.g. "writer") that
// dependsOnAgent references and function-call routing rely on.
export async function addAgent(
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
    context = null,
  },
  explicitId
) {
  const id = await uniqueId(explicitId || slugify(name));
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
    context,
  });
  if (isPersistent) {
    await redis.set(agentKey(id), JSON.stringify(agent.toJSON()));
    await redis.rpush(INDEX_KEY, id);
  } else {
    memoryAgents.set(id, agent);
  }
  return agent;
}

// Writes back a mutated agent (e.g. after changing .model/.status). Required
// under Redis mode since getAgentById() returns a fresh deserialized copy,
// not a live reference — mutating it alone doesn't persist the change.
export async function saveAgent(agent) {
  if (isPersistent) {
    await redis.set(agentKey(agent.id), JSON.stringify(agent.toJSON()));
  } else {
    memoryAgents.set(agent.id, agent);
  }
}

export async function getAllAgents() {
  if (isPersistent) {
    const ids = await redis.lrange(INDEX_KEY, 0, -1);
    if (ids.length === 0) return [];
    const raw = await redis.mget(...ids.map(agentKey));
    return raw.filter(Boolean).map((value) => new Agent(parseStored(value)));
  }
  return [...memoryAgents.values()];
}

export async function getAgentById(id) {
  if (isPersistent) {
    const raw = await redis.get(agentKey(id));
    if (!raw) return undefined;
    return new Agent(parseStored(raw));
  }
  return memoryAgents.get(id);
}

export async function removeAgent(id) {
  const dependent = (await getAllAgents()).find((agent) => agent.dependsOnAgent === id);
  if (dependent) {
    throw new Error(`Agent is required by "${dependent.name}" and cannot be removed`);
  }
  if (isPersistent) {
    await redis.del(agentKey(id));
    await redis.lrem(INDEX_KEY, 0, id);
    return true;
  }
  return memoryAgents.delete(id);
}
