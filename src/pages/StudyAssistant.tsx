import { useEffect, useRef, useState, type FormEvent } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { AiBadge, RichText } from "../components/RichText";
import { studyChat, type ChatMsg } from "../services/ai";
import { friendlyError } from "../services/api";

interface Mat { id: string; subjectName: string; chapter: string; topic: string; classDate: string }
const QUICK = [
  "Explain today's class in simple words.", "Give me 10 practice questions from the latest class.", "What should I revise?",
  "Help me prepare for the weekly quiz.", "Give me harder questions.",
];

export default function StudyAssistant() {
  const { profile } = useAuth();
  const [mats, setMats] = useState<Mat[]>([]);
  const [material, setMaterial] = useState("");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profile) return;
    getDocs(query(collection(db, "classMaterials"), where("status", "==", "published"), where("departments", "array-contains", profile.department), orderBy("classDate", "desc"), limit(20)))
      .then((s) => setMats(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Mat, "id">) })))).catch(() => undefined);
  }, [profile]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);

  async function ask(q: string) {
    const t = q.trim();
    if (!t || busy) return;
    const next: ChatMsg[] = [...msgs, { role: "user", content: t }];
    setMsgs(next); setText(""); setBusy(true); setError("");
    try {
      const reply = await studyChat(next.slice(-10), material || undefined);
      setMsgs([...next, { role: "assistant", content: reply }]);
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); ask(text); };

  return (
    <div className="assistant">
      <header className="page-head"><h1>AI study assistant</h1></header>
      <label className="small">Answer from
        <select value={material} onChange={(e) => { setMaterial(e.target.value); setMsgs([]); }}>
          <option value="">My latest classes</option>
          {mats.map((m) => <option key={m.id} value={m.id}>{m.subjectName}: {m.chapter}{m.topic && ` (${m.topic})`} · {m.classDate}</option>)}
        </select>
      </label>
      <AiBadge />

      <div className="thread" aria-live="polite">
        {msgs.length === 0 && (
          <div className="quick">
            <p className="muted">Ask about your class notes, or start with one of these:</p>
            {QUICK.map((q) => <button key={q} className="chip" onClick={() => ask(q)}>{q}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>{m.role === "assistant" ? <RichText text={m.content} /> : <p>{m.content}</p>}</div>
        ))}
        {busy && <div className="bubble assistant"><span className="dots" aria-label="The assistant is thinking"><i /><i /><i /></span></div>}
        {error && <p className="error" role="alert">{error}</p>}
        <div ref={end} />
      </div>

      <form className="composer-row" onSubmit={submit}>
        <label className="sr-only" htmlFor="ai-q">Your question</label>
        <input id="ai-q" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="Ask a question about your class" />
        <button className="btn" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  );
}
