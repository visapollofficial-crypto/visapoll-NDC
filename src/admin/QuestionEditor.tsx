import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebase/config";
import { deleteQuestion, saveQuestion, type QStatus, type QuestionInput } from "../services/admin";
import { Loader } from "../components/Loader";
import { friendlyError } from "../services/api";

interface Subject { id: string; name: string; active: boolean }

export default function QuestionEditor() {
  const { id } = useParams();
  const editing = id && id !== "new" ? id : undefined;
  const nav = useNavigate();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [ready, setReady] = useState(!editing);
  const [f, setF] = useState({
    subjectId: "", chapter: "", topic: "", difficulty: "medium" as QuestionInput["difficulty"], type: "conceptual" as QuestionInput["type"],
    sourceDate: "", stem: "", options: ["", "", "", ""], correct: "a" as QuestionInput["correct"], explanation: "", status: "draft" as QStatus,
  });
  const [error, setError] = useState("");
  const [ai, setAi] = useState<{ model: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => { getDocs(query(collection(db, "subjects"), orderBy("name"))).then((s) => setSubjects(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Subject, "id">) })))); }, []);
  useEffect(() => {
    if (!editing) return;
    Promise.all([getDoc(doc(db, "questions", editing)), getDoc(doc(db, "questionKeys", editing))]).then(([q, k]) => {
      const d = q.data();
      if (!d) return nav("/admin/questions", { replace: true });
      setF({ subjectId: d.subjectId, chapter: d.chapter, topic: d.topic ?? "", difficulty: d.difficulty, type: d.type, sourceDate: d.sourceDate ?? "", stem: d.stem,
        options: (d.options as { text: string }[]).map((o) => o.text), correct: k.data()?.correct ?? "a", explanation: k.data()?.explanation ?? "", status: d.status });
      setAi(d.aiGenerated ? { model: d.ai?.model ?? "AI" } : null);
      setReady(true);
    });
  }, [editing, nav]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    const subject = subjects.find((s) => s.id === f.subjectId);
    if (!subject) return setError("Choose a subject. Add subjects in the Subjects tab first.");
    setBusy(true);
    try {
      await saveQuestion({ id: editing, subjectId: subject.id, subjectName: subject.name, chapter: f.chapter, topic: f.topic, difficulty: f.difficulty, type: f.type,
        sourceDate: f.sourceDate, stem: f.stem, options: f.options, correct: f.correct, explanation: f.explanation, status: f.status });
      nav("/admin/questions");
    } catch (err) { setError(friendlyError(err)); setBusy(false); }
  }
  async function remove() {
    if (!editing || !confirm("Delete this question?")) return;
    setBusy(true);
    try { await deleteQuestion({ id: editing }); nav("/admin/questions"); } catch (err) { setError(friendlyError(err)); setBusy(false); }
  }

  if (!ready) return <Loader />;
  return (
    <form className="auth-form" style={{ margin: 0, padding: 0, maxWidth: 720 }} onSubmit={submit}>
      <Link to="/admin/questions">← Question bank</Link>
      <h2>{editing ? "Edit question" : "New question"}</h2>
      {ai && <p className="notice">Written by AI ({ai.model}). Check the answer and explanation against your class notes. It must be <strong>approved</strong> before it can be published.</p>}
      <div className="row">
        <label>Subject<select required value={f.subjectId} onChange={(e) => set("subjectId", e.target.value)}><option value="">Choose…</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Source class date (optional)<input type="date" value={f.sourceDate} onChange={(e) => set("sourceDate", e.target.value)} /></label>
      </div>
      <div className="row">
        <label>Chapter<input required value={f.chapter} onChange={(e) => set("chapter", e.target.value)} maxLength={120} /></label>
        <label>Topic<input value={f.topic} onChange={(e) => set("topic", e.target.value)} maxLength={120} /></label>
      </div>
      <div className="row">
        <label>Difficulty<select value={f.difficulty} onChange={(e) => set("difficulty", e.target.value as typeof f.difficulty)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
        <label>Type<select value={f.type} onChange={(e) => set("type", e.target.value as typeof f.type)}><option value="conceptual">Conceptual</option><option value="calculation">Calculation</option><option value="application">Application</option><option value="important">Important topic</option></select></label>
      </div>
      <label>Question<textarea required rows={3} value={f.stem} onChange={(e) => set("stem", e.target.value)} maxLength={1000} /></label>
      <fieldset className="fieldset"><legend>Options (select the correct one)</legend>
        {f.options.map((o, i) => (
          <div key={i} className="opt-edit">
            <input type="radio" name="correct" aria-label={`Option ${"ABCD"[i]} is correct`} checked={f.correct === "abcd"[i]} onChange={() => set("correct", "abcd"[i] as typeof f.correct)} />
            <span className="letter">{"ABCD"[i]}</span>
            <input required aria-label={`Option ${"ABCD"[i]}`} value={o} maxLength={300} onChange={(e) => set("options", f.options.map((x, j) => (j === i ? e.target.value : x)))} />
          </div>
        ))}
      </fieldset>
      <label>Explanation (shown after the quiz)<textarea rows={3} value={f.explanation} onChange={(e) => set("explanation", e.target.value)} maxLength={1500} /></label>
      <label>Status
        <select value={f.status} onChange={(e) => set("status", e.target.value as QStatus)}>
          <option value="draft">Draft</option><option value="ai_generated">AI generated (needs review)</option><option value="approved">Approved</option>
          <option value="published">Published (usable in quizzes)</option><option value="rejected">Rejected</option>
        </select>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="composer-bar">
        <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save question"}</button>
        {editing && <button type="button" className="btn ghost" disabled={busy} onClick={remove}>Delete</button>}
      </div>
    </form>
  );
}
