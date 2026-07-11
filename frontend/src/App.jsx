import { useEffect, useMemo, useRef, useState } from "react";
import logoUrl from "../images/bullpen-transparent.png";

const STORAGE_KEY = "bullpen-workspace-v1";

const specialties = [
  "Research",
  "Writing",
  "Software development",
  "Data analysis",
  "Customer support",
  "Project management",
];

function loadWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      agents: Array.isArray(saved?.agents) ? saved.agents : [],
      tasks: Array.isArray(saved?.tasks) ? saved.tasks : [],
    };
  } catch {
    return { agents: [], tasks: [] };
  }
}

function uid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
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

function TrashIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" /></svg>;
}

function Sidebar({ currentView, taskCount, open, onNavigate }) {
  return (
    <aside className={`sidebar${open ? " open" : ""}`} aria-label="Main navigation">
      <button className="brand" type="button" onClick={() => onNavigate("agents")} aria-label="Bullpen home">
        <span className="brand-logo-frame"><img src={logoUrl} alt="" /></span>
        <span>Bullpen</span>
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

      <div className="sidebar-note">
        <span className="signal-dot" aria-hidden="true" />
        <div><strong>Frontend workspace</strong><span>Gemini connection comes next</span></div>
      </div>
    </aside>
  );
}

function Topbar({ menuOpen, onMenuToggle }) {
  return (
    <header className="topbar">
      <button className="icon-button mobile-menu" type="button" onClick={onMenuToggle} aria-label="Open navigation" aria-expanded={menuOpen}>
        <MenuIcon />
      </button>
      <div className="topbar-copy"><span className="eyebrow">Workspace</span><strong>My Bullpen</strong></div>
      <button className="avatar" type="button" aria-label="User profile">BP</button>
    </header>
  );
}

function EmptyAgents({ onCreate }) {
  return (
    <div className="empty-state">
      <div className="empty-visual" aria-hidden="true">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <div className="empty-logo-frame"><img src={logoUrl} alt="" /></div>
        <span className="spark spark-one">✦</span>
        <span className="spark spark-two">✦</span>
      </div>
      <span className="eyebrow">Welcome to Bullpen</span>
      <h1>Build your first AI agent</h1>
      <p>Create a specialized Gemini agent, define what it does, and start building your on-demand team.</p>
      <button className="button primary large" type="button" onClick={onCreate}><span aria-hidden="true">+</span> Create your first agent</button>
      <div className="empty-footnote"><span className="gemini-glyph" aria-hidden="true">✦</span>Powered by Gemini once your backend is connected</div>
    </div>
  );
}

function AgentCard({ agent, taskCount, onRemove }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <article className="agent-card">
      <div className="agent-card-head">
        <div className="agent-avatar" aria-hidden="true">{initials(agent.name)}</div>
        <div className="agent-title"><h2>{agent.name}</h2><span className="agent-role">{agent.role}</span></div>
        <div className="card-menu">
          <button className="icon-button" type="button" onClick={() => setMenuOpen((value) => !value)} aria-label={`Actions for ${agent.name}`} aria-expanded={menuOpen}>•••</button>
          {menuOpen && <div className="card-menu-panel"><button type="button" onClick={() => onRemove(agent)}>Remove agent</button></div>}
        </div>
      </div>
      <p className="agent-directive">{agent.directive}</p>
      <footer className="agent-footer">
        <span className="status-badge">Active</span>
        <span className="task-count">{taskCount} {taskCount === 1 ? "task draft" : "task drafts"}</span>
      </footer>
    </article>
  );
}

