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
- Images: Google Imagen API (`ai.models.generateImages`) for any agent whose `outputType` is
  `"image"` — currently `imagen-4.0-generate-001`. **Confirmed blocked on this key's free tier**
  ("Imagen 3 is only available on paid plans") as of 2026-07-11; unverified whether the account's
  new paid/pro billing setup resolves this — retest before relying on it for a demo. Google has
  also announced deprecation of standalone Imagen models for 2026-08-17 in favor of
  `gemini-2.5-flash-image` ("Nano Banana") — note that despite the "2.5" in its name this is an
  image-output model, a separate deprecation track from the `gemini-2.5-flash` *text* models
  above; don't assume it's affected by the same cutoff without checking.
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
- `outputType` — `"text" | "image" | "structured" | "feedback"`. `"image"` routes execution
  through Imagen instead of a normal Gemini `generateContent` call.
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

## Phased execution (added 2026-07-11)
Every text/structured/feedback agent step now runs as `TEXT_AGENT_PHASES` (currently 2)
sequential Gemini calls instead of one, via `runAgentPromptPhase()` in `geminiClient.js`, called
in a loop from `runChain()` in `orchestrator.js`. This is what powers `step.phase` in the API
contract above — real per-task phase labels (e.g. "Gathering" then "Summarizing") rather than a
static "Working" the whole time. Mechanics:
- Each call asks Gemini for structured JSON output (`responseMimeType: 'application/json'`,
  a `{ phase, content }` schema) — the model picks its own short gerund label for what that
  phase is doing, specific to the task at hand, not a hardcoded list.
- Phase 1's prompt asks for "the natural first part of the work" (research/gathering/drafting);
  the final phase's prompt hands back phase 1's `content` as context and asks for the finished
  answer. Only the *last* phase's `content` becomes the step's actual `output` — earlier phases'
  content is intermediate work product, never shown to the user directly.
- `step.phase` is written back to the store (`saveTask`) after every phase completes, so
  `GET /api/tasks` reflects the current phase mid-execution, not just at the end.
- Image agents (`outputType: 'image'`) are unaffected — Imagen has no equivalent notion of an
  intermediate phase, so they still run as a single `generateImage()` call.
- Cost/latency tradeoff: this roughly doubles Gemini calls (and therefore latency and token
  spend) for every non-image agent step. Accepted as worthwhile for the demo; revisit
  `TEXT_AGENT_PHASES` if either becomes a problem.

