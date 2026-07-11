import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import logoUrl from "../images/bull-head.png";

const INTRO_KEY = "bullpen-intro-seen-v4";
const AUTH_KEY = "bullpen-demo-authenticated";
const DEMO_ACCOUNT_KEY = "bullpen-demo-account";
const POLL_INTERVAL_MS = 2000;
const IS_LOCAL_DEV = import.meta.env.DEV;

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

// gemini-2.5-* models were pulled from new API keys 2026-07-09 — confirmed
// live, they 404 regardless of billing tier. Verified 2026-07-11 against a
// live key: gemini-flash-lite-latest, gemini-3.5-flash, and gemini-pro-latest
// each work for generateContent, so each tier now has its own distinct id
// (see src/lib/models.js on backend, which validates against the same ids).
const geminiModels = [
  { id: "gemini-flash-lite-latest", label: "Flash-Lite", hint: "Fast" },
  { id: "gemini-3.5-flash", label: "Flash", hint: "Balanced" },
  { id: "gemini-pro-latest", label: "Pro", hint: "Deep" },
];

const DEFAULT_MODEL = "gemini-3.5-flash";

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

function isDemoAuthenticated() {
  try {
    return sessionStorage.getItem(AUTH_KEY) === "true";
  } catch {
    return false;
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
      {stage === 1 && <div className="intro-stage intro-tagline-stage"><p>the AI "pitchers" your business needs</p></div>}
      {stage === 2 && <div className="intro-stage intro-welcome-stage"><p>Welcome to the <span>Bullpen</span></p></div>}
      <button className="intro-skip" type="button" onClick={onComplete}>Skip intro</button>
    </div>
  );
}

function HomePage({ authenticated, onSignIn, onGetStarted }) {
  return (
    <main className="landing-page">
      <header className="landing-nav">
        <div className="landing-brand"><span><img src={logoUrl} alt="" /></span>Bullpen</div>
        <div className="landing-nav-actions">
          {!authenticated && <button className="landing-login" type="button" onClick={onSignIn}>Sign in</button>}
          <button className="button primary" type="button" onClick={onGetStarted}>{authenticated ? "Open Bullpen" : "Get started"}</button>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <span className="landing-kicker"><i /> Powered by Gemini</span>
          <h1>Build Your Bench. <span>Scale Your Business.</span></h1>
          <p>Build a specialized team of AI agents, give them work, and follow every step from assignment to final output.</p>
          <div className="landing-hero-actions">
            <button className="button primary large" type="button" onClick={onGetStarted}>{authenticated ? "Open my Bullpen" : "Create your first agent"} <span aria-hidden="true">→</span></button>
            {!authenticated && <button className="button secondary large" type="button" onClick={onSignIn}>I already have an account</button>}
          </div>
          <div className="landing-note"><span>✦</span> Set up an agent in minutes. No credit card required.</div>
        </div>

        <div className="landing-visual" aria-label="How Bullpen works">
          <div className="landing-visual-glow" />
          <div className="roster-window">
            <div className="roster-window-head"><span>Your bullpen</span><small><i /> Ready</small></div>
            <div className="roster-play">
              <div className="roster-number">01</div>
              <div><span>Build a specialist</span><strong>Name it, shape its role, and choose its Gemini model.</strong></div>
            </div>
            <div className="roster-connector"><span /><i /><span /></div>
            <div className="roster-play active">
              <div className="roster-number">02</div>
              <div><span>Call the play</span><strong>Assign a clear task directly to the right agent.</strong></div>
            </div>
            <div className="roster-connector"><span /><i /><span /></div>
            <div className="roster-play">
              <div className="roster-number">03</div>
              <div><span>Watch it work</span><strong>See live progress, update instructions, or stop at any time.</strong></div>
            </div>
          </div>
          <div className="landing-model-chip"><span /> Gemini model control</div>
        </div>
      </section>

      <section className="landing-features" aria-label="Bullpen features">
        <article><span>01</span><h2>Hire for the job</h2><p>Create focused agents with their own specialty, tone, inputs, outputs, and working style.</p></article>
        <article><span>02</span><h2>Build a real workflow</h2><p>Connect agents so research, writing, design, and analysis move through one coordinated pipeline.</p></article>
        <article><span>03</span><h2>Stay in control</h2><p>Track task history and current steps, then change instructions or stop an agent whenever you need to.</p></article>
      </section>
    </main>
  );
}

