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
- LLM: Google Gemini API via `@google/genai` for specialist agent text generation, and for
  orchestrator routing decisions via Gemini function calling
- Images: Google Imagen API (`ai.models.generateImages`) for any agent whose `outputType` is
  `"image"` — currently `imagen-4.0-generate-001`. Google has announced deprecation of
  standalone Imagen models for 2026-08-17 in favor of `gemini-2.5-flash-image` ("Nano
  Banana") — if that lands before the demo, swap the model id in `src/lib/imagenClient.js`.
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
  inputType, outputType, dependsOnAgent, tone, status, acceptsFiles, specialty, directive,
  model, style, inspiredBy`)
- `POST /api/agents` → body `{ name, role, inputType, outputType, dependsOnAgent, tone,
  acceptsFiles }`, creates an agent. `name/role/inputType/outputType` required;
  `dependsOnAgent` must reference an existing agent id if provided; `acceptsFiles` optional
  boolean, defaults to `false`. `specialty`, `directive`, `model`, `style`, and `inspiredBy`
  are optional; model is validated against the supported Gemini 2.5 text models. Tone, style,
  and inspiration are included in the specialist system prompt.
- `PATCH /api/agents/:id` → body may contain `{ model, directive, specialty }`; changes the
  agent's model or editable instructions without recreating it.
- `DELETE /api/agents/:id` → removes an agent unless another agent depends on it (409).
- `GET /health` → `{ ok, geminiConfigured }`; reports key presence without exposing the key.
- `GET /api/tasks` → task feed, newest first. Each task: `{ id, input, status, steps[],
  createdAt, file, fileWarning? }`. Each step: `{ agentId, status, output }`, step status one of
  `pending|working|done|error`. `file` is `{ name, mimeType } | null` — metadata only, set when
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

## File structure
```
src/
  agents/
    Agent.js          — Agent class: buildSystemPrompt, toFunctionDeclaration, toJSON
    agentStore.js      — in-memory agent registry, seeds the 4 default agents
  lib/
    models.js          — supported per-agent Gemini model ids and default model
    geminiClient.js    — runAgentPrompt() (specialist text gen, optionally attaches a file via
                         the Gemini Files API), askOrchestrator() (routing via function calling)
    imagenClient.js    — generateImage(), returns a data:image/png;base64,... string
    taskStore.js       — in-memory task feed (createTask, getAllTasks, getTaskById)
  orchestrator.js      — pickChainForTask() (routing + dependency expansion), runChain()
                         (level-based execution, sequential deps + parallel independents, hands
                         an optional file buffer to accepting root agents)
  routes/
    agents.js          — GET/POST/PATCH/DELETE /api/agents, with validation
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

**Historical note (superseded):** `App.jsx` previously persisted
everything to `localStorage` (key `bullpen-workspace-v1`) and never calls `fetch` against
`/api/*`. Its data shapes also don't match the API contract above:
- Frontend agent: `{ id, name, role (from a fixed 6-item specialty list), directive, status:
  "ACTIVE", createdAt }` — no `inputType`/`outputType`/`dependsOnAgent`/`tone`; `directive` and
  the specialty enum don't exist on the backend.
- Frontend task: `{ id, agentId, objective, priority, status: "DRAFT" }` — manually assigned to
  one agent by the user, no `steps[]`, no polling loop, `status` values don't match
  `pending|working|done|error`.

**Superseded plan (the API integration above has landed):** rework `AgentDialog`'s "Specialty" field into an
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

## Keeping this file accurate
Update this file whenever the API contract or the file structure above actually changes — not
just at project start. If you add a new agent field, a new route, or change how routing/
execution works, reflect it here so a fresh session doesn't have to re-derive it.