**Web access (added 2026-07-11):** every `runAgentPromptPhase()` call passes
`tools: [{ urlContext: {} }, { googleSearch: {} }]` — real Gemini API tools, not agent-to-agent
function calling (that's a separate `tools` config, only used by `askOrchestrator()` for routing).
`urlContext` lets the model fetch and read specific URLs mentioned in its input (e.g. "summarize
the reviews at this link"); `googleSearch` grounds answers in live search results instead of only
training-data knowledge. Confirmed compatible with `responseSchema`/JSON mode by testing directly
against the API before rolling this out. The system instruction in `runAgentPromptPhase()` tells
the model it has this access so it actually uses it rather than guessing. **Before this, no agent
in this codebase — in any prior commit — had any real web/search/fetch capability**; anything
that looked like it (e.g. summarizing "the reviews at this Google link") was the model producing
plausible-sounding text from training data, not genuinely reading the page. Image agents don't
get this — Imagen's `generateImages` call has no `tools` support.

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
  model, style, inspiredBy, context`)
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
  codebase prevented this before, even at creation). At least one field must be provided.
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
- `GET /api/tasks` → task feed, newest first. Each task: `{ id, input, status, steps[],
  createdAt, file, fileWarning? }`. Each step: `{ agentId, status, output, phase? }`, step status
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
  - `Content-Type: application/json`, body `{ input: "...", agentId?: "writer" }` — no
    attachment. When `agentId` is supplied, the task targets that agent and automatically
    includes its declared upstream dependencies; without it, Gemini chooses the chain.
  - `Content-Type: multipart/form-data`, fields `input` (text) and `file` (the upload) — for
    tasks with an attachment. `input` is still required and validated the same way either way.
    Max upload size 20MB, one file per task. The response's `file` field reflects what was
    attached (or `null` for the JSON path).
- `POST /api/tasks/:id/cancel` → cooperatively cancels a pending/working task, marks unfinished
  steps `cancelled`, and returns involved agents to `idle`. An in-flight provider request cannot
  be forcibly terminated, but its eventual result is discarded and cannot revive the task.
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
    geminiClient.js    — runAgentPrompt() (specialist text gen, optionally attaches a file via
                         the Gemini Files API), askOrchestrator() (routing via function calling),
                         suggestContextFromFeedback() (drafts a context update from step
                         feedback, or null if nothing durable), draftTeamForBusiness() (drafts a
                         starting roster for the mandatory onboarding flow, structured JSON
                         output) — none of the draft/suggestion calls run automatically
    imagenClient.js    — generateImage(), returns a data:image/png;base64,... string
    persistence.js     — shared Redis client (`@upstash/redis`) built from KV/Upstash env vars,
                         or null if neither is set; agentStore/taskStore both branch on this
    taskStore.js       — task feed (createTask, getAllTasks, getTaskById, saveTask — write-back
                         after mutating a fetched task), Redis-backed via persistence.js with an
                         in-memory fallback
  orchestrator.js      — pickChainForTask() (routing + dependency expansion), runChain()
                         (level-based execution, sequential deps + parallel independents, hands
                         an optional file buffer to accepting root agents)
  routes/
    agents.js          — GET/POST/PATCH/DELETE /api/agents, with validation; POST /:id/feedback
                         drafts a context suggestion from feedback without persisting it;
                         POST /draft-team drafts a starting roster from a business
                         description/goal/term, also without persisting anything
    tasks.js           — GET/POST /api/tasks, with validation; multer (memory storage) parses
                         an optional multipart file upload alongside the JSON path
  app.js               — Express app wiring (routes, CORS, JSON/error middleware, /health):
                         the shared module imported by both server.js and api/[...path].js
  server.js             — local dev entrypoint only: loads .env, calls app.listen()
api/
  [...path].js          — Vercel serverless entrypoint, re-exports the same Express app from
                         src/app.js. Agent/Task state now persists via Redis (see Storage above)
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
The sidebar reports backend/key readiness. Browser `localStorage` is no longer the source of
truth; both backend stores are in memory and reset when the backend restarts.

**Business onboarding (current, mandatory on an empty roster):** `BusinessOnboarding` replaces
the manual creation form entirely until at least one agent exists — there is no "skip this" or
"create manually instead" path. Two required steps: (1) an intake form (business description,
goal, and a short-/long-term `<select>`, all `required`) that calls `POST
/api/agents/draft-team`; (2) a review step listing every drafted agent as an editable card
(Name/Specialty/directive/Tone, plus a Context field only shown for `term: "long"`, since
short-term drafts don't get one) with a per-card remove button. Nothing is created during
drafting — "Add N agents to Bullpen" loops the kept rows through the same `onCreate` handler
the manual form uses (`POST /api/agents`, one call per agent, sequential), and any card the
user removed just never gets created. Same "preview, never silent" pattern as every other
Gemini-assisted feature in this app.

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

**Optimize button on step feedback (current, added 2026-07-11):** `StepFeedback`'s textarea (the
"Leave feedback for {agent}" form on a completed step, on the task-detail page) now has the same
`OptimizeButton` component used on the agent-directive and task-input fields, calling `POST
/api/optimize` with `kind: "agent_directive"` (feedback reads as durable instruction-like content
for the agent's future behavior, the closest semantic fit of the two existing `kind` values —
no new backend `kind` was added). Same "rewrite in place, no preview step" behavior as everywhere
else `OptimizeButton` is used.

## Keeping this file accurate
Update this file whenever the API contract or the file structure above actually changes — not
just at project start. If you add a new agent field, a new route, or change how routing/
execution works, reflect it here so a fresh session doesn't have to re-derive it.