function AgentsView({ agents, tasks, onCreate, onRemove }) {
  const roleCount = new Set(agents.map((agent) => agent.role)).size;

  if (agents.length === 0) return <EmptyAgents onCreate={onCreate} />;

  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">Your team</span><h1>Active agents</h1><p>Build your roster and give every Gemini agent a clear job.</p></div>
        <button className="button primary" type="button" onClick={onCreate}><span aria-hidden="true">+</span> Create agent</button>
      </div>
      <div className="summary-strip" aria-label="Agent summary">
        <div className="summary-item"><span className="summary-value">{agents.length}</span><span className="summary-label">Active agents</span></div>
        <div className="summary-divider" aria-hidden="true" />
        <div className="summary-item"><span className="summary-value">{roleCount}</span><span className="summary-label">Specialties</span></div>
        <div className="summary-message"><span className="gemini-glyph" aria-hidden="true">✦</span><span>Ready for Gemini integration</span></div>
      </div>
      <div className="agent-grid">
        {agents.map((agent) => <AgentCard key={agent.id} agent={agent} taskCount={tasks.filter((task) => task.agentId === agent.id).length} onRemove={onRemove} />)}
      </div>
    </>
  );
}

function TasksView({ tasks, agents, onCreate, onRemove }) {
  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">Plan the work</span><h1>Task drafts</h1><p>Prepare tasks now. Execution can be connected to Gemini through your backend later.</p></div>
        <button className="button primary" type="button" onClick={onCreate}><span aria-hidden="true">+</span> New task</button>
      </div>
      <div className="task-list">
        {tasks.length === 0 ? (
          <div className="list-empty"><strong>No task drafts yet</strong>Create an agent, then prepare its first task here.</div>
        ) : tasks.map((task) => {
          const agent = agents.find((item) => item.id === task.agentId);
          return (
            <article className="task-card" key={task.id}>
              <h2>{task.objective}</h2>
              <div className="task-meta">{agent?.name ?? "Removed agent"} · Draft</div>
              <button className="icon-button delete-task" type="button" onClick={() => onRemove(task.id)} aria-label="Delete task draft"><TrashIcon /></button>
              <span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span>
            </article>
          );
        })}
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

function AgentDialog({ open, onClose, onCreate }) {
  const dialogRef = useRef(null);
  const nameRef = useRef(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState(specialties[0]);
  const [directive, setDirective] = useState("");
  useDialog(open, dialogRef);

  useEffect(() => {
    if (!open) return;
    setName("");
    setRole(specialties[0]);
    setDirective("");
    setTimeout(() => nameRef.current?.focus(), 50);
  }, [open]);

  function submit(event) {
    event.preventDefault();
    onCreate({ name: name.trim(), role, directive: directive.trim() });
  }

  return (
    <dialog className="modal" ref={dialogRef} onClose={onClose} onCancel={onClose}>
      <form onSubmit={submit}>
        <div className="modal-heading"><div><span className="eyebrow">Add to your roster</span><h2>Create an agent</h2></div><button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close dialog">×</button></div>
        <label className="field"><span>Agent name</span><input ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} required maxLength="32" autoComplete="off" placeholder="e.g. Scout" /></label>
        <label className="field"><span>Specialty</span><select value={role} onChange={(event) => setRole(event.target.value)}>{specialties.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field"><span>What should this agent do?</span><textarea value={directive} onChange={(event) => setDirective(event.target.value)} rows="4" required maxLength="240" placeholder="Describe its responsibilities, expertise, and working style." /><small>{directive.length}/240</small></label>
        <div className="model-row"><span className="gemini-glyph" aria-hidden="true">✦</span><div><strong>Gemini agent</strong><span>Model selection will be connected through your backend.</span></div></div>
        <footer className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="submit">Create agent</button></footer>
      </form>
    </dialog>
  );
}

function TaskDialog({ open, agents, onClose, onCreate }) {
  const dialogRef = useRef(null);
  const [agentId, setAgentId] = useState("");
  const [objective, setObjective] = useState("");
  const [priority, setPriority] = useState("Normal");
  useDialog(open, dialogRef);

  useEffect(() => {
    if (!open) return;
    setAgentId(agents[0]?.id ?? "");
    setObjective("");
    setPriority("Normal");
  }, [open, agents]);

  function submit(event) {
    event.preventDefault();
    onCreate({ agentId, objective: objective.trim(), priority });
  }

  return (
    <dialog className="modal" ref={dialogRef} onClose={onClose} onCancel={onClose}>
      <form onSubmit={submit}>
        <div className="modal-heading"><div><span className="eyebrow">Draft the next play</span><h2>New task</h2></div><button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close dialog">×</button></div>
        <label className="field"><span>Assign to</span><select value={agentId} onChange={(event) => setAgentId(event.target.value)} required>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name} — {agent.role}</option>)}</select></label>
        <label className="field"><span>Task</span><textarea value={objective} onChange={(event) => setObjective(event.target.value)} rows="4" required maxLength="300" placeholder="What outcome do you need?" /></label>
        <label className="field"><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value)}><option>Low</option><option>Normal</option><option>High</option></select></label>
        <footer className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="submit">Save draft</button></footer>
      </form>
    </dialog>
  );
}

