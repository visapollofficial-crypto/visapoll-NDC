import { useEffect, useState } from "react";
import { adminGetAiConfig, adminSaveAiConfig, adminTestAi, type AiConfig, type ProviderName, type Route } from "../services/admin";
import { friendlyError } from "../services/api";
import { Loader } from "../components/Loader";

const LABEL: Record<string, string> = {
  quizGeneration: "Quiz generation", difficultyClassification: "Difficulty classification", explanation: "Study explanations", homework: "Homework help",
  chat: "Chat assistant", summarization: "Summarisation", extraction: "Content extraction", learningPattern: "Learning pattern analysis",
};

function RouteEditor({ value, onChange, keys, label }: { value: Route; onChange: (r: Route) => void; keys: Record<ProviderName, boolean>; label: string }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function test() {
    setBusy(true); setMsg("");
    try { const r = await adminTestAi(value); setMsg(`Works (${r.latencyMs} ms)`); } catch (e) { setMsg(friendlyError(e)); }
    finally { setBusy(false); }
  }
  return (
    <div className="post">
      <strong>{label}</strong>
      <div className="row3">
        <label>Provider<select value={value.provider} onChange={(e) => onChange({ ...value, provider: e.target.value as ProviderName })}>
          <option value="gemini">Gemini {keys.gemini ? "" : "(no key)"}</option><option value="openai">OpenAI {keys.openai ? "" : "(no key)"}</option></select></label>
        <label>Model<input value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value.trim() })} maxLength={80} /></label>
        <label>Temperature<input type="number" step={0.1} min={0} max={1.5} value={value.temperature} onChange={(e) => onChange({ ...value, temperature: Number(e.target.value) })} /></label>
      </div>
      <div className="composer-bar">
        <button type="button" className="btn ghost" disabled={busy} onClick={test}>{busy ? "Testing…" : "Test connection"}</button>
        {msg && <span className="small" role="status">{msg}</span>}
      </div>
    </div>
  );
}

export default function AiSettings() {
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [keys, setKeys] = useState<Record<ProviderName, boolean>>({ gemini: false, openai: false });
  const [tasks, setTasks] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { adminGetAiConfig().then((r) => { setCfg(r.config); setKeys(r.keys); setTasks(r.tasks); }).catch(() => setError("Couldn't load AI settings.")); }, []);
  if (error && !cfg) return <p className="error" role="alert">{error}</p>;
  if (!cfg) return <Loader />;

  async function save() {
    setBusy(true); setMsg(""); setError("");
    try { await adminSaveAiConfig(cfg!); setMsg("AI settings saved."); } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }
  const setTask = (t: string, r: Route | null) => {
    const next = { ...cfg.tasks }; if (r) next[t] = r; else delete next[t];
    setCfg({ ...cfg, tasks: next });
  };

  return (
    <>
      <p className="muted">API keys live on the server only and are never sent to the browser. Provider keys: Gemini <span className={`badge ${keys.gemini ? "verified" : "rejected"}`}>{keys.gemini ? "configured" : "missing"}</span> OpenAI <span className={`badge ${keys.openai ? "verified" : "rejected"}`}>{keys.openai ? "configured" : "missing"}</span></p>
      <p className="muted small">Use a model name that exists on your own provider account. Some newer models ignore or reject the temperature setting.</p>
      <h2>Default</h2>
      <RouteEditor label="Used for every task without its own setting" value={cfg.default} onChange={(r) => setCfg({ ...cfg, default: r })} keys={keys} />
      <h2 style={{ marginTop: "1.25rem" }}>Per-task overrides</h2>
      {tasks.map((t) => cfg.tasks[t]
        ? <div key={t}><RouteEditor label={LABEL[t] ?? t} value={cfg.tasks[t]!} onChange={(r) => setTask(t, r)} keys={keys} /><button className="linkbtn" onClick={() => setTask(t, null)}>Use default for {LABEL[t]}</button></div>
        : <div key={t} className="post" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span>{LABEL[t] ?? t} <span className="muted small">(default)</span></span><button className="btn ghost" onClick={() => setTask(t, { ...cfg.default })}>Customise</button></div>)}
      {error && <p className="error" role="alert">{error}</p>}
      {msg && <p role="status">{msg}</p>}
      <button className="btn" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save AI settings"}</button>
    </>
  );
}
