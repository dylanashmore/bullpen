import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import logoUrl from "../images/bull-head.png";

const INTRO_KEY = "bullpen-intro-seen-v4";
const POLL_INTERVAL_MS = 2000;

const specialties = [
  "Research",
  "Writing",
  "Software development",
  "Data analysis",
  "Customer support",
  "Project management",
];

const CUSTOM_SPECIALTY = "__custom__";
const CUSTOM_INPUT_TYPE = "__custom_input__";

const inputTypes = [
  { value: "topic", label: "Topic or request" },
  { value: "agent_output", label: "Another agent's output" },
  { value: "document", label: "Document or file" },
  { value: "data", label: "Structured data" },
];

const outputTypes = [
  { value: "text", label: "Text" },
  { value: "image", label: "Image" },
  { value: "structured", label: "Structured data" },
  { value: "feedback", label: "Feedback" },
];

const geminiModels = [
  { id: "gemini-2.5-flash-lite", label: "Flash-Lite", hint: "Fast" },
  { id: "gemini-2.5-flash", label: "Flash", hint: "Balanced" },
  { id: "gemini-2.5-pro", label: "Pro", hint: "Deep" },
];

const DEFAULT_MODEL = "gemini-2.5-flash";

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function AgentsIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
}

function TasksIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>;
}

function MenuIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>;
}

function shouldShowIntro() {
  try {
    return sessionStorage.getItem(INTRO_KEY) !== "true";
  } catch {
    return true;
  }
}

function IntroSequence({ onComplete }) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onComplete();
      return undefined;
    }
    const taglineTimer = window.setTimeout(() => setStage(1), 1900);
    const welcomeTimer = window.setTimeout(() => setStage(2), 4200);
    const completeTimer = window.setTimeout(onComplete, 6200);
    return () => {
      window.clearTimeout(taglineTimer);
      window.clearTimeout(welcomeTimer);
      window.clearTimeout(completeTimer);
    };
  }, []);

  return (
    <div className="intro-overlay" role="presentation">
      {stage === 0 && <div className="intro-stage intro-logo-stage"><img className="intro-logo" src={logoUrl} alt="Bullpen" /></div>}
      {stage === 1 && <div className="intro-stage intro-tagline-stage"><p>the AI pitchers your business needs</p></div>}
      {stage === 2 && <div className="intro-stage intro-welcome-stage"><p>Welcome to the <span>Bullpen</span></p></div>}
      <button className="intro-skip" type="button" onClick={onComplete}>Skip intro</button>
    </div>
  );
}

function Sidebar({ currentView, taskCount, open, connection, onNavigate }) {
  const connectionCopy = !connection.online
    ? { title: "Backend offline", detail: "Start the server on port 3000", state: "offline" }
    : connection.geminiConfigured
      ? { title: "Gemini connected", detail: "Agents are ready to work", state: "ready" }
      : { title: "Backend connected", detail: "Add GEMINI_API_KEY to run tasks", state: "waiting" };

  return (
    <aside className={`sidebar${open ? " open" : ""}`} aria-label="Main navigation">
      <button className="brand" type="button" onClick={() => onNavigate("agents")} aria-label="Bullpen home">
        <span className="brand-logo-frame"><img src={logoUrl} alt="" /></span><span>Bullpen</span>
      </button>
      <nav className="nav-list">
        <button className={`nav-item${currentView === "agents" ? " active" : ""}`} type="button" onClick={() => onNavigate("agents")} aria-current={currentView === "agents" ? "page" : undefined}>
          <AgentsIcon /> Agents
        </button>
        <button className={`nav-item${currentView === "tasks" ? " active" : ""}`} type="button" onClick={() => onNavigate("tasks")} aria-current={currentView === "tasks" ? "page" : undefined}>
          <TasksIcon /> Tasks
          {taskCount > 0 && <span className="nav-count">{taskCount}</span>}
        </button>
      </nav>
      <div className={`sidebar-note ${connectionCopy.state}`}>
        <span className="signal-dot" aria-hidden="true" />
        <div><strong>{connectionCopy.title}</strong><span>{connectionCopy.detail}</span></div>
      </div>
    </aside>
  );
}

