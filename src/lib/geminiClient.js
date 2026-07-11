import { GoogleGenAI, FunctionCallingConfigMode, createUserContent, createPartFromUri } from '@google/genai';
import { DEFAULT_AGENT_MODEL } from './models.js';

// Not slider-controlled (unlike per-agent calls, which use agent.model) —
// see the comment in src/lib/models.js on why this is gemini-3.5-flash now.
const ORCHESTRATOR_MODEL = 'gemini-3.5-flash';
const CONTEXT_SUGGESTION_MODEL = 'gemini-3.5-flash';
const AGENT_DRAFT_MODEL = 'gemini-3.5-flash';

// Escape hatch offered to the orchestrator alongside real agent functions —
// lets it admit nothing fits instead of being forced into a poor match.
const NO_SUITABLE_AGENT_FUNCTION = {
  name: 'no_suitable_agent',
  description:
    'Call this INSTEAD of any other function if none of the available specialist agents are ' +
    'actually a good fit for this task. Do not force a poor match just to call something.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Brief explanation of what kind of specialist is needed that does not exist in the current roster.',
      },
    },
    required: ['reason'],
  },
};

const FILE_PROCESSING_TIMEOUT_MS = 30_000;
const FILE_PROCESSING_POLL_INTERVAL_MS = 1500;

let client = null;

function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set. Add it to your .env file.');
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Uploads a file to the Gemini Files API and waits for it to leave the
// PROCESSING state so it's safe to reference in a generateContent call.
async function uploadFileAndWaitUntilActive({ buffer, mimeType, name }) {
  const client = getClient();
  let file = await client.files.upload({
    file: new Blob([buffer], { type: mimeType }),
    config: { mimeType, displayName: name },
  });

  const deadline = Date.now() + FILE_PROCESSING_TIMEOUT_MS;
  while (file.state === 'PROCESSING') {
    if (Date.now() > deadline) {
      throw new Error(`file "${name}" did not finish processing within ${FILE_PROCESSING_TIMEOUT_MS}ms`);
    }
    await sleep(FILE_PROCESSING_POLL_INTERVAL_MS);
    file = await client.files.get({ name: file.name });
  }

  if (file.state !== 'ACTIVE') {
    throw new Error(`file "${name}" failed to process (state: ${file.state})`);
  }

  return file;
}

// Runs a single specialist agent's prompt and returns its raw text output.
// `file`, if provided, is { buffer, mimeType, name } — the raw upload for a
// task attachment. Only agents with acceptsFiles get one; the plain-text path
// below is unchanged for every other call.
export async function runAgentPrompt(agent, inputText, file) {
  try {
    const contents = file
      ? createUserContent([createPartFromUri((await uploadFileAndWaitUntilActive(file)).uri, file.mimeType), inputText])
      : inputText;

    const response = await getClient().models.generateContent({
      model: agent.model || DEFAULT_AGENT_MODEL,
      contents,
      config: {
        systemInstruction: agent.buildSystemPrompt(),
      },
    });
    const text = response.text;
    if (!text) {
      throw new Error('Gemini returned an empty response');
    }
    return text;
  } catch (err) {
    throw new Error(`runAgentPrompt failed for agent "${agent.id}": ${err.message}`);
  }
}