function Toast({ message }) {
  return <div className={`toast${message ? " show" : ""}`} role="status" aria-live="polite">{message}</div>;
}

export default function App() {
  const [workspace, setWorkspace] = useState(loadWorkspace);
  const [view, setView] = useState("agents");
  const [menuOpen, setMenuOpen] = useState(false);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const { agents, tasks } = workspace;

  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace)), [workspace]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const existingNames = useMemo(() => new Set(agents.map((agent) => agent.name.toLocaleLowerCase())), [agents]);

  function notify(message) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2800);
  }

  function navigate(nextView) {
    setView(nextView);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function createAgent(data) {
    if (existingNames.has(data.name.toLocaleLowerCase())) {
      setAgentDialogOpen(false);
      notify(`An agent named ${data.name} already exists.`);
      return;
    }
    const agent = { id: uid(), ...data, status: "ACTIVE", createdAt: new Date().toISOString() };
    setWorkspace((current) => ({ ...current, agents: [agent, ...current.agents] }));
    setAgentDialogOpen(false);
    notify(`${data.name} joined your Bullpen.`);
  }

  function removeAgent(agent) {
    if (!window.confirm(`Remove ${agent.name} from your Bullpen? Their task drafts will also be removed.`)) return;
    setWorkspace((current) => ({ agents: current.agents.filter((item) => item.id !== agent.id), tasks: current.tasks.filter((task) => task.agentId !== agent.id) }));
    notify(`${agent.name} was removed.`);
  }

  function openTaskDialog() {
    if (agents.length === 0) {
      navigate("agents");
      notify("Create an agent before drafting a task.");
      return;
    }
    setTaskDialogOpen(true);
  }

  function createTask(data) {
    const task = { id: uid(), ...data, status: "DRAFT", createdAt: new Date().toISOString() };
    setWorkspace((current) => ({ ...current, tasks: [task, ...current.tasks] }));
    setTaskDialogOpen(false);
    notify("Task draft saved.");
  }

  function removeTask(id) {
    setWorkspace((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== id) }));
    notify("Task draft deleted.");
  }

  return (
    <div className="app-shell">
      <Sidebar currentView={view} taskCount={tasks.length} open={menuOpen} onNavigate={navigate} />
      {menuOpen && <button className="sidebar-backdrop" type="button" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}
      <main className="main-content">
        <Topbar menuOpen={menuOpen} onMenuToggle={() => setMenuOpen((value) => !value)} />
        <section className="page-view active" aria-label={view === "agents" ? "Agents" : "Tasks"}>
          {view === "agents" ? <AgentsView agents={agents} tasks={tasks} onCreate={() => setAgentDialogOpen(true)} onRemove={removeAgent} /> : <TasksView tasks={tasks} agents={agents} onCreate={openTaskDialog} onRemove={removeTask} />}
        </section>
      </main>
      <AgentDialog open={agentDialogOpen} onClose={() => setAgentDialogOpen(false)} onCreate={createAgent} />
      <TaskDialog open={taskDialogOpen} agents={agents} onClose={() => setTaskDialogOpen(false)} onCreate={createTask} />
      <Toast message={toast} />
    </div>
  );
}
