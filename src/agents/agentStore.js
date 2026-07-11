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
      specialty: 'Research',
      directive: 'Gather trustworthy background facts, context, and key points.',
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
      specialty: 'Writing',
      directive: 'Write clear, well-structured copy, posts, and articles.',
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
      specialty: 'Design',
      directive: 'Turn written copy into a detailed visual design brief.',
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
      specialty: 'Image generation',
      directive: 'Generate a final image from a visual design brief.',
    },
    'artist'
  );
}