function ModelSlider({ value, onChange, disabled = false }) {
  const selectedIndex = Math.max(0, geminiModels.findIndex((model) => model.id === value));
  const [sliderValue, setSliderValue] = useState(selectedIndex);
  const lastCommittedIndex = useRef(selectedIndex);
  const previewIndex = Math.max(0, Math.min(geminiModels.length - 1, Math.round(sliderValue)));
  const previewModel = geminiModels[previewIndex];

  useEffect(() => {
    setSliderValue(selectedIndex);
    lastCommittedIndex.current = selectedIndex;
  }, [selectedIndex]);

  function commit(nextValue = sliderValue) {
    const nextIndex = Math.max(0, Math.min(geminiModels.length - 1, Math.round(Number(nextValue))));
    setSliderValue(nextIndex);
    if (nextIndex !== lastCommittedIndex.current) {
      lastCommittedIndex.current = nextIndex;
      onChange(geminiModels[nextIndex].id);
    }
  }

  function handleKeyDown(event) {
    const keys = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };
    if (event.key in keys) {
      event.preventDefault();
      commit(selectedIndex + keys[event.key]);
    } else if (event.key === "Home") {
      event.preventDefault();
      commit(0);
    } else if (event.key === "End") {
      event.preventDefault();
      commit(geminiModels.length - 1);
    }
  }

  return (
    <fieldset className="model-control" disabled={disabled}>
      <legend><span><span className="model-red-dot" aria-hidden="true" />Gemini model</span><output>Gemini {previewModel.label} · {previewModel.hint}</output></legend>
      <div className="model-range-wrap">
        <input
          className="model-range"
          type="range"
          min="0"
          max={geminiModels.length - 1}
          step="0.01"
          value={sliderValue}
          aria-label="Gemini model"
          aria-valuetext={`Gemini ${previewModel.label}, ${previewModel.hint}`}
          style={{ "--model-progress": `${(sliderValue / (geminiModels.length - 1)) * 100}%` }}
          onChange={(event) => setSliderValue(Number(event.target.value))}
          onPointerUp={(event) => commit(event.currentTarget.value)}
          onPointerCancel={(event) => commit(event.currentTarget.value)}
          onBlur={(event) => commit(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="model-range-labels" aria-hidden="true">
          {geminiModels.map((model, index) => <span className={index === previewIndex ? "active" : ""} key={model.id}>{model.label}</span>)}
        </div>
      </div>
    </fieldset>
  );
}

function QuickCreateAgent({ availableAgents = [], onCreate, disabled }) {
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState(specialties[0]);
  const [customSpecialty, setCustomSpecialty] = useState("");
  const [directive, setDirective] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [inputType, setInputType] = useState("topic");
  const [customInputType, setCustomInputType] = useState("");
  const [outputType, setOutputType] = useState("text");
  const [dependsOnAgent, setDependsOnAgent] = useState("");
  const [acceptsFiles, setAcceptsFiles] = useState(false);
  const [tone, setTone] = useState("");
  const [style, setStyle] = useState("");
  const [inspiredBy, setInspiredBy] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const resolvedSpecialty = specialty === CUSTOM_SPECIALTY ? customSpecialty.trim() : specialty;
    const resolvedInputType = inputType === CUSTOM_INPUT_TYPE ? customInputType.trim() : inputType;
    if (!resolvedSpecialty || !resolvedInputType) return;
    setSaving(true);
    const created = await onCreate({
      name: name.trim(),
      specialty: resolvedSpecialty,
      directive: directive.trim(),
      model,
      inputType: resolvedInputType,
      outputType,
      dependsOnAgent: dependsOnAgent || null,
      acceptsFiles: dependsOnAgent ? false : acceptsFiles,
      tone: tone.trim() || null,
      style: style.trim() || null,
      inspiredBy: inspiredBy.trim() || null,
    });
    setSaving(false);
    if (!created) return;
    setName("");
    setSpecialty(specialties[0]);
    setCustomSpecialty("");
    setDirective("");
    setModel(DEFAULT_MODEL);
    setInputType("topic");
    setCustomInputType("");
    setOutputType("text");
    setDependsOnAgent("");
    setAcceptsFiles(false);
    setTone("");
    setStyle("");
    setInspiredBy("");
  }

  return (
    <form className="agent-card quick-agent-card" onSubmit={submit}>
      <div className="quick-card-heading"><span className="quick-add-mark" aria-hidden="true">+</span><div><h2>New agent</h2><p>Fill in the card and add it to your team.</p></div></div>
      <label className="quick-field"><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} required maxLength="32" placeholder="e.g. Scout" /></label>
      <label className="quick-field">
        <span>Specialty</span>
        <select value={specialty} onChange={(event) => setSpecialty(event.target.value)}>
          {specialties.map((item) => <option key={item}>{item}</option>)}
          <option value={CUSTOM_SPECIALTY}>Create your own…</option>
        </select>
      </label>
      {specialty === CUSTOM_SPECIALTY && (
        <label className="quick-field custom-specialty-field">
          <span>Custom specialty</span>
          <input value={customSpecialty} onChange={(event) => setCustomSpecialty(event.target.value)} required maxLength="48" autoFocus placeholder="e.g. Sales enablement" />
        </label>
      )}
      <label className="quick-field"><span>How should this agent work?</span><textarea value={directive} onChange={(event) => setDirective(event.target.value)} required maxLength="240" rows="2" placeholder="Describe its instructions, expertise, and working style." /></label>
      <details className="advanced-agent-settings">
        <summary><span>Advanced setup</span><small>Inputs, outputs, dependencies, and style</small></summary>
        <div className="advanced-settings-grid">
          <label className="quick-field">
            <span>Input type</span>
            <select value={inputType} onChange={(event) => setInputType(event.target.value)}>
              {inputTypes.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
              <option value={CUSTOM_INPUT_TYPE}>Create your own…</option>
            </select>
          </label>
          {inputType === CUSTOM_INPUT_TYPE && <label className="quick-field custom-input-type"><span>Custom input type</span><input value={customInputType} onChange={(event) => setCustomInputType(event.target.value)} required maxLength="48" placeholder="e.g. Customer interview" /></label>}
          <label className="quick-field"><span>Output type</span><select value={outputType} onChange={(event) => setOutputType(event.target.value)}>{outputTypes.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
          <label className="quick-field"><span>Depends on</span><select value={dependsOnAgent} onChange={(event) => { setDependsOnAgent(event.target.value); if (event.target.value) setAcceptsFiles(false); }}><option value="">No dependency</option>{availableAgents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select></label>
          <label className="quick-field"><span>Tone</span><input value={tone} onChange={(event) => setTone(event.target.value)} maxLength="80" placeholder="e.g. Confident and concise" /></label>
          <label className="quick-field full-width"><span>Visual style</span><input value={style} onChange={(event) => setStyle(event.target.value)} maxLength="120" placeholder="e.g. Editorial, minimal, cinematic" /></label>
          <label className="quick-field full-width"><span>Inspired by</span><input value={inspiredBy} onChange={(event) => setInspiredBy(event.target.value)} maxLength="120" placeholder="e.g. Swiss design or Stripe's website" /></label>
          <label className={`file-capability-toggle${dependsOnAgent ? " disabled" : ""}`}><input type="checkbox" checked={acceptsFiles} onChange={(event) => setAcceptsFiles(event.target.checked)} disabled={Boolean(dependsOnAgent)} /><span><strong>Accept file uploads</strong><small>{dependsOnAgent ? "Only entry-point agents receive files" : "Allow files when this agent starts a task"}</small></span></label>
          <button className="minimize-advanced" type="button" onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}><span>Minimize advanced setup</span><span aria-hidden="true">↑</span></button>
        </div>
      </details>
      {outputType === "image" ? <div className="image-model-note"><span className="model-red-dot" />Uses the Imagen image model</div> : <ModelSlider value={model} onChange={setModel} disabled={saving || disabled} />}
      <button className="button primary quick-submit" type="submit" disabled={saving || disabled}><span aria-hidden="true">+</span>{saving ? "Adding…" : "Add to Bullpen"}</button>
    </form>
  );
}

function EmptyAgents({ onCreate, connection }) {
  return (
    <div className="empty-state">
      <div className="empty-visual" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="empty-logo-frame"><img src={logoUrl} alt="" /></div><span className="spark spark-one">✦</span><span className="spark spark-two">✦</span></div>
      <span className="eyebrow">Welcome to Bullpen</span>
      <h1>Build your first AI agent</h1>
      <p>Give your agent a name, choose its specialty, and describe the job. That is all you need to get started.</p>
      {!connection.online && <div className="connection-alert">Start the backend with <code>npm run dev</code> before adding an agent.</div>}
      <QuickCreateAgent onCreate={onCreate} disabled={!connection.online} />
      <div className="empty-footnote"><span className="gemini-glyph" aria-hidden="true">✦</span>{connection.geminiConfigured ? "Gemini is ready" : "Add your Gemini API key to run agent tasks"}</div>
    </div>
  );
}

function AgentInstructions({ agent, onUpdate }) {
  const [directive, setDirective] = useState(agent.directive || agent.role || "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const savedDirective = agent.directive || agent.role || "";
  const changed = directive.trim() !== savedDirective.trim();

  useEffect(() => setDirective(savedDirective), [savedDirective]);

  async function save() {
    if (!directive.trim() || !changed) return;
    setSaving(true);
    const updated = await onUpdate(agent.id, directive.trim());
    setSaving(false);
    if (updated) setEditing(false);
  }

  return (
    <div className="agent-instructions">
      <div className="agent-instructions-head"><span>Instructions</span>{!editing && <button type="button" onClick={() => setEditing(true)}>Edit</button>}</div>
      {editing ? (
        <>
          <textarea value={directive} onChange={(event) => setDirective(event.target.value)} rows="3" maxLength="500" aria-label={`Instructions for ${agent.name}`} autoFocus />
          <div className="agent-instructions-actions"><button type="button" onClick={() => { setDirective(savedDirective); setEditing(false); }}>Cancel</button><button className="save" type="button" onClick={save} disabled={!changed || !directive.trim() || saving}>{saving ? "Saving…" : "Save instructions"}</button></div>
        </>
      ) : <p>{savedDirective}</p>}
    </div>
  );
}

function AgentSetupSummary({ agent, dependencyName }) {
  const items = [
    ["Input", agent.inputType],
    ["Output", agent.outputType],
    ["Depends on", dependencyName || "None"],
    ["Files", agent.acceptsFiles ? "Accepted" : "Not accepted"],
    ["Tone", agent.tone || "Default"],
    ["Style", agent.style || "Default"],
    ["Inspired by", agent.inspiredBy || "None"],
  ];
  return (
    <details className="agent-setup-summary">
      <summary>Agent setup <span>View</span></summary>
      <div>{items.map(([label, value]) => <p key={label}><span>{label}</span><strong>{value}</strong></p>)}</div>
    </details>
  );
}

function AgentCard({ agent, dependencyName, assignedTask, taskCount, onOpenTask, onStopTask, onUpdateInstructions, onRemove, onModelChange }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const working = agent.status === "working";
  const assignedStep = assignedTask?.steps?.find((step) => step.agentId === agent.id);
  const stepIndex = assignedTask?.steps?.findIndex((step) => step.agentId === agent.id) ?? -1;
  const stepStatus = assignedStep?.status || (assignedTask ? "pending" : "awaiting");
  const stepLabels = { pending: "Waiting", working: "Working", done: "Complete", error: "Error", cancelled: "Stopped" };
  const taskCanStop = assignedTask && (assignedTask.status === "pending" || assignedTask.status === "working");
  const processCopy = assignedStep
    ? `Step ${stepIndex + 1} of ${assignedTask.steps.length} · ${stepLabels[stepStatus] || stepStatus}`
    : assignedTask ? "Preparing pipeline…" : "Awaiting task";
  return (
    <article className="agent-card">
      <div className="agent-card-head">
        <div className="agent-avatar" aria-hidden="true">{initials(agent.name)}</div>
        <div className="agent-title"><h2>{agent.name}</h2><span className="agent-role">{agent.specialty || agent.outputType || "Specialist"}</span></div>
        <div className="card-menu">
          <button className="icon-button" type="button" onClick={() => setMenuOpen((value) => !value)} aria-label={`Actions for ${agent.name}`} aria-expanded={menuOpen}>•••</button>
          {menuOpen && <div className="card-menu-panel"><button type="button" onClick={() => onRemove(agent)}>Remove agent</button></div>}
        </div>
      </div>
      <AgentInstructions agent={agent} onUpdate={onUpdateInstructions} />
      <AgentSetupSummary agent={agent} dependencyName={dependencyName} />
      <div className="agent-work-grid">
        <div className={`agent-work-box${assignedTask ? "" : " awaiting"}`}>
          <span>Today's task</span>
          <strong title={assignedTask?.input}>{assignedTask?.input || "Awaiting task"}</strong>
        </div>
        <div className={`agent-work-box process ${stepStatus}`}>
          <span>Current process</span>
          <strong>{processCopy}</strong>
          {taskCanStop && <button className="stop-agent-button" type="button" onClick={() => onStopTask(assignedTask.id, agent.name)}>Stop agent</button>}
        </div>
      </div>
      <button className="agent-assign-button" type="button" onClick={() => onOpenTask(agent)} disabled={working}>{taskCount === 0 ? "Give it its first task" : "Assign next task"}<span aria-hidden="true">→</span></button>
      {agent.outputType === "image"
        ? <div className="image-model-note"><span className="model-red-dot" />Imagen image model</div>
        : <ModelSlider value={agent.model || DEFAULT_MODEL} onChange={(model) => onModelChange(agent.id, model)} disabled={working} />}
      <footer className="agent-footer"><span className={`status-badge${working ? " working" : ""}`}>{working ? "Working" : "Ready"}</span><span className="task-count">{taskCount} {taskCount === 1 ? "task" : "tasks"}</span></footer>
    </article>
  );
}

function AgentsView({ agents, tasks, connection, onCreate, onOpenTask, onStopTask, onUpdateInstructions, onRemove, onModelChange }) {
  const workingCount = agents.filter((agent) => agent.status === "working").length;
  if (agents.length === 0) return <EmptyAgents onCreate={onCreate} connection={connection} />;
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">Your team</span><h1>Your Bullpen</h1><p>Build your roster and give every Gemini agent a clear job.</p></div></div>
      <div className="summary-strip" aria-label="Bullpen summary">
        <div className="summary-item"><span className="summary-value">{agents.length}</span><span className="summary-label">Agents</span></div>
        <div className="summary-divider" aria-hidden="true" />
        <div className="summary-item"><span className="summary-value">{workingCount}</span><span className="summary-label">Working now</span></div>
        <div className="summary-message"><span className="gemini-glyph" aria-hidden="true">✦</span><span>{connection.geminiConfigured ? "Gemini ready" : "API key needed"}</span></div>
      </div>
      <div className="agent-grid">
        <QuickCreateAgent availableAgents={agents} onCreate={onCreate} disabled={!connection.online} />
        {agents.map((agent) => {
          const agentTasks = tasks.filter((task) => task.assignedAgentId === agent.id || task.steps?.some((step) => step.agentId === agent.id));
          const assignedTask = agentTasks.find((task) => {
            const step = task.steps.find((item) => item.agentId === agent.id);
            return step?.status === "working" || step?.status === "pending";
          }) || agentTasks[0];
          const dependencyName = agents.find((item) => item.id === agent.dependsOnAgent)?.name;
          return <AgentCard key={agent.id} agent={agent} dependencyName={dependencyName} assignedTask={assignedTask} taskCount={agentTasks.length} onOpenTask={onOpenTask} onStopTask={onStopTask} onUpdateInstructions={onUpdateInstructions} onRemove={onRemove} onModelChange={onModelChange} />;
        })}
      </div>
    </>
  );
}

function StepOutput({ output }) {
  if (!output) return null;
  if (typeof output === "string" && output.startsWith("data:image/")) return <img className="task-output-image" src={output} alt="Generated agent output" />;
  return <div className="task-output-text">{String(output)}</div>;
}

function TaskCard({ task, agents }) {
  const status = task.status || "pending";
  const directlyAssignedAgent = task.assignedAgentId ? agents.find((agent) => agent.id === task.assignedAgentId) : null;
  return (
    <article className={`task-card ${status}`}>
      <div className="task-card-head"><div><h2>{task.input}</h2><div className="task-meta">{formatDate(task.createdAt)}{directlyAssignedAgent ? ` · Assigned to ${directlyAssignedAgent.name}` : ""}{task.file ? ` · 📎 ${task.file.name}` : ""}</div></div><span className={`task-status ${status}`}>{status}</span></div>
      {task.fileWarning && <div className="task-warning">{task.fileWarning}</div>}
      {task.error && <div className="task-error">{task.error}</div>}
      {task.steps?.length > 0 && (
        <div className="task-steps">
          {task.steps.map((step) => {
            const agent = agents.find((item) => item.id === step.agentId);
            return (
              <details className={`task-step ${step.status}`} key={step.agentId} open={task.steps.length === 1 || step.status === "error"}>
                <summary><span>{agent?.name || step.agentId}</span><span>{step.status}</span></summary>
                <StepOutput output={step.output} />
              </details>
            );
          })}
        </div>
      )}
      {(status === "pending" || status === "working") && <div className="task-progress" aria-label={`${status} task`}><span /></div>}
    </article>
  );
}

function TasksView({ tasks, agents, connection, onCreate }) {
  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">Call the play</span><h1>Task feed</h1><p>Describe the outcome. Gemini will route it through the right agents automatically.</p></div>
        <button className="button primary" type="button" onClick={() => onCreate()}><span aria-hidden="true">+</span> Run a task</button>
      </div>
      {!connection.geminiConfigured && <div className="api-key-banner"><strong>Gemini API key needed</strong><span>Add <code>GEMINI_API_KEY</code> to the root <code>.env</code> file and restart the backend to run tasks.</span></div>}
      <div className="task-list">
        {tasks.length === 0 ? <div className="list-empty"><strong>No tasks yet</strong>Run a task and the orchestrator’s live progress will appear here.</div> : tasks.map((task) => <TaskCard task={task} agents={agents} key={task.id} />)}
      </div>
    </>
  );
}

