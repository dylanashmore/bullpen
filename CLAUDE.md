# Bullpen — multi-agent access point

## What this is
A 12-hour hackathon project. The pitch: treat AI agents as "employees" you assign tasks to,
rather than a single chatbot. A human types a task into one input box, an orchestrator decides
which specialist agent(s) should handle it, and the result shows up in a live task feed
alongside an org chart showing each agent's status.

This repo holds both halves: the backend (`src/`, built here) and the frontend (`frontend/`,
built by a teammate in React, in parallel). **Do not change the request/response shapes in the
API contract section without confirming with the user first** — the frontend is being built
against them concurrently. Everything else in this codebase can be refactored freely.

## Tech stack
- Backend: Node.js + Express, ES modules (`"type": "module"` in package.json)
- LLM: Google Gemini API via `@google/genai` for specialist agent text generation (per-agent
  model, see `src/lib/models.js`), and for orchestrator routing decisions via Gemini function
  calling (`ORCHESTRATOR_MODEL` in `src/lib/geminiClient.js`, not slider-controlled).
  **`gemini-2.5-*` models (flash-lite/flash/pro) were pulled from new API keys 2026-07-09**,
  confirmed live on this project's key (404 "no longer available to new users") — this is a
  hard deprecation, not a billing/tier gate, so upgrading billing doesn't fix it. As of
  2026-07-11, the picker's three tiers map to three distinct, individually-verified ids:
  `gemini-flash-lite-latest` (Flash-Lite), `gemini-3.5-flash` (Flash, also the backend default
  and orchestrator routing model), `gemini-pro-latest` (Pro) — set in both
  `SUPPORTED_AGENT_MODELS` (`src/lib/models.js`) and the frontend's `geminiModels`
  (`frontend/src/App.jsx`). Don't reintroduce any `gemini-2.5-*` id without testing it against a
  real key first.
- Images: Google Imagen API (`ai.models.generateImages`) — currently `imagen-4.0-generate-001`,
  called from `generateImage()` in `imagenClient.js` whenever an agent's own final phase flags
  `needsImage: true` (see "Automatic image generation" below); no longer gated by a per-agent
  `outputType` value. Was blocked on this key's free tier ("Imagen 3 is only available on paid
  plans") as of 2026-07-11; **confirmed working later the same day** after a billing change —
  still worth a quick retest before a demo if the project's billing setup changes again. Google
  has also announced deprecation of standalone Imagen models for 2026-08-17 in favor of
  `gemini-2.5-flash-image` ("Nano Banana") — note that despite the "2.5" in its name this is an
  image-output model, a separate deprecation track from the `gemini-2.5-flash` *text* models
  above; don't assume it's affected by the same cutoff without checking. Also confirmed working
  live on this key (2026-07-11, not yet wired into the app): `gemini-3-pro-image-preview` /
  `gemini-3-pro-image` ("Nano Banana Pro", GA June 2026) — a newer, higher-quality image model
  called via a normal `generateContent` request (returns an `inlineData` image part) rather than
  the separate `generateImages` API; a candidate to replace Imagen here, not yet decided.
