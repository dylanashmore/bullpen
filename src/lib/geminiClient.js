import { GoogleGenAI, FunctionCallingConfigMode, createUserContent, createPartFromUri } from '@google/genai';
import { DEFAULT_AGENT_MODEL } from './models.js';

// Not slider-controlled (unlike per-agent calls, which use agent.model) —
// see the comment in src/lib/models.js on why this is gemini-3.5-flash now.
const ORCHESTRATOR_MODEL = 'gemini-3.5-flash';
const CONTEXT_SUGGESTION_MODEL = 'gemini-3.5-flash';

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

// Every specialist agent call gets real web access: urlContext lets the model
// fetch and read specific URLs mentioned in its input (e.g. "summarize the
// reviews at this link"), googleSearch lets it ground answers in current
// live search results instead of only training-data knowledge. Both are
// confirmed (2026-07-11, tested directly against the API) to work fine
// alongside responseSchema/JSON mode, which runAgentPromptPhase depends on.
const WEB_ACCESS_TOOLS = [{ urlContext: {} }, { googleSearch: {} }];

const PHASE_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    phase: {
      type: 'string',
      description: 'A short 1-2 word gerund label for what this phase is doing, e.g. "Gathering", "Summarizing", "Drafting", "Refining". Specific to this task, not generic.',
    },
    content: {
      type: 'string',
      description: 'This phase\'s work product, and nothing else — no meta-commentary about this JSON structure, no remarks about the schema or formatting, no markdown code fences wrapping it. Exactly what this phase\'s answer would be if it were the agent\'s entire response.',
    },
  },
  required: ['phase', 'content'],
};

const PHASE_OUTPUT_TOKEN_LIMIT = 8192;

// Runs one phase of a multi-phase agent execution, asking Gemini to both do
// the phase's work AND self-report a short task-specific label for what it
// did (e.g. "Gathering" vs "Drafting") — real, per-task labels rather than a
// hardcoded phase list, since what "phase 1" means varies by agent/task.
// The final phase's `content` is the step's actual output; earlier phases'
// `content` is intermediate work product handed to the next phase as context.
export async function runAgentPromptPhase(agent, { input, phaseNumber, totalPhases, previousContent, file }) {
  try {
    const phaseInstruction = phaseNumber === 1
      ? `This is phase ${phaseNumber} of ${totalPhases} of this task — do the natural first part of the work only ` +
        `(e.g. gathering, researching, or drafting raw material), not the final polished answer.\n\nTask input:\n${input}`
      : `This is the final phase (${phaseNumber} of ${totalPhases}) of this task. Using your own prior-phase work ` +
        `below, complete the task and produce the finished answer to hand back.\n\nOriginal task input:\n${input}` +
        `\n\nYour previous-phase work:\n${previousContent}`;

    const contents = file
      ? createUserContent([createPartFromUri((await uploadFileAndWaitUntilActive(file)).uri, file.mimeType), phaseInstruction])
      : phaseInstruction;

    // Overrides buildSystemPrompt()'s "respond with only the requested output
    // itself" line, which was written for a single plain-text response — left
    // as-is here it reads as license to comment on the JSON wrapper itself,
    // which produced malformed/rambling `content` values in testing. This
    // supersedes it: the "no meta-commentary" rule now applies to `content`,
    // and the JSON wrapper is explained as separate infrastructure.
    const systemInstruction = `${agent.buildSystemPrompt()}\n\nYou have real web access: fetch and read specific ` +
      'URLs mentioned in your input, and use live search for anything current or outside your training data. ' +
      'Use them whenever they would make your answer more accurate — do not guess or fabricate when you could ' +
      'look it up instead.\n\nYou are running as one phase of a multi-phase pipeline. Respond with ONLY the ' +
      'required JSON object (phase, content) — no markdown code fences around it, no text outside it. The ' +
      '"content" field is where the "respond with only the requested output itself" rule above applies: it must ' +
      'contain your actual output for this phase and nothing about the JSON structure, schema, or formatting.';

    const response = await getClient().models.generateContent({
      model: agent.model || DEFAULT_AGENT_MODEL,
      contents,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: PHASE_RESPONSE_SCHEMA,
        maxOutputTokens: PHASE_OUTPUT_TOKEN_LIMIT,
        tools: WEB_ACCESS_TOOLS,
      },
    });
    if (!response.text) {
      throw new Error(`Gemini returned an empty response (finishReason: ${response.candidates?.[0]?.finishReason ?? 'unknown'})`);
    }
    let parsed;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      throw new Error(`Gemini returned malformed JSON (finishReason: ${response.candidates?.[0]?.finishReason ?? 'unknown'}): ${response.text.slice(0, 200)}`);
    }
    if (!parsed.content) {
      throw new Error('Gemini phase response was missing content');
    }
    return { phase: parsed.phase || `Phase ${phaseNumber}`, content: parsed.content };
  } catch (err) {
    throw new Error(`runAgentPromptPhase failed for agent "${agent.id}" (phase ${phaseNumber}/${totalPhases}): ${err.message}`);
  }
}

// Rewrites free-form user text (an agent's directive, or a task prompt) into
// a clearer, more effective version via Gemini — powers the "Optimize with
// Gemini" buttons on the agent-creation form and the task dialog.
export async function optimizeText(text, kind) {
  const instructions = kind === 'agent_directive'
    ? 'Rewrite the following instructions for an AI agent so they are clearer, more specific, and more effective ' +
      'at guiding that agent\'s behavior. Preserve the original intent and keep it roughly the same length. ' +
      'Respond with only the rewritten instructions — no preamble, no quotes, no commentary.'
    : 'Rewrite the following task prompt so it is clearer, more specific, and more likely to get a high-quality ' +
      'result from an AI agent. Preserve the original intent. Respond with only the rewritten prompt — no ' +
      'preamble, no quotes, no commentary.';

  try {
    const response = await getClient().models.generateContent({
      model: DEFAULT_AGENT_MODEL,
      contents: `${instructions}\n\nOriginal:\n${text}`,
    });
    const optimized = response.text?.trim();
    if (!optimized) {
      throw new Error('Gemini returned an empty response');
    }
    return optimized;
  } catch (err) {
    throw new Error(`optimizeText failed: ${err.message}`);
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
