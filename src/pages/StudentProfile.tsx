import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { Avatar } from "../components/Avatar";
import { Loader } from "../components/Loader";

interface Pub { displayName: string; department: string; session: string; photoURL: string | null; scoreVisibility: "private" | "public"; publicStats?: { quizzes: number; avg: number; best: number } }

/** What other students may see: name, department, session, photo and (only if the student chose) quiz numbers. */
export default function StudentProfile() {
  const { uid } = useParams();
  const [p, setP] = useState<Pub | null | undefined>(undefined);
  useEffect(() => { if (uid) getDoc(doc(db, "publicProfiles", uid)).then((s) => setP(s.exists() ? (s.data() as Pub) : null)).catch(() => setP(null)); }, [uid]);
  if (p === undefined) return <Loader />;
  if (p === null) return <><Link to="/chat">← Back</Link><p className="muted">This profile isn't available.</p></>;
  return (
    <>
      <Link to="/chat">← Back</Link>
      <section className="plan-card" style={{ marginTop: ".8rem" }}>
        <div className="profile-id"><Avatar name={p.displayName} url={p.photoURL} size={72} /><div><h2>{p.displayName}</h2><p>{p.department} · Session {p.session}</p></div></div>
        {uid && <Link className="btn" to="/chat" state={{ start: uid }}>Message</Link>}
      </section>
      {p.scoreVisibility === "public" && p.publicStats ? (
        <section className="grid">
          <div className="tile"><span>Quizzes taken</span><strong className="stat">{p.publicStats.quizzes}</strong></div>
          <div className="tile"><span>Average</span><strong className="stat">{p.publicStats.avg}%</strong></div>
          <div className="tile"><span>Highest</span><strong className="stat">{p.publicStats.best}%</strong></div>
        </section>
      ) : <p className="muted">This student keeps their quiz scores private.</p>}
    </>
  );
}
