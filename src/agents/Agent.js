const VALID_OUTPUT_TYPES = new Set(['text', 'image', 'structured', 'feedback']);

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
  }

  buildSystemPrompt() {
    const lines = [
      `You are ${this.name}, a specialist AI agent.`,
      `Your role: ${this.role}`,
    ];
    if (this.tone) {
      lines.push(`Tone: ${this.tone}.`);
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
    };
  }
}
