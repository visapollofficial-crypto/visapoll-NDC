import { useCallback, useEffect, useState, type FormEvent } from "react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase/config";
import { friendlyError } from "../services/api";

interface G { id: string; name: string; department: string; sectionLabel: string | null }

export default function ChatGroups() {
  const [groups, setGroups] = useState<G[] | null>(null);
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("All");
  const [section, setSection] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => {
    getDocs(query(collection(db, "chats"), where("type", "==", "group"), limit(100)))
      .then((s) => setGroups(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<G, "id">) })))).catch(() => setError("Couldn't load groups."));
  }, []);
  useEffect(load, [load]);

  async function create(e: FormEvent) {
    e.preventDefault(); setError("");
    try { await httpsCallable(functions, "adminCreateGroupChat")({ name, department, section: section || undefined }); setName(""); setSection(""); load(); }
    catch (err) { setError(friendlyError(err)); }
  }
  async function remove(g: G) {
    if (!confirm(`Delete "${g.name}" and all its messages?`)) return;
    try { await httpsCallable(functions, "adminDeleteChat")({ chatId: g.id }); load(); } catch (err) { setError(friendlyError(err)); }
  }

  return (
    <>
      <p className="muted small">Class groups appear automatically for the students they're meant for. Students can also message each other one-to-one.</p>
      <form className="auth-form" style={{ margin: 0, padding: 0, maxWidth: 520 }} onSubmit={create}>
        <label>Group name<input required value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Science, Class 11" /></label>
        <div className="row">
          <label>Who can join<select value={department} onChange={(e) => setDepartment(e.target.value)}><option value="All">All departments</option><option>Science</option><option>Commerce</option><option>Humanities</option></select></label>
          <label>Class / section (optional)<input value={section} onChange={(e) => setSection(e.target.value)} maxLength={20} /></label>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn">Create group</button>
      </form>
      <h2 style={{ marginTop: "1.5rem" }}>Groups</h2>
      {groups?.length === 0 && <p className="muted">No groups yet.</p>}
      {groups?.map((g) => (
        <div key={g.id} className="post" style={{ flexDirection: "row", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span><strong>{g.name}</strong> <span className="muted small">· {g.department}{g.sectionLabel && ` · ${g.sectionLabel}`}</span></span>
          <button className="linkbtn" onClick={() => remove(g)}>Delete</button>
        </div>
      ))}
    </>
  );
}
