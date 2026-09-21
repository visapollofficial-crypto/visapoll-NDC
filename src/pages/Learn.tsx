import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, limit, orderBy, query, startAfter, where, type DocumentData, type QueryDocumentSnapshot } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";

interface Item { id: string; subjectName: string; chapter: string; topic: string; classDate: string; summary: string; homework: string }
const PAGE = 20;

export default function Learn() {
  const { profile } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [subject, setSubject] = useState("");
  const [q, setQ] = useState("");

  async function load(from: typeof cursor) {
    if (!profile) return;
    setLoading(true); setError("");
    try {
      const base = [where("status", "==", "published"), where("departments", "array-contains", profile.department), orderBy("classDate", "desc"), limit(PAGE)];
      const snap = await getDocs(query(collection(db, "classMaterials"), ...(from ? [...base, startAfter(from)] : base)));
      const next = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Item, "id">) }));
      setItems((p) => (from ? [...p, ...next] : next));
      setCursor(snap.docs[snap.docs.length - 1] ?? from);
      setDone(snap.docs.length < PAGE);
    } catch { setError("Couldn't load class materials. Check your connection and try again."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(null); /* eslint-disable-next-line */ }, [profile?.department]);

  const subjects = useMemo(() => [...new Set(items.map((i) => i.subjectName))].sort(), [items]);
  const shown = items.filter((i) =>
    (!subject || i.subjectName === subject) &&
    (!q.trim() || `${i.subjectName} ${i.chapter} ${i.topic} ${i.summary}`.toLowerCase().includes(q.trim().toLowerCase())));

  return (
    <>
      <header className="page-head"><h1>Learn</h1></header>
      <div className="filters">
        <input type="search" aria-label="Search materials" placeholder="Search subject, chapter or topic" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Filter by subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="">All subjects</option>
          {subjects.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {shown.map((m) => (
        <Link key={m.id} to={`/learn/${m.id}`} className="tile material">
          <span className="small">{m.subjectName} · {new Date(m.classDate).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</span>
          <strong>{m.chapter}{m.topic ? `: ${m.topic}` : ""}</strong>
          {m.summary && <span>{m.summary.length > 140 ? m.summary.slice(0, 140) + "…" : m.summary}</span>}
          {m.homework && <span className="badge pending">Homework</span>}
        </Link>
      ))}
      {loading && <div className="post skeleton-card" />}
      {error && <p className="error" role="alert">{error} <button className="linkbtn" onClick={() => load(cursor)}>Retry</button></p>}
      {!loading && !error && items.length === 0 && <p className="muted">No class materials have been published for your department yet.</p>}
      {!loading && !error && items.length > 0 && shown.length === 0 && <p className="muted">Nothing matches your search.</p>}
      {!done && !loading && !error && <button className="btn ghost" onClick={() => load(cursor)}>Load more</button>}
    </>
  );
}
