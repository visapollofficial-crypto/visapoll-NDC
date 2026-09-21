import { useCallback, useEffect, useState, type FormEvent } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebase/config";
import { deleteSubject, saveSubject } from "../services/admin";

interface S { id: string; name: string; active: boolean }

export default function Subjects() {
  const [list, setList] = useState<S[] | null>(null);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const load = useCallback(() => getDocs(query(collection(db, "subjects"), orderBy("name"))).then((s) => setList(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<S, "id">) })))).catch(() => setMsg("Couldn't load subjects.")), []);
  useEffect(() => { load(); }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault(); setMsg("");
    try { await saveSubject({ name, active: true }); setName(""); await load(); } catch { setMsg("Enter a subject name (2 to 60 characters)."); }
  }
  async function toggle(s: S) { await saveSubject({ id: s.id, name: s.name, active: !s.active }).catch(() => setMsg("Couldn't update.")); load(); }
  async function remove(s: S) {
    if (!confirm(`Delete ${s.name}?`)) return;
    try { await deleteSubject({ id: s.id }); load(); } catch (e) { setMsg((e as Error).message.replace(/^.*?:\s*/, "")); }
  }

  return (
    <>
      <form className="filters" onSubmit={add}>
        <input aria-label="New subject" placeholder="New subject (e.g. Physics)" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <button className="btn">Add subject</button>
      </form>
      {msg && <p className="error" role="alert">{msg}</p>}
      {list?.length === 0 && <p className="muted">No subjects yet. Add your first one above.</p>}
      {list?.map((s) => (
        <div key={s.id} className="post" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", display: "flex" }}>
          <span><strong>{s.name}</strong> {!s.active && <span className="badge">Inactive</span>}</span>
          <span>
            <button className="linkbtn" onClick={() => toggle(s)}>{s.active ? "Deactivate" : "Activate"}</button>{" "}
            <button className="linkbtn" onClick={() => remove(s)}>Delete</button>
          </span>
        </div>
      ))}
    </>
  );
}
