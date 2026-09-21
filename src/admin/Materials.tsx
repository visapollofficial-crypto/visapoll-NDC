import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "../firebase/config";

interface M { id: string; subjectName: string; chapter: string; topic: string; classDate: string; status: string; departments: string[] }

export default function Materials() {
  const [items, setItems] = useState<M[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    getDocs(query(collection(db, "classMaterials"), orderBy("classDate", "desc"), limit(50)))
      .then((s) => setItems(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<M, "id">) })))).catch(() => setError(true));
  }, []);
  return (
    <>
      <Link className="btn" to="/admin/materials/new">New class material</Link>
      {error && <p className="error" role="alert">Couldn't load materials.</p>}
      {items === null && !error && <div className="post skeleton-card" style={{ marginTop: "1rem" }} />}
      {items?.length === 0 && <p className="muted" style={{ marginTop: "1rem" }}>No materials yet. Add subjects first, then create your first class entry.</p>}
      <div style={{ marginTop: "1rem" }}>
        {items?.map((m) => (
          <Link key={m.id} to={`/admin/materials/${m.id}`} className="tile material" style={{ marginBottom: ".7rem" }}>
            <span className="small">{m.subjectName} · {m.classDate} · {m.departments.join(", ")}</span>
            <strong>{m.chapter}{m.topic ? `: ${m.topic}` : ""}</strong>
            <span className={`badge ${m.status === "published" ? "verified" : "pending"}`} style={{ justifySelf: "start" }}>{m.status}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