function useDialog(open, dialogRef) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open, dialogRef]);
}

function TaskDialog({ open, canRun, targetAgent, onClose, onCreate }) {
  const dialogRef = useRef(null);
  const [input, setInput] = useState("");
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  useDialog(open, dialogRef);

  useEffect(() => {
    if (!open) return;
    setInput("");
    setFile(null);
    setSubmitting(false);
  }, [open]);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    const created = await onCreate({ input: input.trim(), file, agentId: targetAgent?.id || null });
    setSubmitting(false);
    if (created) onClose();
  }

  return (
    <dialog className="modal" ref={dialogRef} onClose={onClose} onCancel={onClose}>
      <form onSubmit={submit}>
        <div className="modal-heading"><div><span className="eyebrow">{targetAgent ? `Send to ${targetAgent.name}` : "Send to the bullpen"}</span><h2>{targetAgent ? `Give ${targetAgent.name} a task` : "Run a task"}</h2></div><button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close dialog">×</button></div>
        <p className="modal-helper">{targetAgent ? `This task goes directly to ${targetAgent.name}. Any required upstream agents will be included automatically.` : "The orchestrator will choose the right agent or build a multi-agent pipeline for you."}</p>
        <label className="field"><span>What do you need?</span><textarea value={input} onChange={(event) => setInput(event.target.value)} rows="5" required maxLength="2000" placeholder="e.g. Research our market and write a launch announcement." /></label>
        <label className="field"><span>Attachment <small>Optional · max 20MB</small></span><input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
        {!canRun && <div className="task-warning">Add your Gemini API key and restart the backend before running a task.</div>}
        <footer className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={!canRun || submitting}>{submitting ? "Sending…" : "Run task"}</button></footer>
      </form>
    </dialog>
  );
}

