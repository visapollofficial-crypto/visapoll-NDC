import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, limit, query, where, type Timestamp } from "firebase/firestore";
import { db } from "../firebase/config";
import { deleteQuiz, saveQuiz, type QuizInput } from "../services/admin";
import { friendlyError } from "../services/api";
import { Loader } from "../components/Loader";

const DEPTS = ["Science", "Commerce", "Humanities"] as const;
interface PQ { id: string; stem: string; subjectName: string; chapter: string; topic: string; difficulty: string }
const toLocal = (t: Timestamp | null) => (t ? new Date(t.toMillis() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");

export default function QuizEditor() {
  const { id } = useParams();
  const editing = id && id !== "new" ? id : undefined;
  const nav = useNavigate();
  const [pool, setPool] = useState<PQ[]>([]);
  const [ready, setReady] = useState(!editing);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [subj, setSubj] = useState("");
  const [find, setFind] = useState("");
  const [f, setF] = useState({
    title: "", type: "weekly" as "weekly" | "topic", subjectName: "", questionCount: 0, durationMin: 20, marksPerQuestion: 1, negativeMarking: 0.25,
    examAttempts: 1, practiceAttempts: 3, shuffleQuestions: true, shuffleOptions: true, revealAnswers: "after_close" as QuizInput["revealAnswers"],
    startAt: "", endAt: "", departments: [...DEPTS] as (typeof DEPTS[number])[], status: "draft" as QuizInput["status"],
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    getDocs(query(collection(db, "questions"), where("status", "==", "published"), limit(400)))
      .then((s) => setPool(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PQ, "id">) }))));
  }, []);
  useEffect(() => {
    if (!editing) return;
    getDoc(doc(db, "quizzes", editing)).then((s) => {
      const d = s.data();
      if (!d) return nav("/admin/quizzes", { replace: true });
      setF({ title: d.title, type: d.type, subjectName: d.subjectName ?? "", questionCount: d.questionCount, durationMin: d.durationMin, marksPerQuestion: d.marksPerQuestion,
        negativeMarking: d.negativeMarking, examAttempts: d.examAttempts, practiceAttempts: d.practiceAttempts, shuffleQuestions: d.shuffleQuestions, shuffleOptions: d.shuffleOptions,
        revealAnswers: d.revealAnswers, startAt: toLocal(d.startAt), endAt: toLocal(d.endAt), departments: d.departments, status: d.status });
      setSel(new Set(d.questionIds)); setReady(true);
    });
  }, [editing, nav]);

  const subjects = useMemo(() => [...new Set(pool.map((p) => p.subjectName))].sort(), [pool]);
  const shown = pool.filter((p) => (!subj || p.subjectName === subj) && (!find || `${p.stem} ${p.chapter} ${p.topic}`.toLowerCase().includes(find.toLowerCase())));
  const toggle = (qid: string) => setSel((s) => { const n = new Set(s); n.has(qid) ? n.delete(qid) : n.add(qid); return n; });

  async function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    if (sel.size === 0) return setError("Select at least one question.");
    setBusy(true);
    try {
      await saveQuiz({
        id: editing, title: f.title, type: f.type, subjectName: f.subjectName || subj, questionIds: [...sel], questionCount: f.questionCount, durationMin: f.durationMin,
        marksPerQuestion: f.marksPerQuestion, negativeMarking: f.negativeMarking, examAttempts: f.examAttempts, practiceAttempts: f.practiceAttempts,
        shuffleQuestions: f.shuffleQuestions, shuffleOptions: f.shuffleOptions, revealAnswers: f.revealAnswers,
        startAt: f.type === "weekly" && f.startAt ? new Date(f.startAt).getTime() : null, endAt: f.type === "weekly" && f.endAt ? new Date(f.endAt).getTime() : null,
        departments: f.departments, status: f.status,
      });
      nav("/admin/quizzes");
    } catch (err) { setError(friendlyError(err)); setBusy(false); }
  }
  async function remove() {
    if (!editing || !confirm("Delete this quiz? Students' past results are kept.")) return;
    setBusy(true);
    try { await deleteQuiz({ id: editing }); nav("/admin/quizzes"); } catch (err) { setError(friendlyError(err)); setBusy(false); }
  }

  if (!ready) return <Loader />;
  const num = (k: "questionCount" | "durationMin" | "marksPerQuestion" | "negativeMarking" | "examAttempts" | "practiceAttempts", label: string, step = 1) => (
    <label>{label}<input type="number" step={step} min={0} value={f[k]} onChange={(e) => set(k, Number(e.target.value))} /></label>
  );
  return (
    <form className="auth-form" style={{ margin: 0, padding: 0, maxWidth: 760 }} onSubmit={submit}>
      <Link to="/admin/quizzes">← Quizzes</Link>
      <h2>{editing ? "Edit quiz" : "New quiz"}</h2>
      <label>Title<input required value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={120} /></label>
      <div className="row">
        <label>Type<select value={f.type} onChange={(e) => set("type", e.target.value as "weekly" | "topic")}><option value="weekly">Weekly model quiz (live exam + practice)</option><option value="topic">Topic quiz (practice only)</option></select></label>
        <label>Status<select value={f.status} onChange={(e) => set("status", e.target.value as QuizInput["status"])}><option value="draft">Draft</option><option value="published">Published</option><option value="closed">Closed</option></select></label>
      </div>
      {f.type === "weekly" && (
        <div className="row">
          <label>Exam opens<input type="datetime-local" required value={f.startAt} onChange={(e) => set("startAt", e.target.value)} /></label>
          <label>Exam closes<input type="datetime-local" required value={f.endAt} onChange={(e) => set("endAt", e.target.value)} /></label>
        </div>
      )}
      <div className="row">{num("durationMin", "Duration (minutes)")}{num("questionCount", "Questions per attempt (0 = all selected)")}</div>
      <div className="row">{num("marksPerQuestion", "Marks per question", 0.5)}{num("negativeMarking", "Negative marking (0.25 = 25%)", 0.05)}</div>
      <div className="row">{f.type === "weekly" && num("examAttempts", "Exam attempts")}{num("practiceAttempts", "Practice attempts")}</div>
      <label>Show correct answers<select value={f.revealAnswers} onChange={(e) => set("revealAnswers", e.target.value as QuizInput["revealAnswers"])}><option value="immediately">Right after submitting</option><option value="after_close">After the exam closes</option><option value="never">Never</option></select></label>
      <label className="check"><input type="checkbox" checked={f.shuffleQuestions} onChange={(e) => set("shuffleQuestions", e.target.checked)} /><span>Randomise question order</span></label>
      <label className="check"><input type="checkbox" checked={f.shuffleOptions} onChange={(e) => set("shuffleOptions", e.target.checked)} /><span>Randomise option order</span></label>
      <fieldset className="fieldset"><legend>Visible to</legend>
        {DEPTS.map((d) => <label key={d} className="check"><input type="checkbox" checked={f.departments.includes(d)} onChange={(e) => set("departments", e.target.checked ? [...f.departments, d] : f.departments.filter((x) => x !== d))} /><span>{d}</span></label>)}
      </fieldset>

      <fieldset className="fieldset"><legend>Questions ({sel.size} selected)</legend>
        <div className="filters">
          <input type="search" aria-label="Search questions" placeholder="Search" value={find} onChange={(e) => setFind(e.target.value)} />
          <select aria-label="Subject" value={subj} onChange={(e) => setSubj(e.target.value)}><option value="">All subjects</option>{subjects.map((s) => <option key={s}>{s}</option>)}</select>
        </div>
        <div className="pick-list">
          {pool.length === 0 && <p className="muted small">No published questions yet. Publish some in the Question bank.</p>}
          {shown.map((p) => (
            <label key={p.id} className="check"><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
              <span><span className="small muted">{p.subjectName} · {p.chapter} · {p.difficulty}</span><br />{p.stem.length > 110 ? p.stem.slice(0, 110) + "…" : p.stem}</span></label>
          ))}
        </div>
        {[...sel].some((s) => !pool.some((p) => p.id === s)) && <p className="small muted">Some selected questions aren't published anymore. Publishing this quiz will ask you to fix that.</p>}
      </fieldset>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="composer-bar">
        <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save quiz"}</button>
        {editing && <button type="button" className="btn ghost" disabled={busy} onClick={remove}>Delete</button>}
      </div>
    </form>
  );
}
