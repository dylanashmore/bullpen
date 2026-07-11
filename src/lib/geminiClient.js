import { GoogleGenAI, FunctionCallingConfigMode, createUserContent, createPartFromUri } from '@google/genai';

// gemini-2.5-flash was pulled from new API keys 2026-07-09 (ahead of its official
// 2026-10-16 shutdown). gemini-3.5-flash is the current stable replacement, no
// shutdown announced yet — but watch ai.google.dev/gemini-api/docs/deprecations.
const AGENT_MODEL = 'gemini-3.5-flash';
const ORCHESTRATOR_MODEL = 'gemini-3.5-flash';
const ENRICHMENT_MODEL = 'gemini-3.5-flash';

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
      model: AGENT_MODEL,
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

// One-time call made at agent creation only — never call this per task.
// Returns the model's raw trimmed text: either a 2-3 sentence practical
// summary, or the literal string "NONE" for an unrecognized reference.
export async function runStyleEnrichmentPrompt(rawInput) {
  try {
    const response = await getClient().models.generateContent({
      model: ENRICHMENT_MODEL,
      contents: `The user described a style/reference as: "${rawInput}". If this is a real, recognizable style, artist, framework, or example, summarize in 2-3 sentences how an AI agent should apply it. If this is not a real or recognizable reference, respond with exactly: NONE`,
      config: {
        systemInstruction:
          'You are a precise classifier and summarizer. Respond with either a 2-3 sentence practical summary, ' +
          'or exactly the word NONE — no extra commentary, no markdown, no surrounding quotes.',
      },
    });
    const text = response.text;
    if (!text) {
      throw new Error('Gemini returned an empty response');
    }
    return text.trim();
  } catch (err) {
    throw new Error(`runStyleEnrichmentPrompt failed: ${err.message}`);
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
