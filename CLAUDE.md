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
- LLM: Google Gemini API via `@google/genai`, model `gemini-3.5-flash`, for specialist agent
  text generation and orchestrator routing decisions via Gemini function calling.
  `gemini-2.5-flash` (used originally) was pulled from new API keys 2026-07-09 — if
  `gemini-3.5-flash` ever meets the same fate, check `ai.google.dev/gemini-api/docs/deprecations`
  and swap the model constants in `src/lib/geminiClient.js`.
- Images: `gemini-2.5-flash-image` ("Nano Banana") via `ai.models.generateContent` with
  `config.responseModalities: [Modality.TEXT, Modality.IMAGE]`, for any agent whose `outputType`
  is `"image"` (`src/lib/imagenClient.js`). Originally built against standalone Imagen
  (`imagen-4.0-generate-001` via `ai.models.generateImages`) but switched because **Imagen
  requires a paid Google AI plan** ("Imagen 3 is only available on paid plans") while
  `gemini-2.5-flash-image` has its own free-tier quota — see "API quotas & billing" below.
- Storage: in-memory only (array/Map in module scope) — no database. This is intentional for a
  12-hour build; do not introduce persistence unless asked.
- No websockets — the frontend polls `GET /api/tasks` every ~2s for progress.

## Core concept: agents as objects
Every specialist agent is an instance of the `Agent` class (`src/agents/Agent.js`) with:
- `id` — stable slug (e.g. `"writer"`), also used as the Gemini function-call name for routing
- `name`, `role` (job description, feeds into both its system prompt and its function
  declaration's description)
- `inputType` — what it expects (e.g. `"topic"`, `"agent_output"`)
- `outputType` — `"text" | "image" | "structured" | "feedback"`. `"image"` routes execution
  through `imagenClient.generateImage()` (`gemini-2.5-flash-image`) instead of the plain-text
  `runAgentPrompt()` path — both go through `generateContent` under the hood.
- `dependsOnAgent` — id of an upstream agent whose output feeds this agent's input, or `null`
  if it can run standalone from the raw task input
- `tone` (optional flavor for the system prompt)
- `status` — `"idle" | "working"`
- `acceptsFiles` — boolean, default `false`. If true and this agent has no `dependsOnAgent`
  (i.e. it's an entry point that receives the raw task input), a file attached to the task gets
  uploaded via the Gemini Files API and included alongside its text prompt. See "File uploads"
  below.
- `styleReference` — string or `null`. An enriched summary of a style/artist/framework the agent
  should apply (e.g. "Studio Ghibli" → a few sentences on how to apply that look), appended to
  its system prompt as "Apply this style/approach: ...". Set once at creation, never raw user
  input — see "Style enrichment" below.

This object model is what lets the orchestrator build both single-agent tasks and multi-step
pipelines generically, without hardcoding per-agent logic anywhere.

Default seeded agents (`src/agents/agentStore.js`): `researcher` (`acceptsFiles: true`),
`writer`, `designer` (depends on `writer`), `artist` (depends on `designer`,
`outputType: "image"`). Example pipeline: a task asking for a finished promotional image routes
through `writer → designer → artist`, each step's output feeding the next.

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

## Locked API contract
- `GET /api/agents` → array of agent objects (`Agent.toJSON()` shape: `id, name, role,
  inputType, outputType, dependsOnAgent, tone, status, acceptsFiles, styleReference`)
- `POST /api/agents` → body `{ name, role, inputType, outputType, dependsOnAgent, tone,
  acceptsFiles, styleReference }`, creates an agent. `name/role/inputType/outputType` required;
  `dependsOnAgent` must reference an existing agent id if provided; `acceptsFiles` optional
  boolean, defaults to `false`. `styleReference` optional string — **the request sends raw free
  text (e.g. "Studio Ghibli"), the response returns the enriched result of that text (or
  `null`)**, same field name both directions. See "Style enrichment" below.
- `GET /api/tasks` → task feed, newest first. Each task: `{ id, input, status, steps[],
  createdAt, file, fileWarning? }`. Each step: `{ agentId, status, output }`, step status one of
  `pending|working|done|error`. `file` is `{ name, mimeType } | null` — metadata only, set when
  the task was created with an attachment. `fileWarning` is only present (a string) when a file
  was attached but no agent in the resolved chain could use it — see "File uploads" below.
- `POST /api/tasks` → creates and kicks off a task, returns it **immediately** with empty
  `steps` and `status: "pending"`. Execution (routing + running each agent) continues
  asynchronously; the frontend polls `GET /api/tasks` to watch `steps` fill in and `status`
  progress to `working` → `done`/`error`. Two ways to call it, both still supported:
  - `Content-Type: application/json`, body `{ input: "..." }` — unchanged, no attachment.
  - `Content-Type: multipart/form-data`, fields `input` (text) and `file` (the upload) — for
    tasks with an attachment. `input` is still required and validated the same way either way.
    Max upload size 20MB, one file per task. The response's `file` field reflects what was
    attached (or `null` for the JSON path).

## File structure
```
src/
  agents/
    Agent.js          — Agent class: buildSystemPrompt, toFunctionDeclaration, toJSON
    agentStore.js      — in-memory agent registry, seeds the 4 default agents
  lib/
    geminiClient.js    — runAgentPrompt() (specialist text gen, optionally attaches a file via
                         the Gemini Files API), askOrchestrator() (routing via function calling),
                         runStyleEnrichmentPrompt() (raw one-time enrichment call)
    enrichStyle.js      — enrichStyleReference(): fail-safe wrapper around
                         runStyleEnrichmentPrompt() — always resolves to a string or null, never
                         throws
    imagenClient.js    — generateImage(), returns a data:image/png;base64,... string
    taskStore.js       — in-memory task feed (createTask, getAllTasks, getTaskById)
  orchestrator.js      — pickChainForTask() (routing + dependency expansion), runChain()
                         (level-based execution, sequential deps + parallel independents, hands
                         an optional file buffer to accepting root agents)
  routes/
    agents.js          — GET/POST /api/agents, with validation
    tasks.js           — GET/POST /api/tasks, with validation; multer (memory storage) parses
                         an optional multipart file upload alongside the JSON path
  server.js             — Express app wiring, JSON/error middleware, seeds agents on boot
scripts/
  test-requests.js      — `npm run test:api`, exercises agent creation, single-agent task,
                         and full media pipeline against a running local server
frontend/                — see "Frontend" section below
```

## Environment
- `GEMINI_API_KEY` required (`.env`, see `.env.example`). Server logs a warning on boot if
  missing rather than crashing, so `GET /api/agents` etc. still work without a key.
- `PORT` optional, defaults to 3000.

## API quotas & billing
Verified live against a real key on 2026-07-11 — worth knowing before relying on this for a
demo:
- **The free tier's daily cap is easy to blow through.** `gemini-3.5-flash` free tier is limited
  to **20 requests/day per project** (separate from a much tighter per-minute cap). Every single
  task burns at least 2 of those (1 orchestrator routing call + ≥1 agent call); a full
  `writer → designer → artist` pipeline burns 4. ~5 pipeline tasks exhausts the whole day —
  `enrichStyleReference` calls and single-agent tasks count against the same daily bucket too.
  Once exhausted, *every* task fails at the routing step (`pickChainForTask` needs
  `gemini-3.5-flash`), not just the expensive ones.
- **Imagen is paid-plan-only, full stop** — not a quota issue, a hard `400`: "Imagen 3 is only
  available on paid plans." This is why image generation goes through `gemini-2.5-flash-image`
  instead (see Tech stack above), which does have its own free-tier allowance.
- **Billing is prepaid credits, not literal "buy N tokens."** Enabling billing in AI Studio
  (Projects page → "Set up billing" → link a Cloud Billing account → pay) buys a dollar balance,
  minimum **$10**, that gets drawn down per-token as you use the API; credits expire after 12
  months. There's no separate postpay/invoice option until Tier 3 (`$1,000+` spent over 30+
  days) — not relevant at hackathon scale.
- **At this project's usage pattern, $10 goes a long way.** Paid-tier pricing: `gemini-3.5-flash`
  is $1.50/1M input tokens, $9.00/1M output tokens; `gemini-2.5-flash-image` is $0.30/1M input,
  ~$0.039/generated image (flat, not per-token). A full 4-step pipeline task (routing + writer +
  designer + artist) is roughly $0.05–0.08 all-in — the $10 minimum covers well over 100 full
  pipeline runs, so it's not a "how many tokens" sizing problem, it's "clear the free tier's
  request-count wall." The $10 minimum is enough for the whole hackathon plus the demo with
  margin to spare.

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

## Style enrichment
An agent can optionally be given a free-text style/reference at creation (e.g. "Studio Ghibli",
"AIDA framework") that gets turned into a short practical instruction baked into its system
prompt — this is a **one-time step at agent creation only**, never a per-task call:
- `routes/agents.js` takes `body.styleReference` (raw text) and calls
  `enrichStyle.enrichStyleReference(raw)` before ever calling `addAgent()`.
- `enrichStyleReference` asks Gemini (`geminiClient.runStyleEnrichmentPrompt`) to judge the
  input: if it's a real, recognizable style/artist/framework/example, it returns a 2-3 sentence
  practical summary of how to apply it; if not, the model responds with exactly `NONE`, which
  `enrichStyleReference` converts to `null`.
- **Fail-safe by construction**: `enrichStyleReference` catches everything internally (network
  errors, API failures, unexpected responses) and resolves to `null` on any failure, logging the
  error server-side via `console.error` — it never throws, so it can never block or fail agent
  creation. An empty/missing `styleReference` in the request skips the Gemini call entirely and
  resolves straight to `null`.
- The resolved value (enriched summary or `null`) is what actually gets stored on the agent and
  returned in the `POST /api/agents` response — never the raw input.
- `Agent.buildSystemPrompt()` appends `"Apply this style/approach: {styleReference}"` when set.

## Frontend
Built by a teammate in `frontend/` — React 19 + Vite 8, plain CSS (no framework), ES modules.
No shared workspace/monorepo tooling; it has its own `package.json` and is run independently
(`cd frontend && npm run dev`, served by Vite on its own port, separate from the backend's
`PORT`).

```
frontend/
  src/
    App.jsx            — entire app: Sidebar, Topbar, AgentsView/TasksView, AgentDialog,
                         TaskDialog, Toast, all in one file
    main.jsx            — React root, imports the three CSS files
  css/
    theme.css, layout.css, components.css
  images/
    bullpen-transparent.png — logo
  index.html, vite.config.js, package.json
```

**Current state (as of last review): not yet wired to the backend.** `App.jsx` persists
everything to `localStorage` (key `bullpen-workspace-v1`) and never calls `fetch` against
`/api/*`. Its data shapes also don't match the API contract above:
- Frontend agent: `{ id, name, role (from a fixed 6-item specialty list), directive, status:
  "ACTIVE", createdAt }` — no `inputType`/`outputType`/`dependsOnAgent`/`tone`; `directive` and
  the specialty enum don't exist on the backend.
- Frontend task: `{ id, agentId, objective, priority, status: "DRAFT" }` — manually assigned to
  one agent by the user, no `steps[]`, no polling loop, `status` values don't match
  `pending|working|done|error`.

**Planned next step (agreed with the user):** rework `AgentDialog`'s "Specialty" field into an
"Agent" dropdown of full templates mirroring the backend's seeded agents (Researcher / Writer /
Designer / Artist — same `role`, `inputType`, `outputType`, `dependsOnAgent`, `tone`), plus a
"Create your own" option that unlocks all those fields for manual entry. Submit always
`POST /api/agents`, after checking `GET /api/agents` for a name collision (skip re-posting a
template that's already on the shared roster — the backend auto-suffixes colliding ids rather
than erroring, which would otherwise create silent duplicates like `writer_2`).

