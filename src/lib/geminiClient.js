import { GoogleGenAI, FunctionCallingConfigMode, createUserContent, createPartFromUri } from '@google/genai';
import { DEFAULT_AGENT_MODEL } from './models.js';

// Not slider-controlled (unlike per-agent calls, which use agent.model) —
// see the comment in src/lib/models.js on why this is gemini-3.5-flash now.
const ORCHESTRATOR_MODEL = 'gemini-3.5-flash';
const CONTEXT_SUGGESTION_MODEL = 'gemini-3.5-flash';
const TEAM_DRAFT_MODEL = 'gemini-3.5-flash';

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

// One-time call from the mandatory "describe your business" onboarding flow
// (shown instead of the manual creation form on an empty roster) — drafts a
// starting team tailored to the stated business/goal, adjusted by time
// horizon: short-term gets a lean 1-2 agent team with no persistent context
// (a one-off goal doesn't need it); long-term gets a fuller 3-5 agent team
// with each agent's context pre-filled with the business background, since
// it'll carry into every future task. Suggestion-only — the caller reviews
// and edits the draft, then creates whichever agents it keeps through the
// completely ordinary POST /api/agents path.
export async function draftTeamForBusiness({ description, goal, term }) {
  const isLongTerm = term === 'long';
  try {
    const response = await getClient().models.generateContent({
      model: TEAM_DRAFT_MODEL,
      contents:
        `Business description: ${description}\n` +
        `What they want this AI agent platform to help with: ${goal}\n` +
        `Time horizon: ${isLongTerm ? 'long-term, ongoing work' : 'short-term, one specific immediate goal'}\n\n` +
        (isLongTerm
          ? 'Draft a team of 3-5 specialist agents that could handle this kind of work on an ongoing basis. ' +
            'Give each agent a concise "context" field summarizing the business background it should always ' +
            'keep in mind for future tasks.'
          : 'Draft a lean team of 1-2 specialist agents focused specifically on getting this immediate goal ' +
            'done quickly. Leave "context" empty for these — a one-off goal does not need persistent business ' +
            'background.'),
      config: {
        systemInstruction:
          'You design a starting roster of specialist AI agents for a multi-agent task system, based on a ' +
          'business description, a stated goal, and a time horizon. Each agent needs a clear, distinct role — ' +
          'do not draft overlapping or redundant agents.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            agents: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Short job-title-like name, e.g. "Copywriter" or "Data Analyst".' },
                  role: { type: 'string', description: 'One to two sentence description of what this agent does.' },
                  specialty: { type: 'string', description: 'Short category label, e.g. "Writing" or "Data analysis".' },
                  inputType: { type: 'string', description: 'What kind of input this agent expects, e.g. "topic" or "agent_output".' },
                  outputType: { type: 'string', enum: ['text', 'image', 'structured', 'feedback'] },
                  tone: { type: 'string', description: 'Optional working style/tone, e.g. "concise and analytical".' },
                  context: { type: 'string', description: 'Optional business background this agent should keep in mind. Empty string if not needed.' },
                },
                required: ['name', 'role', 'specialty', 'inputType', 'outputType'],
              },
            },
          },
          required: ['agents'],
        },
      },
    });
    const text = response.text;
    if (!text) {
      throw new Error('Gemini returned an empty response');
    }
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.agents) ? parsed.agents : [];
  } catch (err) {
    throw new Error(`draftTeamForBusiness failed: ${err.message}`);
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
          'that are actually needed.',
        toolConfig: {
          functionCallingConfig: { mode: FunctionCallingConfigMode.ANY },
        },
        tools: [{ functionDeclarations: agents.map((a) => a.toFunctionDeclaration()) }],
      },
    });
    return response.functionCalls ?? [];
  } catch (err) {
    throw new Error(`askOrchestrator failed: ${err.message}`);
  }
}
