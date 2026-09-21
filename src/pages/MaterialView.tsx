import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import type { MaterialInput } from "../services/admin";
import { Loader } from "../components/Loader";

export default function MaterialView() {
  const { id } = useParams();
  const [m, setM] = useState<MaterialInput | null | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    getDoc(doc(db, "classMaterials", id)).then((s) => setM(s.exists() ? (s.data() as MaterialInput) : null)).catch(() => setM(null));
  }, [id]);

  if (m === undefined) return <Loader />;
  if (m === null) return <><Link to="/learn">← Back</Link><p className="muted">This material isn't available.</p></>;

  const list = (title: string, xs: string[]) => xs.length > 0 && (<section><h2>{title}</h2><ul>{xs.map((x, i) => <li key={i} className="pre">{x}</li>)}</ul></section>);

  return (
    <article className="material-view">
      <Link to="/learn">← Back to Learn</Link>
      <header className="page-head" style={{ marginTop: ".8rem" }}>
        <div>
          <span className="muted small">{m.subjectName} · {new Date(m.classDate).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}{m.teacher && ` · ${m.teacher}`}</span>
          <h1>{m.chapter}{m.topic ? `: ${m.topic}` : ""}</h1>
        </div>
      </header>
      {m.summary && <section><h2>What was taught</h2><p className="pre">{m.summary}</p></section>}
      {list("Important points", m.keyPoints)}
      {list("Formulas", m.formulas)}
      {m.definitions.length > 0 && <section><h2>Definitions</h2><dl>{m.definitions.map((d, i) => <div key={i}><dt><strong>{d.term}</strong></dt><dd>{d.meaning}</dd></div>)}</dl></section>}
      {list("Examples", m.examples)}
      {m.homework && <section className="notice"><h2>Homework</h2><p className="pre">{m.homework}</p></section>}
      {m.attachments.length > 0 && (
        <section><h2>Files</h2>
          {m.attachments.map((a) => a.type === "image"
            ? <img key={a.path} src={a.url} alt={a.name} loading="lazy" style={{ maxWidth: "100%", borderRadius: 10, marginBottom: 8 }} />
            : a.type === "video"
              ? <video key={a.path} src={a.url} controls preload="metadata" style={{ maxWidth: "100%", borderRadius: 10 }} />
              : <p key={a.path}><a href={a.url} target="_blank" rel="noopener noreferrer">{a.name}</a> (PDF)</p>)}
        </section>
      )}
      {m.links.length > 0 && <section><h2>Reference links</h2>{m.links.map((l, i) => <p key={i}><a href={l.url} target="_blank" rel="noopener noreferrer nofollow">{l.title}</a></p>)}</section>}
    </article>
  );
}
