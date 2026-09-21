import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "../firebase/config";

interface Z { id: string; title: string; type: string; status: string; questionIds: string[]; durationMin: number }

export default function Quizzes() {
  const [items, setItems] = useState<Z[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    getDocs(query(collection(db, "quizzes"), orderBy("createdAt", "desc"), limit(50)))
      .then((s) => setItems(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Z, "id">) })))).catch(() => setError(true));
  }, []);
  return (
    <>
      <Link className="btn" to="/admin/quizzes/new">New quiz</Link>
      {error && <p className="error" role="alert">Couldn't load quizzes.</p>}
      {items === null && !error && <div className="post skeleton-card" style={{ marginTop: "1rem" }} />}
      {items?.length === 0 && <p className="muted" style={{ marginTop: "1rem" }}>No quizzes yet. Publish some questions first, then build a quiz.</p>}
      <div style={{ marginTop: "1rem" }}>
        {items?.map((z) => (
          <Link key={z.id} to={`/admin/quizzes/${z.id}`} className="tile material" style={{ marginBottom: ".6rem" }}>
            <span className="small">{z.type === "weekly" ? "Weekly model quiz" : "Topic quiz"} · {z.questionIds.length} questions · {z.durationMin} min</span>
            <strong>{z.title}</strong>
            <span className={`badge ${z.status === "published" ? "verified" : "pending"}`} style={{ justifySelf: "start" }}>{z.status}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
