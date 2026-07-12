import { GoogleGenAI, FunctionCallingConfigMode, createUserContent, createPartFromUri } from '@google/genai';
import { DEFAULT_AGENT_MODEL } from './models.js';

// Not slider-controlled (unlike per-agent calls, which use agent.model) —
// see the comment in src/lib/models.js on why this is gemini-3.5-flash now.
const ORCHESTRATOR_MODEL = 'gemini-3.5-flash';
const CONTEXT_SUGGESTION_MODEL = 'gemini-3.5-flash';
const TEAM_DRAFT_MODEL = 'gemini-3.5-flash';
const TASK_SUGGESTION_MODEL = 'gemini-3.5-flash';

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

const TRANSIENT_ERROR_MAX_RETRIES = 2;
const TRANSIENT_ERROR_RETRY_DELAY_MS = 1500;

// Google's 503 "high demand, try again later" is common enough under real
// traffic that a task failing outright on one is worse than a short retry —
// seen repeatedly in testing (2026-07-11), unrelated to request content.
function isTransientError(err) {
  return /"code":\s*503|UNAVAILABLE|high demand/i.test(String(err?.message || err));
}

async function generateContentWithRetry(request, { maxRetries = TRANSIENT_ERROR_MAX_RETRIES } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await getClient().models.generateContent(request);
    } catch (err) {
      lastErr = err;
      if (attempt >= maxRetries || !isTransientError(err)) throw err;
      await sleep(TRANSIENT_ERROR_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastErr;
}

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

// Thorough mode always has web access. Fast mode enables it only when the task
// or the agent's job clearly calls for URLs, research, sources, or current
// information, avoiding unnecessary tool round-trips for ordinary writing.
const WEB_ACCESS_TOOLS = [{ urlContext: {} }, { googleSearch: {} }];
const WEB_ACCESS_PATTERN = /https?:\/\/|www\.|\b(?:current|currently|latest|today|recent|news|search|research|look up|online|verify|sources?|citations?|reviews?|market data|weather|price)\b/i;

export function shouldUseWebAccess(agent, input, executionMode) {
  if (executionMode === 'thorough') return true;
  return WEB_ACCESS_PATTERN.test(`${input}\n${agent.role || ''}\n${agent.directive || ''}\n${agent.specialty || ''}`);
}

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
    needsImage: {
      type: 'boolean',
      description: 'True if the best way to answer this task is a generated image (a picture, logo, illustration, diagram, design mockup, etc.) rather than words alone. Decide this as early as you can, including on phase 1 — flagging it ends the phase sequence immediately, so do not spend a phase drafting body text first if the deliverable is clearly visual.',
    },
    imagePrompt: {
      type: 'string',
      description: 'Only present when needsImage is true: a detailed, self-contained prompt describing exactly what image to generate (subject, style, composition, colors, mood, and any text that must appear on it). Omit otherwise.',
    },
  },
  required: ['phase', 'content'],
};

const OUTPUT_TOKEN_LIMITS = { fast: 8192, thorough: 16384 };

// Runs one phase of a multi-phase agent execution, asking Gemini to both do
// the phase's work AND self-report a short task-specific label for what it
// did (e.g. "Gathering" vs "Drafting") — real, per-task labels rather than a
// hardcoded phase list, since what "phase 1" means varies by agent/task.
// The final phase's `content` is the step's actual output; earlier phases'
// `content` is intermediate work product handed to the next phase as context.
// Any phase — including phase 1 — can flag needsImage/imagePrompt instead;
// every agent can produce an image dynamically when the task calls for one,
// there's no separate "image agent" outputType anymore (removed 2026-07-11).
// The caller (runChain in orchestrator.js) checks needsImage after *every*
// phase and short-circuits the remaining phases when it's true, rather than
// waiting for a "final" phase — an earlier version only checked the last
// phase, but by then a prior text-drafting phase had already anchored the
// model on a written answer, and it would just polish that instead of
// reconsidering the format (caught 2026-07-11 via a real "design a flyer"
// task that produced a text document instead of an image).
export async function runAgentPromptPhase(agent, {
  input,
  phaseNumber,
  totalPhases,
  previousContent,
  file,
  executionMode = 'fast',
}) {
  try {
    const phaseInstruction = totalPhases === 1
      ? `Complete the following task and produce the finished answer to hand back. Be direct and concise while ` +
        `fully satisfying every stated requirement.\n\nTask input:\n${input}`
      : phaseNumber === 1
      ? `This is phase ${phaseNumber} of ${totalPhases} of this task. If the deliverable is clearly a visual ` +
        `artifact (see the needsImage guidance below), skip straight to setting needsImage and a complete ` +
        `imagePrompt now — do not spend this phase drafting written body copy first. Otherwise, do the natural ` +
        `first part of the work only (e.g. gathering, researching, or drafting raw material), not the final ` +
        `polished answer. Produce exactly ONE version of this phase's work, not multiple alternative ` +
        `drafts/options to choose between, and keep it as concise as the task allows.\n\nTask input:\n${input}`
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
    const useWebAccess = shouldUseWebAccess(agent, input, executionMode);
    const webInstruction = useWebAccess
      ? '\n\nYou have real web access: fetch URLs mentioned in the input and use live search when it improves accuracy. Do not fabricate information you can verify.'
      : '';
    const imageInstruction = '\n\nYou can also request a generated image instead of a written answer. RULE: if ' +
      'the task names a visual artifact as what it wants made — a "flyer", "poster", "banner", "logo", ' +
      '"graphic", "illustration", "diagram", "social media image/post image", or similar — you MUST set ' +
      'needsImage to true, no exceptions, even if: (a) most of the request is phrased as text requirements ' +
      '(headlines, event details, color hex codes, font names, copy), or (b) the request asks you to "provide ' +
      'prompts/ideas/concepts for imagery" — that phrasing describes what should visually appear on the ' +
      'artifact, it is NOT a request for you to write those prompts out as text instead of making the thing. ' +
      'The task asked for a flyer/poster/etc., so the deliverable is that image, full stop. When needsImage is ' +
      'true, write imagePrompt as one self-contained image-generation prompt that folds in every piece of ' +
      'required text (headline, dates, CTA, etc.), the color palette, and the visual concept, so the generated ' +
      'image actually contains all of it — do not write any of that content out as a separate text document ' +
      'instead. Decide this as early as you can, including on phase 1 — flagging needsImage ends the phase ' +
      'sequence immediately, so do not draft written body copy in an earlier phase and only reconsider the ' +
      'format at the end. Only leave needsImage false when the task is genuinely just asking for writing, ' +
      'strategy, analysis, or data with no named visual artifact as the ask.';
    const systemInstruction = `${agent.buildSystemPrompt()}${webInstruction}${imageInstruction}\n\nRespond with ` +
      'ONLY the required JSON object (phase, content, and needsImage/imagePrompt when applicable) — no markdown ' +
      'code fences around it, no text outside it. The "content" field is where the "respond with only the ' +
      'requested output itself" rule above applies: it must contain your actual output for this phase and ' +
      'nothing about the JSON structure, schema, or formatting.';

    const response = await generateContentWithRetry({
      model: agent.model || DEFAULT_AGENT_MODEL,
      contents,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: PHASE_RESPONSE_SCHEMA,
        maxOutputTokens: OUTPUT_TOKEN_LIMITS[executionMode] || OUTPUT_TOKEN_LIMITS.fast,
        ...(useWebAccess ? { tools: WEB_ACCESS_TOOLS } : {}),
      },
    }, { maxRetries: executionMode === 'fast' ? 1 : TRANSIENT_ERROR_MAX_RETRIES });
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
    return {
      phase: parsed.phase || `Phase ${phaseNumber}`,
      content: parsed.content,
      needsImage: Boolean(parsed.needsImage),
      imagePrompt: parsed.imagePrompt || undefined,
    };
  } catch (err) {
    throw new Error(`runAgentPromptPhase failed for agent "${agent.id}" (phase ${phaseNumber}/${totalPhases}): ${err.message}`);
  }
}