function Toast({ message }) {
  return <div className={`toast${message ? " show" : ""}`} role="status" aria-live="polite">{message}</div>;
}

export default function App() {
  const [agents, setAgents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [connection, setConnection] = useState({ online: false, geminiConfigured: false });
  const [loading, setLoading] = useState(true);
  const [showIntro, setShowIntro] = useState(shouldShowIntro);
  const [view, setView] = useState("agents");
  const [menuOpen, setMenuOpen] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskTargetAgent, setTaskTargetAgent] = useState(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const hasWorkspaceContent = agents.length > 0 || tasks.length > 0;

  useEffect(() => {
    let cancelled = false;
    let refreshing = false;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const [health, nextAgents, nextTasks] = await Promise.all([api.health(), api.getAgents(), api.getTasks()]);
        if (!cancelled) {
          setConnection({ online: true, geminiConfigured: Boolean(health.geminiConfigured) });
          setAgents(nextAgents);
          setTasks(nextTasks);
        }
      } catch {
        if (!cancelled) setConnection({ online: false, geminiConfigured: false });
      } finally {
        if (!cancelled) setLoading(false);
        refreshing = false;
      }
    }
    refresh();
    const interval = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  function notify(message) {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3200);
  }

  function navigate(nextView) {
    setView(nextView);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function createAgent(data) {
    if (agents.some((agent) => agent.name.toLocaleLowerCase() === data.name.toLocaleLowerCase())) {
      notify(`An agent named ${data.name} already exists.`);
      return false;
    }
    try {
      const created = await api.createAgent({
        name: data.name,
        role: data.directive,
        specialty: data.specialty,
        directive: data.directive,
        inputType: data.inputType,
        outputType: data.outputType,
        dependsOnAgent: data.dependsOnAgent,
        tone: data.tone,
        acceptsFiles: data.acceptsFiles,
        model: data.model,
        style: data.style,
        inspiredBy: data.inspiredBy,
      });
      setAgents((current) => [...current, created]);
      notify(`${data.name} joined your Bullpen.`);
      return true;
    } catch (error) {
      notify(error.message);
      return false;
    }
  }

  async function removeAgent(agent) {
    if (!window.confirm(`Remove ${agent.name} from your Bullpen?`)) return;
    try {
      await api.deleteAgent(agent.id);
      setAgents((current) => current.filter((item) => item.id !== agent.id));
      notify(`${agent.name} was removed.`);
    } catch (error) {
      notify(error.message);
    }
  }

  async function changeAgentModel(id, model) {
    try {
      const updated = await api.updateAgentModel(id, model);
      setAgents((current) => current.map((agent) => agent.id === id ? updated : agent));
      const selectedModel = geminiModels.find((item) => item.id === model);
      notify(`Model changed to Gemini ${selectedModel?.label || "Flash"}.`);
    } catch (error) {
      notify(error.message);
    }
  }

  async function updateAgentInstructions(id, directive) {
    try {
      const updated = await api.updateAgentInstructions(id, directive);
      setAgents((current) => current.map((agent) => agent.id === id ? updated : agent));
      notify(`${updated.name}'s instructions were updated.`);
      return true;
    } catch (error) {
      notify(error.message);
      return false;
    }
  }

  function openTaskDialog(targetAgent = null) {
    if (!connection.online) {
      notify("Start the Bullpen backend before running a task.");
      return;
    }
    setTaskTargetAgent(targetAgent);
    setTaskDialogOpen(true);
  }

  async function createTask(data) {
    if (data.file && data.file.size > 20 * 1024 * 1024) {
      notify("Attachments must be 20MB or smaller.");
      return false;
    }
    try {
      const created = await api.createTask(data);
      setTasks((current) => [created, ...current.filter((task) => task.id !== created.id)]);
      if (!data.agentId) setView("tasks");
      const target = data.agentId ? agents.find((agent) => agent.id === data.agentId) : null;
      notify(target ? `Task sent to ${target.name}.` : "Task sent to the orchestrator.");
      return true;
    } catch (error) {
      notify(error.message);
      return false;
    }
  }

  async function stopAgentTask(taskId, agentName) {
    try {
      const cancelled = await api.cancelTask(taskId);
      setTasks((current) => current.map((task) => task.id === taskId ? cancelled : task));
      const cancelledAgentIds = new Set(cancelled.steps?.map((step) => step.agentId) || []);
      setAgents((current) => current.map((agent) => cancelledAgentIds.has(agent.id) ? { ...agent, status: "idle" } : agent));
      notify(`${agentName} was stopped.`);
    } catch (error) {
      notify(error.message);
    }
  }

  function completeIntro() {
    try { sessionStorage.setItem(INTRO_KEY, "true"); } catch { /* Storage is optional. */ }
    setShowIntro(false);
  }

  if (loading && !showIntro) {
    return <div className="backend-loading"><img src={logoUrl} alt="" /><span>Opening the Bullpen…</span></div>;
  }

  return (
    <>
      {showIntro && <IntroSequence onComplete={completeIntro} />}
      <div className={`app-shell${hasWorkspaceContent ? " has-sidebar" : " sidebarless"}`}>
        {hasWorkspaceContent && <Sidebar currentView={view} taskCount={tasks.length} open={menuOpen} connection={connection} onNavigate={navigate} />}
        {hasWorkspaceContent && menuOpen && <button className="sidebar-backdrop" type="button" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}
        <main className="main-content">
          {hasWorkspaceContent && <button className="icon-button mobile-menu floating-menu" type="button" onClick={() => setMenuOpen((value) => !value)} aria-label="Open navigation" aria-expanded={menuOpen}><MenuIcon /></button>}
          <section className="page-view active" aria-label={view === "agents" ? "Agents" : "Tasks"}>
            {view === "agents"
              ? <AgentsView agents={agents} tasks={tasks} connection={connection} onCreate={createAgent} onOpenTask={openTaskDialog} onStopTask={stopAgentTask} onUpdateInstructions={updateAgentInstructions} onRemove={removeAgent} onModelChange={changeAgentModel} />
              : <TasksView tasks={tasks} agents={agents} connection={connection} onCreate={openTaskDialog} />}
          </section>
        </main>
        <TaskDialog open={taskDialogOpen} canRun={connection.online && connection.geminiConfigured} targetAgent={taskTargetAgent} onClose={() => { setTaskDialogOpen(false); setTaskTargetAgent(null); }} onCreate={createTask} />
        <Toast message={toast} />
      </div>
    </>
  );
}