- Storage: `src/lib/persistence.js` holds a Redis client (`@upstash/redis`, REST-based — works
  over plain HTTP, so it's fine in serverless/edge) built from `KV_REST_API_URL`/`KV_REST_API_TOKEN`
  (Vercel KV naming) or `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` (direct Upstash
  Marketplace naming) — whichever pair is present. **Added 2026-07-11** to fix agents/tasks
  vanishing under Vercel: the old plain in-memory Map/array was scoped to a single serverless
  instance, and concurrent requests could land on a different instance with an empty store,
  flashing the UI back to the empty-roster screen. When neither env var pair is set (e.g. local
  dev with no database linked), both stores fall back to the original in-memory Map/array — no
  database is required to develop locally. `getAgentById`/`getTaskById` under Redis mode return a
  freshly deserialized copy each call, not a live reference, so every mutation site (see
  `orchestrator.js`, `routes/agents.js`, `routes/tasks.js`) explicitly writes back via
  `saveAgent`/`saveTask` after changing a field — mutating the object alone does not persist it.
- No websockets — the frontend polls `GET /api/tasks` every ~2s for progress.

## Core concept: agents as objects
Every specialist agent is an instance of the `Agent` class (`src/agents/Agent.js`) with:
- `id` — stable slug (e.g. `"writer"`), also used as the Gemini function-call name for routing
- `name`, `role` (job description, feeds into both its system prompt and its function
  declaration's description)
- `inputType` — what it expects (e.g. `"topic"`, `"agent_output"`)
- `outputType` — `"text" | "structured" | "feedback"`. No `"image"` value anymore (retired
  2026-07-11) — every agent can generate an image dynamically, per-task, when its own final
  phase judges the task calls for one (see "Automatic image generation" below), rather than a
  human pre-designating a whole agent as image-only.
- `dependsOnAgent` — id of an upstream agent whose output feeds this agent's input, or `null`
  if it can run standalone from the raw task input
- `tone` (optional flavor for the system prompt)
- `status` — `"idle" | "working"`
- `acceptsFiles` — boolean, default `false`. If true and this agent has no `dependsOnAgent`
  (i.e. it's an entry point that receives the raw task input), a file attached to the task gets
  uploaded via the Gemini Files API and included alongside its text prompt. See "File uploads"
  below.

This object model is what lets the orchestrator build both single-agent tasks and multi-step
pipelines generically, without hardcoding per-agent logic anywhere.

**No agents are seeded at boot** — the roster starts empty and every agent (including any
researcher/writer/designer/artist-style pipeline) is created by the user via `POST
/api/agents`. This was previously auto-seeded (`seedDefaultAgents()` in `agentStore.js`) but
was deliberately removed so a fresh sign-in doesn't come pre-populated — the frontend's
`BusinessOnboarding` component (`frontend/src/App.jsx`) handles the zero-agent case, a
mandatory "describe your business" flow — see "Frontend" below. A four-agent
`writer → designer → artist` (plus standalone `researcher`) pipeline is still the canonical
example used in tests and docs below — just note it no longer exists until someone creates it.

## Orchestrator routing (function calling, not keyword matching)
`src/orchestrator.js`:
- `pickChainForTask(input)` sends the task input to Gemini with one function declaration per
  agent (`Agent.toFunctionDeclaration()`), forcing at least one function call
  (`FunctionCallingConfigMode.ANY`). It reads back `response.functionCalls`, then **expands the
  called agent set to include every ancestor implied by `dependsOnAgent`** — so if the model
  only calls `artist`, `designer` and `writer` get pulled in automatically since the pipeline
  needs their output.
- `runChain(task)` executes the resolved chain against a mutable `task` object (steps update
  in place as they progress, which is what `GET /api/tasks` reflects on each poll). Execution
  is level-based: any agent whose dependency is already satisfied (or has none) is "ready"; all
  ready agents in a round run concurrently via `Promise.all`. This is what gives pipelines their
  sequential ordering *and* gives independent agents parallel execution for free — there's a
  single code path for single-agent, multi-step pipeline, and parallel-branch tasks.

## Execution modes and phases (updated 2026-07-11)
Every task has `executionMode: "fast" | "thorough"` (default `"fast"`). Fast makes one Gemini
call per agent step, uses an 8,192-token ceiling, retries one transient 503, and only enables web
tools when the input or agent definition signals that they are needed. Thorough makes two
sequential calls (gather, then refine), a 16,384-token ceiling, two transient retries, and
always-on web tools. Both modes run through `runAgentPromptPhase()` in `geminiClient.js`, called
from `runChain()` in `orchestrator.js`; `getTextAgentPhaseCount(executionMode)` in
`orchestrator.js` resolves the phase count (`{ fast: 1, thorough: 2 }`). Mechanics:
- Each call asks Gemini for structured JSON output (`responseMimeType: 'application/json'`,
  a `{ phase, content, needsImage?, imagePrompt? }` schema) — the model picks its own short
  gerund label for what that phase is doing, specific to the task at hand, not a hardcoded list.
- Fast asks for the finished answer in its one call. Thorough phase 1 asks for "the natural first
  part of the work" (research/gathering/drafting); its final phase receives phase 1's `content`
  and produces the finished answer. Only the last phase becomes the step's actual `output`
  (unless it flags `needsImage` — see "Automatic image generation" below).
- `step.phase` is written back to the store (`saveTask`) after every phase completes, so
  `GET /api/tasks` reflects the current phase mid-execution, not just at the end.
- Cost/latency tradeoff is user-controlled in the task dialog (Fast vs Thorough) instead of
  imposed globally.

## Automatic image generation (added 2026-07-11, replaces the old `outputType: 'image'`)
There is no more dedicated "image agent" you designate at creation time. Instead, **any** phase
call can flag `needsImage: true` (plus an `imagePrompt` string) in its structured JSON response
when Gemini itself judges the task is best answered with a generated image — a picture, logo,
illustration, diagram, or design mockup — rather than text/structured content. The instruction
telling the model about this capability lives in `runAgentPromptPhase()`'s `systemInstruction` in
`geminiClient.js`. `runChain()` (`orchestrator.js`) checks `needsImage` after *every* phase, not
just the last one, and breaks out of the phase loop the moment it's true; when it does, it sets
`step.phase = 'Generating image'`, calls `generateImage(imagePrompt || <that phase's text
content>)` (`imagenClient.js`, unchanged — still Imagen), and uses *that* as the step's `output`
instead of the text `content`. Any agent can end up producing an image on one task and plain text
on the next; there's nothing on the `Agent` object that predicts which. The frontend needed no
changes for this — `StepOutput` already renders `output` as an `<img>` whenever it's a
`data:image/...` string and as text otherwise, regardless of *why* it ended up that way.

**Why "any phase," not just the final one (fixed 2026-07-11, same day as the initial build):** the
first version only let the *final* phase set `needsImage`. In Thorough mode that broke real
"design a flyer" tasks — phase 1's instruction was to gather "raw material," so it wrote a full
text draft of the flyer's copy with no awareness an image might be the right format; by the time
phase 2 ran, the model had ~2,500 characters of its own prior "work" sitting in front of it and
just polished that into a nicer text document instead of reconsidering the format, even though
the image-capability instruction was present in both calls' `systemInstruction`. Fix: phase 1 can
now flag `needsImage` too (its own instruction says to skip straight to `imagePrompt` rather than
drafting body copy when the deliverable is visual), and `runChain()`'s loop breaks the instant any
phase reports `needsImage: true` — Thorough mode's second text-refinement pass never runs on
something that's already been decided to be an image, so there's no anchoring text draft to derail
the decision. The `needsImage` instruction itself also had to get considerably more forceful and
literal (an explicit "if the task names a flyer/poster/logo/banner, you MUST set needsImage,
'provide prompts for imagery' means describe what's ON the image, not write text instead of making
it" rule) — a softer "use your judgment" phrasing kept losing to the sheer volume of text-shaped
sub-requirements (headlines, hex codes, font names) in realistic design-brief-style task inputs.

**Web access (updated 2026-07-11):** Thorough always passes
`tools: [{ urlContext: {} }, { googleSearch: {} }]`; Fast passes them only when
`shouldUseWebAccess()` (`geminiClient.js`) detects a URL, research/current-information language,
or a research role. These are real Gemini API tools, not agent-to-agent function calling (that's
a separate `tools` config, only used by `askOrchestrator()` for routing).
`urlContext` lets the model fetch and read specific URLs mentioned in its input (e.g. "summarize
the reviews at this link"); `googleSearch` grounds answers in live search results instead of only
training-data knowledge. Confirmed compatible with `responseSchema`/JSON mode by testing directly
against the API before rolling this out. The system instruction in `runAgentPromptPhase()` tells
the model it has this access so it actually uses it rather than guessing. **Before this, no agent
in this codebase — in any prior commit — had any real web/search/fetch capability**; anything
that looked like it (e.g. summarizing "the reviews at this Google link") was the model producing
plausible-sounding text from training data, not genuinely reading the page. The image-generation
call itself (`generateImage()` in `imagenClient.js`, triggered by `needsImage` — see "Automatic
image generation" above) doesn't get this — Imagen's `generateImages` call has no `tools` support.

**Reliability fixes (added 2026-07-11, found via stress-testing after merging web access):**
- Phase 1 hit a real `finishReason: MAX_TOKENS` failure in testing — the model wrote out several
  alternative drafts ("Option A... Option B...") instead of one, got cut off mid-JSON, and the
  step errored on the malformed result. Fixed by having the phase 1 instruction explicitly ask
  for exactly one version of the work, not multiple options to choose between, plus raising
  `PHASE_OUTPUT_TOKEN_LIMIT` 8192 → 16384 as headroom. **Do not add `thinkingConfig: {
  thinkingBudget: 0 }` here** — it was tried first as a "belt and suspenders" measure against
  this same bug, but A/B testing (10 runs with thinking left at its default vs 5 with it forced
  to 0, same previously-failing prompt) showed the prompt fix alone was already 100% sufficient.
  Disabling thinking blanket-wide would silently undercut the Pro tier's whole reason for
  existing (extended reasoning) for no measured benefit, so it was reverted.
- Every `generateContentWithRetry()`-wrapped call (all four `generateContent` call sites in
  `geminiClient.js`) now retries up to twice on a transient Gemini 503 ("high demand, try again
  later") with backoff — hit repeatedly in testing, unrelated to request content. Non-transient
  errors (bad key, invalid request) still fail immediately, no retry.

## Locked API contract
- `GET /api/agents` → array of agent objects (`Agent.toJSON()` shape: `id, name, role,
  inputType, outputType, dependsOnAgent, tone, status, acceptsFiles, specialty, directive,
  model, style, inspiredBy, context, contextHistory`). `contextHistory` (**added 2026-07-11**) is
  `[{ timestamp, previousContext, newContext, source: "manual" | "feedback", feedback }]`, oldest
  first, appended to by `PATCH /api/agents/:id` (see below) whenever `context` actually changes
  value — re-submitting the same context (e.g. saving the setup form with nothing touched) does
  not add an entry. Empty array on a freshly created agent; nothing writes to it at creation.
- `POST /api/agents` → body `{ name, role, inputType, outputType, dependsOnAgent, tone,
  acceptsFiles }`, creates an agent. `name/role/inputType/outputType` required;
  `dependsOnAgent` must reference an existing agent id if provided; `acceptsFiles` optional
  boolean, defaults to `false`. `specialty`, `directive`, `model`, `style`, `inspiredBy`, and
  `context` are optional; `model` is validated against `SUPPORTED_AGENT_MODELS`
  (`src/lib/models.js`) — `gemini-flash-lite-latest` / `gemini-3.5-flash` / `gemini-pro-latest`,
  all verified live, see Tech stack above. Tone, style, inspiration, and context are all
  included in the specialist system prompt — `context` (**added 2026-07-11**) is
  background/knowledge the agent should know (company info, prior facts), kept separate from
  `directive` (behavioral instructions).
- `PATCH /api/agents/:id` → body may contain any subset of `{ name, specialty, directive,
  inputType, outputType, tone, style, inspiredBy, context, acceptsFiles, dependsOnAgent, model }`
  — full parity with `POST`, so any field set at creation (including `context`) can be changed
  later without recreating the agent. `outputType` is validated against the same enum as
  creation; `dependsOnAgent` is validated for existence and checked against creating a
  dependency cycle (walks the chain via `wouldCreateCycle` in `routes/agents.js` —
  self-reference and any multi-hop loop are both rejected with 400, since nothing else in the
  codebase prevented this before, even at creation). At least one field must be provided. Body
  may also include `feedback` (**added 2026-07-11**, string, optional) alongside `context` —
  purely a history tag, not a separate write: when present and `context` actually changed, the
  new `contextHistory` entry is logged `source: "feedback"` with that text attached; when
  `context` changes without it, it's logged `source: "manual"`. This is how the frontend tells
  `AgentSetupSummary`'s manual edits (sends `context` alone) apart from `StepFeedback`'s "Apply
  to context" (sends both) in the resulting history, without a second endpoint.
- `POST /api/agents/draft-team` → body `{ description, goal, term }`, all three required;
  `term` must be `"short"` or `"long"`. **Suggestion-only — never creates anything.** One
  Gemini call (`draftTeamForBusiness` in `geminiClient.js`, structured JSON output) drafts a
  starting roster tailored to the business/goal — `term: "short"` yields a lean 1-2 agent team
  with empty `context`; `term: "long"` yields a fuller 3-5 agent team with each draft's
  `context` pre-filled with the business background. Returns `{ draft: [{ name, role,
  specialty, inputType, outputType, tone, context }, ...] }`. Powers the mandatory onboarding
  flow — see "Frontend" below.
- `POST /api/agents/:id/feedback` → body `{ feedback, taskInput?, stepOutput? }`, `feedback`
  required non-empty string. **Suggestion-only — never writes to the agent.** One Gemini call
  (`suggestContextFromFeedback` in `geminiClient.js`) drafts an updated `context` incorporating
  any durable, reusable information in the feedback (facts, corrections, preferences); returns
  `{ suggestedContext: string | null }`, `null` when the feedback had nothing durable to keep
  (pure praise/complaint). The caller reviews the draft and applies it themselves via the
  existing `PATCH /:id` (`{ context: suggestedContext }`) — this endpoint never persists
  anything on its own, since `context` is shared by everyone using that agent and a bad
  auto-merge would degrade it for the whole team, not just the person who gave the feedback.
- `DELETE /api/agents/:id` → removes an agent unless another agent depends on it (409).
- `GET /health` → `{ ok, geminiConfigured }`; reports key presence without exposing the key.
- `GET /api/workspace` → `{ profile }`; loads the persisted onboarding business description,
  goal, and time horizon. `PUT /api/workspace` validates and saves `{ description, goal, term }`.
- `GET /api/tasks` → task feed, newest first. Each task: `{ id, input, executionMode, status,
  steps[], createdAt, file, fileWarning? }`. Each step: `{ agentId, status, output, phase? }`, step status
  one of `pending|working|done|error|cancelled`. `phase` (**added 2026-07-11**, string, only
  present once a text/structured/feedback agent's first phase completes) is a short task-specific
  gerund label — "Gathering", "Summarizing", etc — self-reported by the model each phase; see
  "Phased execution" below. `file` is `{ name, mimeType } | null` — metadata only, set when
  the task was created with an attachment. `fileWarning` is only present (a string) when a file
  was attached but no agent in the resolved chain could use it — see "File uploads" below.
- `POST /api/tasks` → creates and kicks off a task, returns it **immediately** with empty
  `steps` and `status: "pending"`. Execution (routing + running each agent) continues
  asynchronously; the frontend polls `GET /api/tasks` to watch `steps` fill in and `status`
  progress to `working` → `done`/`error`. Two ways to call it, both still supported:
  - `Content-Type: application/json`, body `{ input: "...", agentId?: "writer",
    executionMode?: "fast" | "thorough" }` — no
    attachment. When `agentId` is supplied, the task targets that agent and automatically
    includes its declared upstream dependencies; without it, Gemini chooses the chain.
  - `Content-Type: multipart/form-data`, fields `input`, optional `executionMode`, and `file` — for
    tasks with an attachment. `input` is still required and validated the same way either way.
    Max upload size 20MB, one file per task. The response's `file` field reflects what was
    attached (or `null` for the JSON path).
- `POST /api/tasks/suggestions` → asks Gemini for four ready-to-run next tasks using the saved
  business profile, agent roster, active work, and recent completed outcomes. Returns
  `{ suggestions: [{ title, prompt, rationale }] }`. Active/completed tasks prevent duplicate
  suggestions, and image data URIs are removed before the context is sent to Gemini.
- `POST /api/tasks/:id/cancel` → cooperatively cancels a pending/working task, marks unfinished
  steps `cancelled`, and returns involved agents to `idle`. An in-flight provider request cannot
  be forcibly terminated, but its eventual result is discarded and cannot revive the task.
- `DELETE /api/tasks/:id` (**added 2026-07-11**) → removes a task's record outright (unlike
  `/cancel`, which stops it but keeps it in the feed) and returns 204. 404 if the id doesn't
  match a task. Allowed at any status, including `pending`/`working` — if a chain is still
  running in the background for a task deleted mid-execution, its next `saveTask()` call will
  re-write the record (same class of risk as the fire-and-forget `runChain()` caveat noted
  below), which is harmless in practice since the frontend has already dropped that id locally
  and isn't polling for it.
- `POST /api/tasks/:id/steps/:agentId/iterate` (**added 2026-07-11**) → body `{ details }`,
  required non-empty string. Re-runs that one already-`done` step with `details` folded into its
  original input (reconstructed from `task.input` for a root agent, or the upstream step's
  output for a dependent one — steps don't store their own input), and replaces `step.output` in
  place. 404 if the task or step doesn't exist; 400 if the step isn't `done` yet or `details` is
  empty. Blocking, like `/api/optimize` — not fire-and-forget like task creation — but
  `step.phase` is still written back after every phase internally, so the independent
  `GET /api/tasks` poll shows live progress (e.g. `"Revising"`) even while this request is still
  in flight. On failure the step reverts to its previous output/phase (still `done`) rather than
  losing the last good result; the error surfaces as a normal failed-request toast on the
  frontend. Distinct from `POST /api/agents/:id/feedback`: that drafts a durable context update
  for the agent's *future* tasks and never touches this task; this endpoint fixes *this* task's
  actual result right now and never touches the agent's context. Every *successful* call also
  appends to `step.iterations` (**added 2026-07-11**) — `[{ timestamp, details, previousOutput }]`,
  oldest first — so `GET /api/tasks` carries a full log of what was asked for and when, not just
  the current output. `previousOutput` is `null` when the step's prior output was an image rather
  than text, to avoid repeating a full base64 image on every iteration; the frontend renders that
  case as "(an image)". A failed iteration logs nothing, matching how it leaves `step.output`
  untouched.
- `POST /api/optimize` (**added 2026-07-11**) → body `{ text, kind? }`, `kind` is
  `"agent_directive" | "task_input"` (defaults to a task-prompt rewrite if omitted). Rewrites
  `text` via Gemini for clarity/effectiveness and returns `{ optimized }`. Powers the "Optimize
  with Gemini" buttons on the agent directive fields and the task dialog — the frontend replaces
  the field's contents with `optimized` directly, no preview/accept step.

## File structure
```
src/
  agents/
    Agent.js          — Agent class: buildSystemPrompt, toFunctionDeclaration, toJSON
    agentStore.js      — agent registry (addAgent, getAllAgents, getAgentById, removeAgent,
                         saveAgent — write-back after mutating a fetched agent), Redis-backed
                         via persistence.js with an in-memory fallback. No seeding — starts
                         empty on every boot.
  lib/
    models.js          — supported per-agent Gemini model ids and default model
    executionModes.js  — EXECUTION_MODES (`['fast', 'thorough']`), DEFAULT_EXECUTION_MODE
                         (`'fast'`), isExecutionMode() validator — see "Execution modes and
                         phases" above
    geminiClient.js    — runAgentPromptPhase() (one phase of a specialist agent's multi-phase
                         execution — 1 phase in fast mode, 2 in thorough; optionally attaches a
                         file via the Gemini Files API; conditional web/search tools via
                         shouldUseWebAccess(); JSON-schema output including needsImage/
                         imagePrompt), optimizeText() (the "Optimize with Gemini" rewrite),
                         generateContentWithRetry() (retries transient Gemini 503s, retry count
                         varies by execution mode), askOrchestrator() (routing via function
                          calling), suggestContextFromFeedback() (drafts a context update from
                          step feedback, or null if nothing durable), draftTeamForBusiness()
                          (drafts a starting roster for the mandatory onboarding flow, structured
                          JSON output), suggestTasksForWorkspace() (four business-aware next-task
                          recommendations) — none of the draft/suggestion calls run automatically
    imagenClient.js    — generateImage(), returns a data:image/png;base64,... string, called
                         from runChain() whenever an agent's final phase flags needsImage
    persistence.js     — shared Redis client (`@upstash/redis`) built from KV/Upstash env vars,
                         or null if neither is set; agentStore/taskStore both branch on this
    taskStore.js       — task feed (createTask, getAllTasks, getTaskById, saveTask — write-back
                         after mutating a fetched task, removeTask — deletes a task's record
                         outright), Redis-backed via persistence.js with an in-memory fallback
    workspaceStore.js  — persisted onboarding business profile with Redis/memory modes
    taskSuggestions.js — builds bounded suggestion context from the profile, roster, active
                         work, and completed outcomes without embedding image payloads
  orchestrator.js      — pickChainForTask() (routing + dependency expansion), runChain()
                         (level-based execution, sequential deps + parallel independents, hands
                         an optional file buffer to accepting root agents, generates an image
                         mid-step whenever a phase flags needsImage), getTextAgentPhaseCount()
                         (resolves phase count from a task's executionMode), runAgentStepOnce()
                         (one agent's full phase sequence run standalone, outside any task
                         chain — powers POST /:id/steps/:agentId/iterate; deliberately
                         duplicates runChain's per-step logic rather than sharing it, since
                         runChain's version is also cancellation-aware between phases in a way a
                         lone step re-run doesn't need)
  routes/
    agents.js          — GET/POST/PATCH/DELETE /api/agents, with validation; POST /:id/feedback
                         drafts a context suggestion from feedback without persisting it;
                         POST /draft-team drafts a starting roster from a business
                         description/goal/term, also without persisting anything
    tasks.js           — GET/POST /api/tasks, with validation; multer (memory storage) parses
                         an optional multipart file upload alongside the JSON path;
                         POST /:id/cancel and DELETE /:id round out the task lifecycle;
                         POST /:id/steps/:agentId/iterate re-runs one done step with extra
                         guidance and replaces its output in place; POST /suggestions generates
                         Gemini-recommended next tasks
    workspace.js       — GET/PUT /api/workspace business profile
  app.js               — Express app wiring (routes, CORS, JSON/error middleware, /health):
                         the shared module imported by both server.js and api/[...path].js
  server.js             — local dev entrypoint only: loads .env, calls app.listen()
api/
  [...path].js          — Vercel serverless entrypoint for one-segment endpoints such as
                         /api/health, /api/agents, /api/tasks, /api/workspace, and /api/optimize
  agents/               — explicit Vercel entrypoints for /api/agents/:id,
                         /api/agents/:id/feedback, and /api/agents/draft-team
  tasks/                — explicit Vercel entrypoints for /api/tasks/suggestions (POST),
                         /api/tasks/:id (DELETE),
                         /api/tasks/:id/cancel (POST), and
                         /api/tasks/:id/steps/:agentId/iterate (POST). These nested files are
                         required because Vercel's Vite-generated route manifest
                         treats the top-level [...path] function as a single path segment.
                         Every entrypoint re-exports the same Express app from src/app.js.
                         Agent/Task state now persists via Redis (see Storage above)
                         as long as `KV_REST_API_URL`/`KV_REST_API_TOKEN` (or the Upstash-named
                         equivalents) are set in the Vercel project — without them this falls
                         back to the old per-instance in-memory store and the original
                         multi-instance flakiness returns. **Still-open risk:** POST
                         /api/tasks's fire-and-forget `runChain()` call continues after the
                         response is sent — a function instance recycled mid-execution can still
                         leave a task stuck `working` forever, since there's no re-entry/resume
                         mechanism. Not observed in testing (maxDuration is 300s) but not
                         structurally ruled out either.
scripts/
  test-requests.js      — `npm run test:api`, exercises agent creation, single-agent task,
                          and full media pipeline against a running local server
  test-task-suggestions.js — validates profile persistence, context bounding, and suggestion
                             route preconditions without spending a Gemini call
frontend/                — see "Frontend" section below
```

## Environment
- `GEMINI_API_KEY` required (`.env`, see `.env.example`). Server logs a warning on boot if
  missing rather than crashing, so `GET /api/agents` etc. still work without a key.
- `PORT` optional, defaults to 3000.
- `KV_REST_API_URL`/`KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`)
  optional — enables persistent, cross-instance agent/task storage (see Storage above). Vercel
  sets these automatically once an Upstash Redis database is connected to the project (Vercel
  dashboard → project → Storage → Create Database → Upstash for Redis → Connect). Not needed for
  local dev; without them the server falls back to in-memory storage.

## File uploads
A task can optionally carry one file attachment (PDF, image, text, etc. — whatever the Gemini
Files API accepts), routed to whichever agent(s) in the resolved chain can use it:
- `POST /api/tasks` as `multipart/form-data` with a `file` field (see API contract above) sets
  `task.file = { name, mimeType }` and hands the raw bytes to `orchestrator.runChain(task,
  fileBuffer)`.
- The buffer is **never written to disk or stored anywhere** — multer uses memory storage, and
  the buffer only lives in the closure of that one `runChain` call.
- Only root agents (`dependsOnAgent: null`, i.e. the ones that receive the raw task input) with
  `acceptsFiles: true` actually get the file; every other agent in the chain runs exactly as
  before. There's no routing logic that steers a task toward file-capable agents based on the
  attachment, only based on `input` text — so if the resolved chain's entry agent(s) don't have
  `acceptsFiles: true`, the file goes unused. When that happens, `orchestrator.runChain` sets
  `task.fileWarning` to an explanatory string (task still completes normally, text-only) instead
  of silently dropping the attachment — surface it on the task feed card if present.
- `geminiClient.js` uploads via `client.files.upload({ file: Blob, config: { mimeType,
  displayName } })`, polls `client.files.get()` until `state` leaves `PROCESSING` (30s timeout),
  then passes `createUserContent([createPartFromUri(file.uri, mimeType), inputText])` as
  `contents` instead of a plain string. Re-uploads on every call rather than caching/reusing the
  Gemini-side file — fine at "one file per task, usually one accepting agent" scale; revisit if
  a task ever fans a file out to several accepting agents at once.
- One file per task, no multi-file support. 20MB upload limit (`multer` `limits.fileSize` in
  `routes/tasks.js`) — separate from and tighter than the Gemini Files API's own 2GB/50MB(PDF)
  limits, just a sane hackathon-scale cap.

## Frontend
Built by a teammate in `frontend/` — React 19 + Vite 8, plain CSS (no framework), ES modules.
No shared workspace/monorepo tooling; it has its own `package.json` and is run independently
(`cd frontend && npm run dev`, served by Vite on its own port, separate from the backend's
`PORT`).

```
frontend/
  src/
    App.jsx            — API-backed agents, live task feed, polling, file uploads, app UI
    api.js             — fetch wrapper for health, agent, and task endpoints
    main.jsx            — React root, imports the three CSS files
  css/
    theme.css, layout.css, components.css
  images/
    bullpen-transparent.png — logo
  index.html, vite.config.js, package.json
```

**Integration update (current):** The React frontend is wired to the Express API. Vite proxies
`/api` and `/health` to port 3000 in development; `VITE_API_URL` supports split-origin deploys.
Agents load from `GET /api/agents`; create, model update, and remove operations call the matching
API routes. Tasks submit raw orchestrator input (plus one optional file), poll every 2 seconds,
and render live task/step status, text or image output, upload metadata, warnings, and errors.
The task page's **Gemini Suggested Tasks** button opens four business-aware recommendations and
prefills the selected prompt into the normal editable task dialog.
The sidebar reports backend/key readiness. Browser `localStorage` is not the source of truth;
agent, task, and workspace-profile stores use Redis in production with in-memory local fallbacks.

**Business onboarding (current, mandatory on an empty roster):** `BusinessOnboarding` replaces
the manual creation form entirely until at least one agent exists — there is no "skip this" or
"create manually instead" path. Two required steps: (1) an intake form (business description,
goal, and a short-/long-term `<select>`, all `required`) that calls `POST
/api/agents/draft-team`; (2) a review step listing every drafted agent as an editable card
(Name/Specialty/directive/Tone, plus a Context field only shown for `term: "long"`, since
short-term drafts don't get one) with a per-card remove button. Nothing is created during
drafting — "Add N agents to Bullpen" loops the kept rows through the same `onCreate` handler
the manual form uses (`POST /api/agents`, one call per agent, sequential), and any card the
user removed just never gets created. It then persists the intake through `PUT /api/workspace`
so task suggestions retain the business focus after reloads. Same "preview, never silent"
pattern as every other Gemini-assisted feature in this app.

**Agent creation flow (current, once the roster is non-empty):** the "New agent" /
`QuickCreateAgent` form — used for adding *more* agents after the mandatory onboarding above has
created at least one — has a Specialty dropdown (Research / Writing / Software development /
Data analysis / Customer support / Project management / "Create your own…" for a free-text
specialty), a required "How should this agent work?" directive field, an optional "Context"
field (**added 2026-07-11** — background/knowledge the agent should know, distinct from the
directive; see `context` in the API contract above), an "Advanced setup" section (input/output
type, `dependsOnAgent`, tone, style, inspired-by), an "Accept file uploads" checkbox (disabled
whenever `dependsOnAgent` is set, matching the backend rule that only entry-point agents can
receive a file), and a Gemini model slider (`ModelSlider`). Everything submits via `POST
/api/agents`.

**Agent card layout (current):** `AgentCard` keeps the header, today's-task/current-process
status boxes, assign button, model slider, and footer always visible, but both the "Instructions"
block and the "Agent setup" summary (**Instructions collapsed added 2026-07-11**, matching the
setup summary's existing pattern) are `<details>` elements collapsed by default — each shows a
one-line preview in its `<summary>` and expands on click. This keeps the default card height
down without removing any functionality; editing instructions still works the same way, just
inside the expanded panel.

**Per-task pages (current, added 2026-07-11):** each task now has its own URL,
`/app/tasks/:id`, rather than every task rendering in full on one long "Tasks" page. The
lightweight client-side router (plain `route` state + `window.history.pushState`/`popstate` in
`App` — no `react-router-dom` dependency) gained a `/^\/app\/tasks\/([^/]+)$/` match alongside
its existing `/app`, `/app/agents`, `/app/tasks` routes; matching it sets `view = "task-detail"`
and extracts the id. `TasksView` (the "Tasks" tab) is now just an index — `TaskListRow` renders
one compact clickable row per task (status dot, input text, meta, status badge), calling the new
`openTask(taskId)` helper (`navigatePath('/app/tasks/${id}')`) on click; it no longer renders
steps/outputs/feedback inline. The full per-step detail — everything `TaskCard` already
rendered (steps, `StepOutput`, `StepFeedback`) — now only renders on the dedicated
`TaskDetailView` page, reached either from a `TaskListRow` or from the sidebar's "Task history"
rows (`Sidebar`'s `history-task` buttons now call a passed-down `onOpenTask(task.id)` instead of
just switching to the "tasks" tab). `TaskDetailView` has a "← All tasks" back link
(`navigate("tasks")`) above the same `TaskCard` used before; if the id doesn't match any loaded
task (removed, or not loaded yet) it shows a "Task not found" empty state instead of crashing.
The sidebar's "Tasks" nav item still highlights as active while on a task-detail page (`Sidebar`
receives `currentView="tasks"` for both the `"tasks"` and `"task-detail"` view states).

**Task deletion (current, added 2026-07-11):** a 🗑 icon-button deletes a task from both places
it can be viewed — the trailing icon-button on each `TaskListRow`, and one in `TaskCard`'s head
(`task-card-head-actions`, only rendered when an `onDelete` prop is passed) on the task-detail
page. Both call the same `deleteTask(task)` handler in `App`: `window.confirm`, then `DELETE
/api/tasks/:id`, then drop the id from local `tasks` state. `TaskListRow` is a `<div>` again
rather than a single `<button>` for this — the open-task action lives in a `.task-row-main`
button and the delete action is a sibling icon-button, since a `<button>` can't nest another
interactive element. Because the sidebar's "Task history" list and the "Tasks" count badge are
both derived from the same shared `tasks` state, a deleted task disappears from the sidebar for
free, no separate wiring needed. If you delete the task you're currently viewing on its detail
page, `deleteTask` redirects back to `/app/tasks` (comparing the deleted id against `taskDetailId`)
instead of leaving you on a "Task not found" page.

**Optimize button on step feedback (current, added 2026-07-11):** `StepFeedback`'s textarea (the
"Leave feedback for {agent}" form on a completed step, on the task-detail page) now has the same
`OptimizeButton` component used on the agent-directive and task-input fields, calling `POST
/api/optimize` with `kind: "agent_directive"` (feedback reads as durable instruction-like content
for the agent's future behavior, the closest semantic fit of the two existing `kind` values —
no new backend `kind` was added). Same "rewrite in place, no preview step" behavior as everywhere
else `OptimizeButton` is used.

**Iterate on a step's output (current, added 2026-07-11):** a completed step now has *two*
sibling toggle buttons side by side (`.step-actions`, a flex row that wraps whichever one is open
onto its own full-width line) — the existing "Leave feedback for {agent}" (`StepFeedback`,
unchanged: drafts a durable context update, never touches this task's output) and a new
"Iterate with more details" (`StepIterate`). `StepIterate`'s form — textarea, an `OptimizeButton`
with `kind="task_input"`, Cancel/Regenerate — calls `POST /api/tasks/:id/steps/:agentId/iterate`
via the new `iterateStep(taskId, agentId, details)` handler in `App`, which replaces that task in
local `tasks` state with the server's response on success. This is the one clear line the two
features draw: feedback only ever writes to the agent's `context` (shared, future tasks);
iterate only ever rewrites `step.output` on *this* task, never touches the agent's context. Since
the request is blocking (same pattern as `optimizeText`/`suggestContextFromFeedback`, not
fire-and-forget like task creation) but the backend still writes `step.phase` after every
internal phase, the independent 2s poll can flip the step's status to `"working"` mid-request —
which unmounts `StepIterate`'s open form early, before the awaited request actually resolves,
since both `StepFeedback` and `StepIterate` are gated on `step.status === "done"`. This is
harmless (the `iterateStep` handler that ultimately applies the new output lives in `App`, which
never unmounts) but does mean the form visibly closes slightly before the result is ready rather
than exactly when it's ready — accepted as a minor cosmetic gap, not a correctness bug (caught
via Playwright testing 2026-07-11: a naive "wait for the form to close" test assertion had to be
rewritten to "wait for step status done AND output changed" for exactly this reason).

**Iteration history (current, added 2026-07-11):** `StepIterationHistory` renders `step.iterations`
(see the `/iterate` route above) as a collapsed `<details>` — "Iteration history (N)" — placed
between `StepOutput` and the `.step-actions` row, so it's visible regardless of whether either
form is currently open. Newest first (the array itself is oldest-first, as written by the
backend; the component reverses it for display). Each entry shows its date, the `details` text
that was requested (quoted, to distinguish it from the app's own copy), and what the output *was*
before that iteration — `"Was: (an image)"` when `previousOutput` is `null`. Nothing here is
editable; it's a read-only log, same spirit as `ContextHistory` below.

**Loading-state animation on "Suggest update" / "Regenerate" / "Optimize with Gemini" (fixed
2026-07-11):** these buttons previously just swapped their label to static text ("Thinking…",
"Regenerating…", "Optimizing…") while awaiting a Gemini call that regularly takes 6-15+ seconds —
with no animation, that reads as a frozen/broken button well before it actually resolves (this is
what "suggest update doesn't work" turned out to be — the feature worked, but looked stuck).
"Suggest update"/"Regenerate" get a `loading` class (`.agent-instructions-actions .save.loading`)
that hides the label text and overlays an animated pulsing "●●●" (`@keyframes
save-loading-pulse`); `OptimizeButton` (used everywhere — agent directive, task input, step
feedback, iterate details, and now agent context, see below) reuses the same keyframes but
pulses the whole button's opacity instead, since its label already carries useful info
("Optimizing…") that hiding would lose.

**Manually editable agent context (current, added 2026-07-11):** `AgentSetupSummary`'s edit form
(`.agent-setup-editor`, a 2-column CSS grid) gained a `Context` textarea plus its own
`OptimizeButton` (`kind="agent_directive"`, same reasoning as the step-feedback one) — previously
`context` was shown read-only in the setup summary and could only be changed indirectly via the
feedback→suggest→apply flow (`POST /api/agents/:id/feedback`), never edited directly.
`agentToSetupForm()` and the form's `save()` now include `context` alongside every other setup
field, submitted through the same existing generic `PATCH /api/agents/:id` — no backend changes
needed, `context` was already a valid PATCH field. Both the new textarea and its `OptimizeButton`
needed an explicit `grid-column: 1 / -1` rule (`.agent-setup-editor .optimize-row`) to span the
full grid width like the other full-width fields; without it the button would only occupy one of
the two grid columns.

**Context history (current, added 2026-07-11):** `ContextHistory` renders `agent.contextHistory`
(see `PATCH /api/agents/:id` above) inside `AgentSetupSummary`'s read-only view, below the
existing field list — a collapsed `<details>`, "Context history (N)", newest entry first. Each
entry shows its date, a `"Manual edit"` or `"From feedback"` badge (`.context-history-source`,
colored to match), the quoted feedback text when the source was feedback, and the resulting
context value. This is what makes the "manual edit" vs "apply from feedback" distinction (see
`PATCH /api/agents/:id`'s new optional `feedback` body field above) actually visible — both paths
still end up as the exact same field (`agent.context`), and this history is the only place the
two are told apart after the fact. `applyAgentContext(id, context, feedback)` in `App` and
`StepFeedback`'s `apply()` were both updated to pass the original feedback text through;
`AgentSetupSummary`'s own `save()` never does, so its edits are always logged `"manual"`.

**Execution mode picker (current, added 2026-07-11):** `TaskDialog` has a Fast/Thorough radio
group (`executionModes` array — id, label, one-line description) below the task-input field,
defaulting to `"fast"` and reset on every dialog open. The chosen mode is submitted as
`executionMode` on `POST /api/tasks` (both the JSON and multipart paths — see "Execution modes
and phases" above) and echoed back on the task; `TaskCard` and `TaskListRow` both show a
"Fast"/"Thorough" label in their meta line when `task.executionMode` is present.

## Keeping this file accurate
Update this file whenever the API contract or the file structure above actually changes — not
just at project start. If you add a new agent field, a new route, or change how routing/
execution works, reflect it here so a fresh session doesn't have to re-derive it.