// Rewrites free-form user text (an agent's directive, a task prompt, or a
// business description/goal) into a clearer, more effective version via
// Gemini — powers every "Optimize with Gemini" button in the app.
export async function optimizeText(text, kind) {
  const instructions = kind === 'agent_directive'
    ? 'Rewrite the following instructions for an AI agent so they are clearer, more specific, and more effective ' +
      'at guiding that agent\'s behavior. Preserve the original intent and keep it roughly the same length. ' +
      'Respond with only the rewritten instructions — no preamble, no quotes, no commentary.'
    : kind === 'business_context'
    ? 'Rewrite the following text for clarity and concision — it is a factual description of a business or a ' +
      'stated goal, NOT a task or request to be carried out. Preserve every fact and detail actually stated; do ' +
      'not invent new ones, do not turn it into an instruction, a strategy document, or a list of ' +
      'recommendations, and do not respond as if you were being asked to do something. Keep it roughly the same ' +
      'length. Respond with only the rewritten text — no preamble, no quotes, no commentary.'
    : 'Rewrite the following task prompt so it is clearer, more specific, and more likely to get a high-quality ' +
      'result from an AI agent. Preserve the original intent. Respond with only the rewritten prompt — no ' +
      'preamble, no quotes, no commentary.';

  try {
    const response = await generateContentWithRetry({
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
    const response = await generateContentWithRetry({
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
                  outputType: { type: 'string', enum: ['text', 'structured', 'feedback'] },
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

// Generates concrete, ready-to-run next tasks from the workspace's business
// focus, available agents, active work, and recent completed outcomes.
export async function suggestTasksForWorkspace(context) {
  try {
    const response = await generateContentWithRetry({
      model: TASK_SUGGESTION_MODEL,
      contents:
        'Use this workspace context to recommend exactly four valuable next tasks:\n\n' +
        JSON.stringify(context),
      config: {
        systemInstruction:
          'You are an operations advisor inside a multi-agent business workspace. Suggest concrete tasks that ' +
          'advance the business\'s stated focus and can be completed by the available agent roster. Use completed ' +
          'work to propose logical next steps, but do not repeat completed tasks. Do not duplicate anything active. ' +
          'Each prompt must be specific and ready to submit directly to the agents, not a vague idea or a question. ' +
          'Return exactly four varied suggestions ordered by expected business value.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            suggestions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'A concise action-oriented task title.' },
                  prompt: { type: 'string', description: 'A detailed, ready-to-run task prompt.' },
                  rationale: { type: 'string', description: 'One short sentence explaining why this is valuable now.' },
                },
                required: ['title', 'prompt', 'rationale'],
              },
            },
          },
          required: ['suggestions'],
        },
      },
    });
    const text = response.text;
    if (!text) throw new Error('Gemini returned an empty response');
    const parsed = JSON.parse(text);
    return (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
      .filter((suggestion) => suggestion?.title && suggestion?.prompt && suggestion?.rationale)
      .slice(0, 4);
  } catch (err) {
    throw new Error(`suggestTasksForWorkspace failed: ${err.message}`);
  }
}

// Asks Gemini to route a task to one or more agents via function calling.
// Returns the raw functionCalls array: [{ name, args: { input } }, ...]
export async function askOrchestrator(taskInput, agents) {
  if (agents.length === 0) {
    throw new Error('No agents are registered to route this task to');
  }
  try {
    const response = await generateContentWithRetry({
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
