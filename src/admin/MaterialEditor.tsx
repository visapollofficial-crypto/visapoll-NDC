import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebase/config";
import { deleteMaterial, saveMaterial, type MaterialInput } from "../services/admin";
import { uploadClassFile, type Attachment } from "../services/upload";
import { parseDefinitions, parseLinks, showDefinitions, showLinks, toLines } from "../utils/text";
import { Loader } from "../components/Loader";

const DEPTS = ["Science", "Commerce", "Humanities"] as const;
interface Subject { id: string; name: string; active: boolean }

export default function MaterialEditor() {
  const { id } = useParams();
  const editing = id && id !== "new" ? id : undefined;
  const nav = useNavigate();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [ready, setReady] = useState(!editing);
  const [f, setF] = useState({
    subjectId: "", chapter: "", topic: "", classDate: new Date().toISOString().slice(0, 10), teacher: "", summary: "",
    keyPoints: "", formulas: "", definitions: "", examples: "", homework: "", links: "",
    departments: [...DEPTS] as (typeof DEPTS[number])[], status: "draft" as "draft" | "published",
  });
  const [files, setFiles] = useState<Attachment[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => { getDocs(query(collection(db, "subjects"), orderBy("name"))).then((s) => setSubjects(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Subject, "id">) })))); }, []);
  useEffect(() => {
    if (!editing) return;
    getDoc(doc(db, "classMaterials", editing)).then((s) => {
      const m = s.data() as MaterialInput | undefined;
      if (!m) return nav("/admin/materials", { replace: true });
      setF({ subjectId: m.subjectId, chapter: m.chapter, topic: m.topic, classDate: m.classDate, teacher: m.teacher, summary: m.summary,
        keyPoints: m.keyPoints.join("\n"), formulas: m.formulas.join("\n"), definitions: showDefinitions(m.definitions),
        examples: m.examples.join("\n"), homework: m.homework, links: showLinks(m.links), departments: m.departments, status: m.status });
      setFiles(m.attachments); setReady(true);
    });
  }, [editing, nav]);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    setBusy(true); setError("");
    try { const up: Attachment[] = []; for (const file of Array.from(list)) up.push(await uploadClassFile(file)); setFiles((p) => [...p, ...up].slice(0, 15)); }
    catch (err) { setError(err instanceof Error ? err.message : "Upload failed."); }
    finally { setBusy(false); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    const subject = subjects.find((s) => s.id === f.subjectId);
    if (!subject) return setError("Choose a subject. Add subjects in the Subjects tab first.");
    if (f.departments.length === 0) return setError("Choose at least one department.");
    if (parseLinks(f.links).some((l) => !/^https:\/\//i.test(l.url))) return setError("Links must start with https://");
    setBusy(true);
    try {
      await saveMaterial({
        id: editing, subjectId: subject.id, subjectName: subject.name, chapter: f.chapter, topic: f.topic, classDate: f.classDate, teacher: f.teacher,
        summary: f.summary, keyPoints: toLines(f.keyPoints), formulas: toLines(f.formulas), definitions: parseDefinitions(f.definitions),
        examples: toLines(f.examples), homework: f.homework, links: parseLinks(f.links), attachments: files, departments: f.departments, status: f.status,
      });
      nav("/admin/materials");
    } catch { setError("Couldn't save. Check subject, chapter, date and links."); setBusy(false); }
  }

  async function remove() {
    if (!editing || !confirm("Delete this material and its files?")) return;
    setBusy(true);
    try { await deleteMaterial({ id: editing }); nav("/admin/materials"); } catch { setError("Couldn't delete."); setBusy(false); }
  }

  if (!ready) return <Loader />;
  const text = (k: "keyPoints" | "formulas" | "definitions" | "examples" | "links", label: string, hint: string) => (
    <label>{label} <span className="muted small">({hint})</span><textarea rows={4} value={f[k]} onChange={(e) => set(k, e.target.value)} /></label>
  );

  return (
    <form className="auth-form" style={{ margin: 0, padding: 0, maxWidth: 720 }} onSubmit={submit}>
      <Link to="/admin/materials">← Materials</Link>
      <h2>{editing ? "Edit class material" : "New class material"}</h2>
      <div className="row">
        <label>Subject
          <select value={f.subjectId} onChange={(e) => set("subjectId", e.target.value)} required>
            <option value="">Choose…</option>
            {subjects.filter((s) => s.active || s.id === f.subjectId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>Class date<input type="date" value={f.classDate} onChange={(e) => set("classDate", e.target.value)} required /></label>
      </div>
      <div className="row">
        <label>Chapter<input value={f.chapter} onChange={(e) => set("chapter", e.target.value)} required maxLength={120} /></label>
        <label>Topic<input value={f.topic} onChange={(e) => set("topic", e.target.value)} maxLength={120} /></label>
      </div>
      <label>Teacher / class info<input value={f.teacher} onChange={(e) => set("teacher", e.target.value)} maxLength={80} /></label>
      <label>What was taught<textarea rows={4} value={f.summary} onChange={(e) => set("summary", e.target.value)} maxLength={5000} /></label>
      {text("keyPoints", "Important points", "one per line")}
      {text("formulas", "Formulas", "one per line")}
      {text("definitions", "Definitions", "term: meaning, one per line")}
      {text("examples", "Examples", "one per line")}
      <label>Homework<textarea rows={3} value={f.homework} onChange={(e) => set("homework", e.target.value)} maxLength={3000} /></label>
      {text("links", "Reference links", "Title | https://…, one per line")}

      <fieldset className="fieldset"><legend>Files (PDF, images, MP4, up to 24 MB each)</legend>
        {files.map((a) => <div key={a.path} className="small">{a.name} <button type="button" className="linkbtn" onClick={() => setFiles(files.filter((x) => x.path !== a.path))}>Remove</button></div>)}
        <label className="btn ghost filebtn">{busy ? "Working…" : "Add files"}<input type="file" hidden multiple disabled={busy} accept="application/pdf,image/jpeg,image/png,image/webp,video/mp4" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} /></label>
      </fieldset>

      <fieldset className="fieldset"><legend>Visible to</legend>
        {DEPTS.map((d) => <label key={d} className="check"><input type="checkbox" checked={f.departments.includes(d)} onChange={(e) => set("departments", e.target.checked ? [...f.departments, d] : f.departments.filter((x) => x !== d))} /><span>{d}</span></label>)}
      </fieldset>
      <label>Status
        <select value={f.status} onChange={(e) => set("status", e.target.value as "draft" | "published")}>
          <option value="draft">Draft (only admins see it)</option><option value="published">Published (students see it)</option>
        </select>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="composer-bar">
        <button className="btn" disabled={busy}>{busy ? "Please wait…" : "Save"}</button>
        {editing && <button type="button" className="btn ghost" disabled={busy} onClick={remove}>Delete</button>}
      </div>
    </form>
  );
}
