import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "../firebase/config";
import { setQuestionsStatus } from "../services/admin";
import { friendlyError } from "../services/api";

export interface Q { id: string; stem: string; subjectName: string; chapter: string; topic: string; difficulty: string; type: string; status: string; aiGenerated?: boolean }
const STATUSES = ["draft", "ai_generated", "approved", "published", "rejected"];

export default function QuestionBank() {
  const [params] = useSearchParams();
  const [items, setItems] = useState<Q[] | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => getDocs(query(collection(db, "questions"), orderBy("createdAt", "desc"), limit(300)))
    .then((s) => setItems(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Q, "id">) })))).catch(() => setError("Couldn't load questions."));
  useEffect(() => { load(); }, []);

  const subjects = useMemo(() => [...new Set(items?.map((i) => i.subjectName) ?? [])].sort(), [items]);
  const shown = items?.filter((i) => (!status || i.status === status) && (!subject || i.subjectName === subject) && (!text || `${i.stem} ${i.chapter} ${i.topic}`.toLowerCase().includes(text.toLowerCase()))) ?? [];
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function bulk(to: "approved" | "rejected" | "published") {
    setBusy(true); setMsg(""); setError("");
    try {
      const r = await setQuestionsStatus({ ids: [...sel], status: to });
      setMsg(`${r.updated} updated${r.skipped ? `, ${r.skipped} skipped (AI questions must be approved before publishing)` : ""}.`);
      setSel(new Set()); await load();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="composer-bar">
        <Link className="btn" to="/admin/questions/new">New question</Link>
        <Link className="btn ghost" to="/admin/ai-generate">Generate with AI</Link>
      </div>
      <div className="filters" style={{ marginTop: "1rem" }}>
        <input type="search" aria-label="Search questions" placeholder="Search question, chapter or topic" value={text} onChange={(e) => setText(e.target.value)} />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
        <select aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)}><option value="">All subjects</option>{subjects.map((s) => <option key={s}>{s}</option>)}</select>
      </div>

      {sel.size > 0 && (
        <div className="bulkbar" role="region" aria-label="Bulk actions">
          <strong>{sel.size} selected</strong>
          <button className="btn" disabled={busy} onClick={() => bulk("approved")}>Approve</button>
          <button className="btn" disabled={busy} onClick={() => bulk("published")}>Publish</button>
          <button className="btn ghost" disabled={busy} onClick={() => bulk("rejected")}>Reject</button>
          <button className="linkbtn" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
      {msg && <p role="status">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {items === null && !error && <div className="post skeleton-card" />}
      {items && shown.length === 0 && <p className="muted">No questions match. Only <strong>published</strong> questions can be used in quizzes.</p>}
      {shown.length > 0 && <button className="linkbtn" onClick={() => setSel(sel.size === shown.length ? new Set() : new Set(shown.map((q) => q.id)))}>{sel.size === shown.length ? "Deselect all" : `Select all ${shown.length}`}</button>}
      {shown.map((q) => (
        <div key={q.id} className="qrow">
          <input type="checkbox" aria-label="Select question" checked={sel.has(q.id)} onChange={() => toggle(q.id)} />
          <Link to={`/admin/questions/${q.id}`} className="tile material" style={{ flex: 1 }}>
            <span className="small">{q.subjectName} · {q.chapter}{q.topic && ` · ${q.topic}`} · {q.difficulty}{q.aiGenerated && " · AI"}</span>
            <strong>{q.stem.length > 140 ? q.stem.slice(0, 140) + "…" : q.stem}</strong>
            <span className={`badge ${q.status === "published" ? "verified" : q.status === "rejected" ? "rejected" : "pending"}`} style={{ justifySelf: "start" }}>{q.status.replace("_", " ")}</span>
          </Link>
        </div>
      ))}
      {items && items.length >= 300 && <p className="muted small">Showing the latest 300. Use search to find older questions.</p>}
    </>
  );
}
