import { useEffect, useState } from "react";
import { collection, getCountFromServer } from "firebase/firestore";
import { db } from "../firebase/config";
import { importRoster } from "../services/admin";

export default function Roster() {
  const [text, setText] = useState("");
  const [size, setSize] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => getCountFromServer(collection(db, "studentRoster")).then((s) => setSize(s.data().count)).catch(() => undefined);
  useEffect(() => { refresh(); }, []);

  async function run() {
    setBusy(true); setMsg("");
    const rows = text.split("\n").map((l) => l.trim()).filter(Boolean)
      .filter((l) => !/^studentid\s*,/i.test(l))
      .map((l) => { const [studentId, fullName, department, session] = l.split(",").map((x) => x.trim()); return { studentId, fullName, department, session }; });
    if (rows.length === 0) { setBusy(false); return setMsg("Paste at least one row."); }
    try {
      let n = 0;
      for (let i = 0; i < rows.length; i += 400) n += (await importRoster({ rows: rows.slice(i, i + 400) })).imported;
      setMsg(`Imported ${n} students.`); setText(""); refresh();
    } catch { setMsg("Some rows are invalid. Format: studentId, full name, department (Science/Commerce/Humanities), session (2025-26)."); }
    finally { setBusy(false); }
  }

  return (
    <>
      <p className="muted">Roster size: <strong>{size ?? "…"}</strong>. Students are verified by matching their details to this list, so keep it accurate.</p>
      <label>Paste rows (one per line)
        <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={"studentId, full name, department, session\n250101, Rahim Uddin, Science, 2025-26"} />
      </label>
      {msg && <p role="status" className={msg.startsWith("Imported") ? "" : "error"}>{msg}</p>}
      <button className="btn" disabled={busy} onClick={run}>{busy ? "Importing…" : "Import roster"}</button>
    </>
  );
}