function AuthScreen({ initialMode = "signin", onLogin, onSignUp, onBack, onModeChange }) {
  const [mode, setMode] = useState(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  function submit(event) {
    event.preventDefault();
    if (mode === "signup") {
      if (username.trim().length < 3) {
        setError("Choose a username with at least 3 characters.");
        return;
      }
      if (password.length < 6) {
        setError("Choose a password with at least 6 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Those passwords do not match.");
        return;
      }
      onSignUp(username, password);
      return;
    }
    if (!onLogin(username, password)) {
      setError("That username or password is not correct. Try the demo access below.");
      return;
    }
    setError("");
  }

  function changeMode(nextMode) {
    setMode(nextMode);
    setError("");
    setPassword("");
    setConfirmPassword("");
    onModeChange?.(nextMode);
  }

  return (
    <main className="login-screen">
      <button className="login-back" type="button" onClick={onBack}><span aria-hidden="true">←</span> Back to home</button>
      <div className="login-orbit" aria-hidden="true"><span /><img src={logoUrl} alt="" /></div>
      <form className="login-card" onSubmit={submit}>
        <div className="auth-tabs" role="tablist" aria-label="Account access">
          <button className={mode === "signin" ? "active" : ""} type="button" role="tab" aria-selected={mode === "signin"} onClick={() => changeMode("signin")}>Sign in</button>
          <button className={mode === "signup" ? "active" : ""} type="button" role="tab" aria-selected={mode === "signup"} onClick={() => changeMode("signup")}>Sign up</button>
        </div>
        <span className="eyebrow">{mode === "signin" ? "Welcome back" : "Join the roster"}</span>
        <h1>{mode === "signin" ? "Enter the Bullpen" : "Create your account"}</h1>
        <p>{mode === "signin" ? "Sign in to manage your agents and their work." : "Create a demo account and start building your AI team."}</p>
        <label><span>Username</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus required placeholder="admin" /></label>
        <label><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} required placeholder={mode === "signin" ? "password" : "At least 6 characters"} /></label>
        {mode === "signup" && <label><span>Confirm password</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required placeholder="Enter it again" /></label>}
        {error && <div className="login-error" role="alert">{error}</div>}
        <button className="button primary" type="submit">{mode === "signin" ? "Sign in" : "Create account"}</button>
        {mode === "signin" ? <div className="demo-credentials"><span>Demo access</span><code>admin</code><span>/</span><code>password</code></div> : <div className="demo-credentials"><span>Hackathon demo</span><span>Your account stays in this browser session</span></div>}
      </form>
    </main>
  );
}