// One-time, opt-in call triggered by a user leaving feedback on a completed
// task step — never runs automatically. Returns a suggested replacement for
// agent.context, or null if the feedback had nothing durable worth keeping
// (praise/complaint with no reusable fact/preference/correction in it).
// Throws on real failures rather than swallowing them into null, since the
// caller needs to tell "nothing durable" apart from "the call broke."
export async function suggestContextFromFeedback(agent, { feedback, taskInput, stepOutput }) {
  try {
    const response = await getClient().models.generateContent({
      model: CONTEXT_SUGGESTION_MODEL,
      contents:
        `Agent role: ${agent.role}\n` +
        `Current background context (may be empty): ${agent.context || '(none)'}\n` +
        (taskInput ? `The task this feedback is about: "${taskInput}"\n` : '') +
        (stepOutput ? `This agent's output on that task: "${String(stepOutput).slice(0, 4000)}"\n` : '') +
        `User feedback on that output: "${feedback}"\n\n` +
        'If this feedback contains durable, reusable information the agent should remember for future tasks ' +
        '(facts, corrections, preferences, standards to follow), produce an updated version of the background ' +
        'context that incorporates it, staying concise. If the feedback is just praise or complaint with ' +
        'nothing durable to remember (e.g. "great job", "not good"), respond with exactly: NONE',
      config: {
        systemInstruction:
          'You update a specialist AI agent\'s background context based on user feedback about its work. ' +
          'Respond with either the updated context text, or exactly the word NONE — no extra commentary, no ' +
          'markdown, no quotes around your answer.',
      },
    });
    const text = response.text?.trim();
    if (!text) {
      throw new Error('Gemini returned an empty response');
    }
    if (/^none\.?$/i.test(text)) return null;
    return text;
  } catch (err) {
    throw new Error(`suggestContextFromFeedback failed: ${err.message}`);
  }
}

// One-time, opt-in call triggered by a user reviewing a task stuck in
// "needs_agent" status — never runs automatically. Drafts a full candidate
// agent to fill the gap the orchestrator identified; the caller shows it as
// an editable preview and only creates the agent (via the normal
// POST /api/agents path) if the user explicitly confirms.
export async function draftAgentForGap({ reason, taskInput }) {
  try {
    const response = await getClient().models.generateContent({
      model: AGENT_DRAFT_MODEL,
      contents:
        `A task needs a specialist agent that doesn't exist yet in the roster.\n` +
        `Task: "${taskInput}"\n` +
        `Why no existing agent fits: ${reason}\n\n` +
        'Draft one new specialist agent that would fill this gap.',
      config: {
        systemInstruction:
          'You design specialist AI agents for a multi-agent task system. Given a task and a gap in the ' +
          'current roster, draft one new agent that would fill it. Keep the role concise and actionable.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short job-title-like name, e.g. "Copywriter" or "Data Analyst".' },
            role: { type: 'string', description: 'One to two sentence description of what this agent does.' },
            specialty: { type: 'string', description: 'Short category label, e.g. "Writing" or "Data analysis".' },
            inputType: { type: 'string', description: 'What kind of input this agent expects, e.g. "topic" or "agent_output".' },
            outputType: { type: 'string', enum: ['text', 'image', 'structured', 'feedback'] },
            tone: { type: 'string', description: 'Optional working style/tone, e.g. "concise and analytical".' },
          },
          required: ['name', 'role', 'specialty', 'inputType', 'outputType'],
        },
      },
    });
    const text = response.text;
    if (!text) {
      throw new Error('Gemini returned an empty response');
    }
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`draftAgentForGap failed: ${err.message}`);
  }
}

// Asks Gemini to route a task to one or more agents via function calling.
// Returns the raw functionCalls array: [{ name, args: { input } }, ...]
export async function askOrchestrator(taskInput, agents) {
  if (agents.length === 0) {
    throw new Error('No agents are registered to route this task to');
  }
  try {
    const response = await getClient().models.generateContent({
      model: ORCHESTRATOR_MODEL,
      contents: `Route the following user task to the specialist agent(s) that should handle it by calling their function(s). Task: "${taskInput}"`,
      config: {
        systemInstruction:
          'You are an orchestrator for a team of specialist AI agents. Given a task, call the function(s) ' +
          'for every agent needed to fully complete it. If the task needs a multi-step pipeline (e.g. writing ' +
          'copy before producing a design brief before generating an image), call all of the agents involved — ' +
          'the caller will resolve their execution order from each agent\'s declared dependency. Only call agents ' +
          'that are actually needed. If none of the available agents are a reasonable fit for this task, call ' +
          'no_suitable_agent instead of forcing a poor match.',
        toolConfig: {
          functionCallingConfig: { mode: FunctionCallingConfigMode.ANY },
        },
        tools: [{ functionDeclarations: [...agents.map((a) => a.toFunctionDeclaration()), NO_SUITABLE_AGENT_FUNCTION] }],
      },
    });
    return response.functionCalls ?? [];
  } catch (err) {
    throw new Error(`askOrchestrator failed: ${err.message}`);
  }
}
