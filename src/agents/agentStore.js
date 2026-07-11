import { randomUUID } from 'node:crypto';
import { Agent } from './Agent.js';

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
// styleReference here is the already-resolved final value (an enriched
// summary or null) — enrichment of raw user input happens in the route layer
// before this is called, keeping this function a plain synchronous data write.
export function addAgent(
  { name, role, inputType, outputType, dependsOnAgent = null, tone = null, acceptsFiles = false, styleReference = null },
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
    styleReference,
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

export function seedDefaultAgents() {
  if (agents.size > 0) return;

  addAgent(
    {
      name: 'Researcher',
      role: 'Gathers background facts, context, and key points on a topic so other agents can build on solid information.',
      inputType: 'topic',
      outputType: 'text',
      dependsOnAgent: null,
      tone: 'thorough and neutral',
      acceptsFiles: true,
    },
    'researcher'
  );

  addAgent(
    {
      name: 'Writer',
      role: 'Writes clear, well-structured prose (copy, posts, articles) from a topic.',
      inputType: 'topic',
      outputType: 'text',
      dependsOnAgent: null,
      tone: 'engaging and clear',
    },
    'writer'
  );

  addAgent(
    {
      name: 'Designer',
      role: 'Turns written copy into a detailed visual design brief describing composition, style, mood, and color for an image.',
      inputType: 'agent_output',
      outputType: 'text',
      dependsOnAgent: 'writer',
      tone: 'visually descriptive',
    },
    'designer'
  );

  addAgent(
    {
      name: 'Artist',
      role: 'Generates a final image from a visual design brief.',
      inputType: 'agent_output',
      outputType: 'image',
      dependsOnAgent: 'designer',
      tone: null,
    },
    'artist'
  );
}