function Sidebar({ currentView, tasks, open, connection, onNavigate, onSignOut }) {
  const recentTasks = tasks.slice(0, 7);
  const taskStatusLabels = { pending: "Queued", working: "In progress", done: "Completed", error: "Error", cancelled: "Stopped" };
  const connectionCopy = !connection.online
    ? { title: "Service unavailable", detail: IS_LOCAL_DEV ? "Start the server on port 3000" : "Please try again shortly", state: "offline" }
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
          {tasks.length > 0 && <span className="nav-count">{tasks.length}</span>}
        </button>
      </nav>
      <section className="sidebar-history" aria-labelledby="task-history-title">
        <div className="sidebar-history-heading"><span id="task-history-title">Task history</span>{tasks.length > recentTasks.length && <button type="button" onClick={() => onNavigate("tasks")}>View all</button>}</div>
        <div className="sidebar-history-list">
          {recentTasks.length === 0 ? <p>No tasks yet</p> : recentTasks.map((task) => (
            <button className="history-task" type="button" onClick={() => onNavigate("tasks")} title={task.input} key={task.id}>
              <span className={`history-status ${task.status}`} aria-hidden="true" />
              <span className="history-task-copy"><strong>{task.input}</strong><small>{taskStatusLabels[task.status] || task.status}</small></span>
            </button>
          ))}
        </div>
      </section>
      <div className={`sidebar-note ${connectionCopy.state}`}>
        <span className="signal-dot" aria-hidden="true" />
        <div><strong>{connectionCopy.title}</strong><span>{connectionCopy.detail}</span></div>
      </div>
      <button className="sidebar-signout" type="button" onClick={onSignOut}>Sign out</button>
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
          {geminiModels.map((model, index) => <span className={index === previewIndex ? "active" : ""} key={model.label}>{model.label}</span>)}
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
  const [context, setContext] = useState("");
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
      context: context.trim() || null,
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
    setContext("");
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
      <label className="quick-field"><span>Context <small>Optional</small></span><textarea value={context} onChange={(event) => setContext(event.target.value)} maxLength="500" rows="2" placeholder="Background this agent should know — company info, prior facts, constraints. Separate from how it should work." /></label>
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
      {!connection.online && <div className="connection-alert">{IS_LOCAL_DEV ? <>Start the backend with <code>npm run dev</code> before adding an agent.</> : <>Bullpen's agent service is temporarily unavailable. Please try again shortly.</>}</div>}
      <QuickCreateAgent onCreate={onCreate} disabled={!connection.online} />
      <div className="empty-footnote"><span className="gemini-glyph" aria-hidden="true">✦</span>{connection.geminiConfigured ? "Gemini is ready" : "Add your Gemini API key to run agent tasks"}</div>
    </div>
  );
}

function AgentInstructions({ agent, onUpdate }) {
  const [directive, setDirective] = useState(agent.directive || agent.role || "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
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
    <details className="agent-instructions" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><span>Instructions</span>{!open && <small>{savedDirective}</small>}</summary>
      <div className="agent-instructions-body">
        {editing ? (
          <>
            <textarea value={directive} onChange={(event) => setDirective(event.target.value)} rows="3" maxLength="500" aria-label={`Instructions for ${agent.name}`} autoFocus />
            <div className="agent-instructions-actions"><button type="button" onClick={() => { setDirective(savedDirective); setEditing(false); }}>Cancel</button><button className="save" type="button" onClick={save} disabled={!changed || !directive.trim() || saving}>{saving ? "Saving…" : "Save instructions"}</button></div>
          </>
        ) : (
          <>
            <p>{savedDirective}</p>
            <button type="button" onClick={() => setEditing(true)}>Edit</button>
          </>
        )}
      </div>
    </details>
  );
}

function agentToSetupForm(agent) {
  return {
    name: agent.name || "",
    specialty: agent.specialty || "",
    inputType: agent.inputType || "",
    outputType: agent.outputType || "text",
    dependsOnAgent: agent.dependsOnAgent || "",
    acceptsFiles: Boolean(agent.acceptsFiles),
    tone: agent.tone || "",
    style: agent.style || "",
    inspiredBy: agent.inspiredBy || "",
  };
}

function AgentSetupSummary({ agent, agents, dependencyName, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => agentToSetupForm(agent));

  useEffect(() => { if (!editing) setForm(agentToSetupForm(agent)); }, [agent, editing]);

  function field(key) {
    return { value: form[key], onChange: (event) => setForm((current) => ({ ...current, [key]: event.target.value })) };
  }

  async function save(event) {
    event.preventDefault();
    if (!form.name.trim() || !form.specialty.trim() || !form.inputType.trim()) return;
    setSaving(true);
    const ok = await onUpdate(agent.id, {
      name: form.name.trim(),
      specialty: form.specialty.trim(),
      inputType: form.inputType.trim(),
      outputType: form.outputType,
      dependsOnAgent: form.dependsOnAgent || null,
      acceptsFiles: form.dependsOnAgent ? false : form.acceptsFiles,
      tone: form.tone.trim() || null,
      style: form.style.trim() || null,
      inspiredBy: form.inspiredBy.trim() || null,
    });
    setSaving(false);
    if (ok) setEditing(false);
  }

  if (editing) {
    const dependencyOptions = agents.filter((item) => item.id !== agent.id);
    return (
      <form className="agent-setup-editor" onSubmit={save}>
        <label className="quick-field"><span>Name</span><input {...field("name")} required maxLength="32" /></label>
        <label className="quick-field"><span>Specialty</span><input {...field("specialty")} required maxLength="48" /></label>
        <label className="quick-field"><span>Input type</span><input {...field("inputType")} required maxLength="48" /></label>
        <label className="quick-field"><span>Output type</span>
          <select {...field("outputType")}>{outputTypes.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select>
        </label>
        <label className="quick-field">
          <span>Depends on</span>
          <select value={form.dependsOnAgent} onChange={(event) => setForm((current) => ({ ...current, dependsOnAgent: event.target.value, acceptsFiles: event.target.value ? false : current.acceptsFiles }))}>
            <option value="">No dependency</option>
            {dependencyOptions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="quick-field"><span>Tone</span><input {...field("tone")} maxLength="80" placeholder="e.g. Confident and concise" /></label>
        <label className="quick-field full-width"><span>Visual style</span><input {...field("style")} maxLength="120" placeholder="e.g. Editorial, minimal, cinematic" /></label>
        <label className="quick-field full-width"><span>Inspired by</span><input {...field("inspiredBy")} maxLength="120" placeholder="e.g. Swiss design or Stripe's website" /></label>
        <label className={`file-capability-toggle${form.dependsOnAgent ? " disabled" : ""}`}>
          <input type="checkbox" checked={form.acceptsFiles} onChange={(event) => setForm((current) => ({ ...current, acceptsFiles: event.target.checked }))} disabled={Boolean(form.dependsOnAgent)} />
          <span><strong>Accept file uploads</strong><small>{form.dependsOnAgent ? "Only entry-point agents receive files" : "Allow files when this agent starts a task"}</small></span>
        </label>
        <div className="agent-instructions-actions">
          <button type="button" onClick={() => { setForm(agentToSetupForm(agent)); setEditing(false); }}>Cancel</button>
          <button className="save" type="submit" disabled={saving}>{saving ? "Saving…" : "Save setup"}</button>
        </div>
      </form>
    );
  }

  const items = [
    ["Name", agent.name],
    ["Specialty", agent.specialty || "None"],
    ["Input", agent.inputType],
    ["Output", agent.outputType],
    ["Depends on", dependencyName || "None"],
    ["Files", agent.acceptsFiles ? "Accepted" : "Not accepted"],
    ["Tone", agent.tone || "Default"],
    ["Style", agent.style || "Default"],
    ["Inspired by", agent.inspiredBy || "None"],
    ["Context", agent.context || "None"],
  ];
  return (
    <details className="agent-setup-summary">
      <summary>Agent setup <span>View</span></summary>
      <div>{items.map(([label, value]) => <p key={label}><span>{label}</span><strong>{value}</strong></p>)}</div>
      <button type="button" className="edit-setup-button" onClick={() => setEditing(true)}>Edit setup</button>
    </details>
  );
}

function AgentCard({ agent, agents, dependencyName, assignedTask, taskCount, onOpenTask, onStopTask, onUpdateInstructions, onUpdateSetup, onRemove, onModelChange }) {
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
      <AgentSetupSummary agent={agent} agents={agents} dependencyName={dependencyName} onUpdate={onUpdateSetup} />
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

function AgentsView({ agents, tasks, connection, onCreate, onOpenTask, onStopTask, onUpdateInstructions, onUpdateSetup, onRemove, onModelChange }) {
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
          return <AgentCard key={agent.id} agent={agent} agents={agents} dependencyName={dependencyName} assignedTask={assignedTask} taskCount={agentTasks.length} onOpenTask={onOpenTask} onStopTask={onStopTask} onUpdateInstructions={onUpdateInstructions} onUpdateSetup={onUpdateSetup} onRemove={onRemove} onModelChange={onModelChange} />;
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

// Lets a user leave feedback on a completed step, attributed to whichever
// agent ran it. onSuggest drafts a possible context update via Gemini
// without saving anything; the user reviews it and onApply is only called if
// they explicitly accept — feedback never silently rewrites an agent's
// context, since that context is shared by everyone who uses this agent.
function StepFeedback({ agent, step, taskInput, onSuggest, onApply }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState(undefined); // undefined = not requested yet, null = "nothing durable", string = suggested context
  const [applying, setApplying] = useState(false);

  if (!agent) return null;

  function reset() {
    setOpen(false);
    setFeedback("");
    setSuggestion(undefined);
  }

  async function submit(event) {
    event.preventDefault();
    if (!feedback.trim()) return;
    setLoading(true);
    const result = await onSuggest(agent.id, {
      feedback: feedback.trim(),
      taskInput,
      stepOutput: typeof step.output === "string" ? step.output : undefined,
    });
    setLoading(false);
    if (result === undefined) return; // request failed; already surfaced as a toast, let the user retry
    setSuggestion(result);
  }

  async function apply() {
    setApplying(true);
    const ok = await onApply(agent.id, suggestion);
    setApplying(false);
    if (ok) reset();
  }

  if (!open) {
    return <button type="button" className="step-feedback-toggle" onClick={() => setOpen(true)}>Leave feedback for {agent.name}</button>;
  }

  if (suggestion !== undefined) {
    return (
      <div className="step-feedback-suggestion">
        {suggestion === null
          ? <p>Nothing durable to remember from that — thanks for the feedback.</p>
          : <><span>Suggested update to {agent.name}'s context:</span><p>{suggestion}</p></>}
        <div className="agent-instructions-actions">
          <button type="button" onClick={reset}>Discard</button>
          {suggestion !== null && <button className="save" type="button" onClick={apply} disabled={applying}>{applying ? "Applying…" : "Apply to context"}</button>}
        </div>
      </div>
    );
  }

  return (
    <form className="step-feedback-form" onSubmit={submit}>
      <textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} rows="2" maxLength="500" placeholder={`What should ${agent.name} know for next time?`} autoFocus />
      <div className="agent-instructions-actions">
        <button type="button" onClick={reset}>Cancel</button>
        <button className="save" type="submit" disabled={!feedback.trim() || loading}>{loading ? "Thinking…" : "Suggest update"}</button>
      </div>
    </form>
  );
}

function TaskCard({ task, agents, onSuggestFeedback, onApplyContext }) {
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
                {step.status === "done" && <StepFeedback agent={agent} step={step} taskInput={task.input} onSuggest={onSuggestFeedback} onApply={onApplyContext} />}
              </details>
            );
          })}
        </div>
      )}
      {(status === "pending" || status === "working") && <div className="task-progress" aria-label={`${status} task`}><span /></div>}
    </article>
  );
}

