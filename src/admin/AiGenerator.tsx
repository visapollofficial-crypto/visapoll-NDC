import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "../firebase/config";
import { generateQuestions } from "../services/admin";
import { friendlyError } from "../services/api";

interface M { id: string; subjectId: string; subjectName: string; chapter: string; topic: string; classDate: string; summary: string; keyPoints: string[] }
const TYPES = [["conceptual", "Conceptual"], ["calculation", "Calculation"], ["application", "Application"], ["important", "Important topic"]] as const;

export default function AiGenerator() {
  const [mats, setMats] = useState<M[] | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [count, setCount] = useState(10);
  const [mix, setMix] = useState({ hard: 70, medium: 20, easy: 10 });
  const [types, setTypes] = useState<string[]>(["conceptual", "application"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Awaited<ReturnType<typeof generateQuestions>> | null>(null);

  useEffect(() => {
    getDocs(query(collection(db, "classMaterials"), orderBy("classDate", "desc"), limit(100)))
      .then((s) => setMats(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<M, "id">) })))).catch(() => setError("Couldn't load class materials."));
  }, []);

  const subject = mats?.find((m) => m.id === sel[0])?.subjectId;
  const total = mix.hard + mix.medium + mix.easy;

  function toggle(m: M) {
    setSel((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : s.length >= 5 ? s : [...s, m.id]));
  }

  async function run(e: FormEvent) {
    e.preventDefault(); setError(""); setDone(null);
    if (sel.length === 0) return setError("Select at least one class material.");
    if (total !== 100) return setError("The difficulty mix must add up to 100%.");
    if (types.length === 0) return setError("Choose at least one question type.");
    setBusy(true);
    try { setDone(await generateQuestions({ materialIds: sel, count, mix, types })); }
    catch (err) { setError(friendlyError(err)); }
    finally { setBusy(false); }
  }

  const num = (k: "hard" | "medium" | "easy", label: string) => (
    <label>{label} %<input type="number" min={0} max={100} value={mix[k]} onChange={(e) => setMix({ ...mix, [k]: Number(e.target.value) })} /></label>
  );

  return (
    <form className="auth-form" style={{ margin: 0, padding: 0, maxWidth: 760 }} onSubmit={run}>
      <p className="muted">The AI writes questions <strong>only from the class material you select</strong>. Every question lands in the review queue as “AI generated”. Nothing is published until you approve it.</p>

      <fieldset className="fieldset"><legend>1. Class materials (up to 5, one subject)</legend>
        {mats === null && !error && <div className="skeleton-bar" />}
        {mats?.length === 0 && <p className="muted small">No materials yet. Add class materials first.</p>}
        <div className="pick-list">
          {mats?.map((m) => {
            const blocked = !!subject && m.subjectId !== subject;
            const thin = (m.summary?.length ?? 0) + (m.keyPoints?.join("").length ?? 0) < 80;
            return (
              <label key={m.id} className="check" style={{ opacity: blocked ? 0.45 : 1 }}>
                <input type="checkbox" disabled={blocked} checked={sel.includes(m.id)} onChange={() => toggle(m)} />
                <span><span className="small muted">{m.subjectName} · {m.classDate}</span><br />{m.chapter}{m.topic && `: ${m.topic}`}{thin && <span className="badge pending" style={{ marginLeft: 8 }}>little text</span>}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="fieldset"><legend>2. How many, and how hard</legend>
        <label>Number of questions (1 to 30)<input type="number" min={1} max={30} value={count} onChange={(e) => setCount(Number(e.target.value))} /></label>
        <div className="row3">{num("hard", "Hard")}{num("medium", "Medium")}{num("easy", "Easy")}</div>
        <p className={total === 100 ? "muted small" : "error"}>Total: {total}%</p>
      </fieldset>

      <fieldset className="fieldset"><legend>3. Question types</legend>
        {TYPES.map(([k, label]) => <label key={k} className="check"><input type="checkbox" checked={types.includes(k)} onChange={(e) => setTypes(e.target.checked ? [...types, k] : types.filter((x) => x !== k))} /><span>{label}</span></label>)}
      </fieldset>

      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" disabled={busy}>{busy ? "Generating… this can take up to a minute" : "Generate questions"}</button>

      {done && (
        <div className="notice" role="status">
          <strong>{done.created} of {done.requested} questions created</strong> ({done.actual.hard} hard, {done.actual.medium} medium, {done.actual.easy} easy).
          {done.rejected > 0 && <> {done.rejected} were discarded as invalid{done.reasons.length > 0 && `: ${done.reasons.join("; ")}`}.</>}
          <p><Link className="btn" to="/admin/questions?status=ai_generated">Review the questions</Link></p>
          <p className="small">AI can be wrong. Check every answer and explanation against your class notes before approving.</p>
        </div>
      )}
    </form>
  );
}