Landing that also requires the larger, not-yet-scoped rewiring: `AgentsView` should source from
`GET /api/agents` instead of `localStorage`, and the task flow needs to drop "assign to one
agent" in favor of the orchestrator model (submit raw `input`, poll `GET /api/tasks`, render
`steps[]` as they fill in) — flag this file as stale once that lands and rewrite this section
to describe what's actually wired up.

When that task-flow rewiring happens, the task composer needs a file input too (see "File
uploads" above): if a file is attached, submit `POST /api/tasks` as `multipart/form-data`
(fields `input` + `file`) instead of JSON; render `task.file.name` on the task feed card when
present (e.g. "📎 report.pdf"), and if `task.fileWarning` is present, show it as an inline
warning on that card (e.g. "⚠ file not used — no agent in this chain accepts uploads") rather
than pretending the attachment did something. The custom-agent form from `AgentDialog` should
also grow an "Accepts file uploads" checkbox mapped to `acceptsFiles` — irrelevant for template
agents since those mirror the backend seeds (`researcher` is the only one currently `true`).

Same form should also grow an optional "Style or reference" text input (see "Style enrichment"
above) — send whatever the user typed as `styleReference` in the `POST /api/agents` body, then
read back the *response's* `styleReference` (not what the user typed) to show what was actually
understood, e.g. "Style applied: AIDA framework — Attention, Interest, Desire, Action." If the
response's `styleReference` is `null` (nonsense input, or the enrichment call failed), show
nothing rather than an error — creation still succeeded either way.

## Keeping this file accurate
Update this file whenever the API contract or the file structure above actually changes — not
just at project start. If you add a new agent field, a new route, or change how routing/
execution works, reflect it here so a fresh session doesn't have to re-derive it.