function TasksView({ tasks, agents, connection, onCreate, onSuggestFeedback, onApplyContext }) {
  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">Call the play</span><h1>Task feed</h1><p>Describe the outcome. Gemini will route it through the right agents automatically.</p></div>
        <button className="button primary" type="button" onClick={() => onCreate()}><span aria-hidden="true">+</span> Run a task</button>
      </div>
      {!connection.geminiConfigured && <div className="api-key-banner"><strong>Gemini API key needed</strong><span>Add <code>GEMINI_API_KEY</code> to the root <code>.env</code> file and restart the backend to run tasks.</span></div>}
      <div className="task-list">
        {tasks.length === 0 ? <div className="list-empty"><strong>No tasks yet</strong>Run a task and the orchestrator’s live progress will appear here.</div> : tasks.map((task) => <TaskCard task={task} agents={agents} onSuggestFeedback={onSuggestFeedback} onApplyContext={onApplyContext} key={task.id} />)}
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
  const [authenticated, setAuthenticated] = useState(isDemoAuthenticated);
  const [route, setRoute] = useState(() => window.location.pathname.replace(/\/+$/, "") || "/");
  const [menuOpen, setMenuOpen] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskTargetAgent, setTaskTargetAgent] = useState(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const hasWorkspaceContent = agents.length > 0 || tasks.length > 0;
  const isWorkspaceRoute = route === "/app" || route === "/app/agents" || route === "/app/tasks";
  const view = route === "/app/tasks" ? "tasks" : "agents";

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

  useEffect(() => {
    function handlePopState() {
      setRoute(window.location.pathname.replace(/\/+$/, "") || "/");
      setMenuOpen(false);
      setTaskDialogOpen(false);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function notify(message) {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3200);
  }

  function navigatePath(path, { replace = false } = {}) {
    if (replace) window.history.replaceState({}, "", path);
    else if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setRoute(path);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function navigate(nextView) {
    navigatePath(`/app/${nextView}`);
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
        context: data.context,
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

  async function updateAgentSetup(id, fields) {
    try {
      const updated = await api.updateAgent(id, fields);
      setAgents((current) => current.map((agent) => agent.id === id ? updated : agent));
      notify(`${updated.name}'s setup was updated.`);
      return true;
    } catch (error) {
      notify(error.message);
      return false;
    }
  }

  // Drafts a context suggestion from step feedback — returns the suggestion
  // (string or null) without persisting anything, or undefined on failure.
  async function suggestFeedbackContext(id, payload) {
    try {
      const { suggestedContext } = await api.suggestContextFromFeedback(id, payload);
      return suggestedContext;
    } catch (error) {
      notify(error.message);
      return undefined;
    }
  }

  async function applyAgentContext(id, context) {
    try {
      const updated = await api.updateAgentContext(id, context);
      setAgents((current) => current.map((agent) => agent.id === id ? updated : agent));
      notify(`${updated.name}'s context was updated.`);
      return true;
    } catch (error) {
      notify(error.message);
      return false;
    }
  }

  function openTaskDialog(targetAgent = null) {
    if (!connection.online) {
      notify(IS_LOCAL_DEV ? "Start the Bullpen backend before running a task." : "The Bullpen service is temporarily unavailable.");
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
      if (!data.agentId) navigate("tasks");
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

  function login(username, password) {
    const normalizedUsername = username.trim().toLowerCase();
    let savedAccount = null;
    try { savedAccount = JSON.parse(sessionStorage.getItem(DEMO_ACCOUNT_KEY)); } catch { /* A saved demo account is optional. */ }
    const isAdmin = normalizedUsername === "admin" && password === "password";
    const isSavedAccount = savedAccount && normalizedUsername === savedAccount.username && password === savedAccount.password;
    if (!isAdmin && !isSavedAccount) return false;
    try { sessionStorage.setItem(AUTH_KEY, "true"); } catch { /* Session persistence is optional. */ }
    setAuthenticated(true);
    if (!isWorkspaceRoute) navigatePath("/app/agents");
    return true;
  }

  function signUp(username, password) {
    const account = { username: username.trim().toLowerCase(), password };
    try {
      sessionStorage.setItem(DEMO_ACCOUNT_KEY, JSON.stringify(account));
      sessionStorage.setItem(AUTH_KEY, "true");
    } catch { /* Session persistence is optional. */ }
    setAuthenticated(true);
    if (!isWorkspaceRoute) navigatePath("/app/agents");
  }

  function signOut() {
    try { sessionStorage.removeItem(AUTH_KEY); } catch { /* Session persistence is optional. */ }
    setAuthenticated(false);
    setMenuOpen(false);
    navigatePath("/");
  }

  function openBullpen(authFallbackRoute) {
    navigatePath(authenticated ? "/app/agents" : authFallbackRoute);
  }

  if (!isWorkspaceRoute) {
    const authMode = route === "/signup" ? "signup" : route === "/login" ? "signin" : null;
    return (
      <>
        {showIntro && !authMode && <IntroSequence onComplete={completeIntro} />}
        {authMode
          ? <AuthScreen key={route} initialMode={authMode} onLogin={login} onSignUp={signUp} onBack={() => navigatePath("/")} onModeChange={(mode) => navigatePath(mode === "signin" ? "/login" : "/signup", { replace: true })} />
          : <HomePage authenticated={authenticated} onSignIn={() => openBullpen("/login")} onGetStarted={() => openBullpen("/signup")} />}
      </>
    );
  }

  if (!authenticated) {
    return <AuthScreen initialMode="signin" onLogin={login} onSignUp={signUp} onBack={() => navigatePath("/")} onModeChange={(mode) => navigatePath(mode === "signin" ? "/login" : "/signup")} />;
  }

  if (loading) {
    return <div className="backend-loading"><img src={logoUrl} alt="" /><span>Opening the Bullpen…</span></div>;
  }

  return (
    <>
      <div className={`app-shell${hasWorkspaceContent ? " has-sidebar" : " sidebarless"}`}>
        {hasWorkspaceContent && <Sidebar currentView={view} tasks={tasks} open={menuOpen} connection={connection} onNavigate={navigate} onSignOut={signOut} />}
        {hasWorkspaceContent && menuOpen && <button className="sidebar-backdrop" type="button" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}
        <main className="main-content">
          {hasWorkspaceContent && <button className="icon-button mobile-menu floating-menu" type="button" onClick={() => setMenuOpen((value) => !value)} aria-label="Open navigation" aria-expanded={menuOpen}><MenuIcon /></button>}
          <section className="page-view active" aria-label={view === "agents" ? "Agents" : "Tasks"}>
            {view === "agents"
              ? <AgentsView agents={agents} tasks={tasks} connection={connection} onCreate={createAgent} onOpenTask={openTaskDialog} onStopTask={stopAgentTask} onUpdateInstructions={updateAgentInstructions} onUpdateSetup={updateAgentSetup} onRemove={removeAgent} onModelChange={changeAgentModel} />
              : <TasksView tasks={tasks} agents={agents} connection={connection} onCreate={openTaskDialog} onSuggestFeedback={suggestFeedbackContext} onApplyContext={applyAgentContext} />}
          </section>
        </main>
        <TaskDialog open={taskDialogOpen} canRun={connection.online && connection.geminiConfigured} targetAgent={taskTargetAgent} onClose={() => { setTaskDialogOpen(false); setTaskTargetAgent(null); }} onCreate={createTask} />
        <Toast message={toast} />
      </div>
    </>
  );
}
