import { useState, type FormEvent } from "react";
import { adminSendNotification } from "../services/admin";
import { friendlyError } from "../services/api";

type Scope = "all" | "department" | "section" | "student";

export default function Notify() {
  const [scope, setScope] = useState<Scope>("all");
  const [department, setDepartment] = useState("Science");
  const [section, setSection] = useState("");
  const [studentId, setStudentId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [important, setImportant] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function send(e: FormEvent) {
    e.preventDefault(); setError(""); setDone("");
    if (link && !/^\/[\w\-/]*$/.test(link)) return setError("Link must be a page in the app, like /quiz or /learn.");
    if (!confirm(scope === "all" ? "Send this to ALL students?" : "Send this notification?")) return;
    setBusy(true);
    try {
      const r = await adminSendNotification({ scope, department: scope === "department" || scope === "section" ? department : undefined, section: scope === "section" ? section : undefined,
        studentId: scope === "student" ? studentId : undefined, title, body, link: link || undefined, important });
      setDone(`Sent to ${r.recipients} student${r.recipients === 1 ? "" : "s"} (${r.pushed} phone/browser pushes).${r.pushConfigured ? "" : " Push links are off until APP_URL is configured; students still see it in the app."}`);
      setTitle(""); setBody("");
    } catch (err) { setError(friendlyError(err)); }
    finally { setBusy(false); }
  }

  return (
    <form className="auth-form" style={{ margin: 0, padding: 0, maxWidth: 560 }} onSubmit={send}>
      <p className="muted">Automatic notifications (new material, new quiz, quiz reminders, results, plan expiry) are sent for you. Use this for anything else.</p>
      <label>Send to
        <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
          <option value="all">All students</option><option value="department">A department</option>
          <option value="section">A class / section</option><option value="student">One student</option>
        </select>
      </label>
      {(scope === "department" || scope === "section") && (
        <label>Department<select value={department} onChange={(e) => setDepartment(e.target.value)}><option>Science</option><option>Commerce</option><option>Humanities</option></select></label>
      )}
      {scope === "section" && <label>Class / section (exactly as students entered it)<input required value={section} onChange={(e) => setSection(e.target.value)} maxLength={20} /></label>}
      {scope === "student" && <label>Student ID<input required value={studentId} onChange={(e) => setStudentId(e.target.value)} maxLength={30} /></label>}
      <label>Title<input required value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} /></label>
      <label>Message<textarea required rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={300} /></label>
      <label>Opens page (optional)<input placeholder="/quiz" value={link} onChange={(e) => setLink(e.target.value)} maxLength={100} /></label>
      <label className="check"><input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} /><span>Important: send even to students who muted announcements</span></label>
      {error && <p className="error" role="alert">{error}</p>}
      {done && <p role="status">{done}</p>}
      <button className="btn" disabled={busy}>{busy ? "Sending…" : "Send notification"}</button>
    </form>
  );
}
