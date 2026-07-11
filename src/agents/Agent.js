const VALID_OUTPUT_TYPES = new Set(['text', 'image', 'structured', 'feedback']);
import { DEFAULT_AGENT_MODEL } from '../lib/models.js';

export class Agent {
  constructor({
    id,
    name,
    role,
    inputType,
    outputType,
    dependsOnAgent = null,
    tone = null,
    status = 'idle',
    acceptsFiles = false,
    specialty = null,
    directive = null,
    model = DEFAULT_AGENT_MODEL,
    style = null,
    inspiredBy = null,
    context = null,
  }) {
    if (!VALID_OUTPUT_TYPES.has(outputType)) {
      throw new Error(`Invalid outputType "${outputType}". Must be one of: ${[...VALID_OUTPUT_TYPES].join(', ')}`);
    }
    this.id = id;
    this.name = name;
    this.role = role;
    this.inputType = inputType;
    this.outputType = outputType;
    this.dependsOnAgent = dependsOnAgent;
    this.tone = tone;
    this.status = status;
    this.acceptsFiles = acceptsFiles;
    this.specialty = specialty;
    this.directive = directive || role;
    this.model = model;
    this.style = style;
    this.inspiredBy = inspiredBy;
    this.context = context;
  }

  buildSystemPrompt() {
    const lines = [
      `You are ${this.name}, a specialist AI agent.`,
      `Your role: ${this.role}`,
    ];
    if (this.context) {
      lines.push(`Background context: ${this.context}`);
    }
    if (this.tone) {
      lines.push(`Tone: ${this.tone}.`);
    }
    if (this.style) {
      lines.push(`Style: ${this.style}.`);
    }
    if (this.inspiredBy) {
      lines.push(`Draw inspiration from: ${this.inspiredBy}. Do not copy protected work exactly; use it only as high-level creative direction.`);
    }
    lines.push(`You receive input of type "${this.inputType}" and must produce output of type "${this.outputType}".`);
    lines.push('Respond with only the requested output itself — no preamble, no meta-commentary about what you are doing.');
    return lines.join('\n');
  }

  // Gemini FunctionDeclaration used by the orchestrator to route tasks to this agent.
  toFunctionDeclaration() {
    return {
      name: this.id,
      description: `${this.role}${
        this.dependsOnAgent
          ? ` This agent requires the output of the "${this.dependsOnAgent}" agent as its input — call it as part of a pipeline, not standalone.`
          : ''
      }`,
      parametersJsonSchema: {
        type: 'object',
        properties: {
          input: {
            type: 'string',
            description: `The ${this.inputType} to hand to ${this.name}.`,
          },
        },
        required: ['input'],
      },
    };
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      role: this.role,
      inputType: this.inputType,
      outputType: this.outputType,
      dependsOnAgent: this.dependsOnAgent,
      tone: this.tone,
      status: this.status,
      acceptsFiles: this.acceptsFiles,
      specialty: this.specialty,
      directive: this.directive,
      model: this.model,
      style: this.style,
      inspiredBy: this.inspiredBy,
      context: this.context,
    };
  }
}
