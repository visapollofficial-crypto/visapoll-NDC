import { useEffect, useMemo, useState, type FormEvent } from "react";
import { collection, deleteDoc, doc, getDocs, limit, orderBy, query, where, type Timestamp } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { AiBadge, RichText } from "../components/RichText";
import { homeworkHelp, type HwMode } from "../services/ai";
import { friendlyError } from "../services/api";
import { uploadHomeworkImage } from "../services/upload";
import { timeAgo } from "../utils/time";

interface Mat { id: string; subjectName: string; chapter: string; topic: string }
interface Hist { id: string; question: string; mode: HwMode; answer: string; hadImage: boolean; createdAt: Timestamp }
const MODES: [HwMode, string][] = [["hint", "Give me a hint"], ["steps", "Explain step by step"], ["example", "Show a similar example"]];

export default function Homework() {
  const { user, profile } = useAuth();
  const [question, setQuestion] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [material, setMaterial] = useState("");
  const [mats, setMats] = useState<Mat[]>([]);
  const [answer, setAnswer] = useState<{ text: string; mode: HwMode } | null>(null);
  const [hist, setHist] = useState<Hist[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<HwMode | null>(null);
  const [error, setError] = useState("");
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const loadHistory = () => user && getDocs(query(collection(db, "homeworkHistory"), where("uid", "==", user.uid), orderBy("createdAt", "desc"), limit(15)))
    .then((s) => setHist(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Hist, "id">) })))).catch(() => undefined);
  useEffect(() => { loadHistory(); /* eslint-disable-next-line */ }, [user]);
  useEffect(() => {
    if (!profile) return;
    getDocs(query(collection(db, "classMaterials"), where("status", "==", "published"), where("departments", "array-contains", profile.department), orderBy("classDate", "desc"), limit(20)))
      .then((s) => setMats(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Mat, "id">) })))).catch(() => undefined);
  }, [profile]);

  async function ask(mode: HwMode) {
    if (!user) return;
    if (!question.trim() && !file) return setError("Type your question or add a photo of it.");
    setBusy(mode); setError(""); setAnswer(null);
    try {
      const imagePath = file ? await uploadHomeworkImage(user.uid, file) : undefined;
      const r = await homeworkHelp({ question: question.trim(), mode, materialId: material || undefined, imagePath });
      setAnswer({ text: r.answer, mode }); setFile(null); loadHistory();
    } catch (e) { setError(e instanceof Error && !("code" in e) ? e.message : friendlyError(e)); }
    finally { setBusy(null); }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); ask("steps"); };
  async function remove(id: string) { await deleteDoc(doc(db, "homeworkHistory", id)).catch(() => undefined); setHist((h) => h.filter((x) => x.id !== id)); }

  return (
    <>
      <header className="page-head"><h1>Homework help</h1></header>
      <p className="muted">The helper is built to teach you, not just hand over answers. Try a hint first.</p>
      <form className="composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="hw-q">Your homework question</label>
        <textarea id="hw-q" rows={4} maxLength={2000} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Type your question here, or add a photo of it" />
        {preview && <div className="preview"><img src={preview} alt="Your homework photo" style={{ width: 160, height: "auto" }} /><button type="button" className="linkbtn" onClick={() => setFile(null)}>Remove photo</button></div>}
        <div className="composer-bar">
          <label className="btn ghost filebtn">Add photo<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} /></label>
          <label className="small">Use my class notes for
            <select value={material} onChange={(e) => setMaterial(e.target.value)}><option value="">None</option>{mats.map((m) => <option key={m.id} value={m.id}>{m.subjectName}: {m.chapter}</option>)}</select>
          </label>
        </div>
        <div className="composer-bar">
          {MODES.map(([m, label]) => <button key={m} type="button" className={m === "hint" ? "btn" : "btn ghost"} disabled={!!busy} onClick={() => ask(m)}>{busy === m ? "Thinking…" : label}</button>)}
        </div>
        <p className="muted small">Photos are used once to read your question and then deleted.</p>
        {error && <p className="error" role="alert">{error}</p>}
      </form>

      {answer && (
        <section className="post" aria-live="polite">
          <strong>{MODES.find(([m]) => m === answer.mode)?.[1]}</strong>
          <RichText text={answer.text} />
          <AiBadge />
        </section>
      )}

      {hist.length > 0 && (
        <section style={{ marginTop: "1.25rem" }}>
          <h2>Earlier questions</h2>
          {hist.map((h) => (
            <div key={h.id} className="post">
              <button className="linkbtn" style={{ textAlign: "left" }} onClick={() => setOpen(open === h.id ? null : h.id)} aria-expanded={open === h.id}>
                <strong>{h.question || "Photo question"}</strong> <span className="muted small">· {h.createdAt ? timeAgo(h.createdAt.toMillis()) : ""}</span>
              </button>
              {open === h.id && <><RichText text={h.answer} /><button className="linkbtn" onClick={() => remove(h.id)}>Delete</button></>}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
