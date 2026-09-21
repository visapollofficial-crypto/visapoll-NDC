import { useCallback, useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../firebase/config";
import { getVerificationImageUrl, reviewVerification } from "../services/admin";
import { normalizeName, normalizeStudentId } from "../utils/text";

interface U { fullName: string; studentId: string; department: string; session: string; section: string; phone: string }
interface Roster { fullName: string; department: string; session: string }

function Item({ uid, onDone }: { uid: string; onDone: (uid: string) => void }) {
  const [u, setU] = useState<U | null>(null);
  const [roster, setRoster] = useState<Roster | null | undefined>(undefined);
  const [img, setImg] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getDoc(doc(db, "users", uid)).then(async (s) => {
      const d = s.data() as U | undefined;
      setU(d ?? null);
      if (d) {
        const r = await getDoc(doc(db, "studentRoster", normalizeStudentId(d.studentId)));
        setRoster(r.exists() ? (r.data() as Roster) : null);
      }
    });
  }, [uid]);

  async function show() {
    setBusy(true); setMsg("");
    try { setImg((await getVerificationImageUrl({ uid })).url); }
    catch { setMsg("Couldn't load the ID image."); }
    finally { setBusy(false); }
  }
  async function decide(decision: "approve" | "reject" | "reupload") {
    if (decision !== "approve" && !note.trim()) return setMsg("Add a short reason for the student.");
    setBusy(true); setMsg("");
    try { await reviewVerification({ uid, decision, note: note.trim() || undefined }); onDone(uid); }
    catch { setMsg("Couldn't save the decision. Try again."); setBusy(false); }
  }

  if (!u) return null;
  const ok = (b: boolean) => (b ? "match" : "differs");
  return (
    <div className="post">
      <strong>{u.fullName}</strong>
      <div className="small">ID {u.studentId} · {u.department} · {u.session} · {u.section} · {u.phone}</div>
      <div className="small">
        {roster === undefined ? "Checking roster…" : roster === null
          ? "Not found in the roster."
          : <>Roster: name {ok(normalizeName(roster.fullName) === normalizeName(u.fullName))} ({roster.fullName}), department {ok(roster.department === u.department)}, session {ok(roster.session === u.session)}</>}
      </div>
      {img ? <img src={img} alt={`ID card of ${u.fullName}`} style={{ maxWidth: "100%", maxHeight: 420, borderRadius: 8 }} /> : <button className="btn ghost" disabled={busy} onClick={show}>Show ID image (logged)</button>}
      <input aria-label="Reason (required for reject or re-upload)" placeholder="Reason shown to the student (required for reject / re-upload)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      <div className="composer-bar">
        <button className="btn" disabled={busy} onClick={() => decide("approve")}>Approve</button>
        <button className="btn ghost" disabled={busy} onClick={() => decide("reupload")}>Ask to re-upload</button>
        <button className="btn ghost" disabled={busy} onClick={() => decide("reject")}>Reject</button>
      </div>
      {msg && <p className="error" role="alert">{msg}</p>}
    </div>
  );
}

export default function Verification() {
  const [ids, setIds] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    getDocs(query(collection(db, "verificationRequests"), where("status", "==", "pending"), limit(50)))
      .then((s) => setIds(s.docs.map((d) => d.id))).catch(() => setError("Couldn't load the queue."));
  }, []);
  useEffect(load, [load]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (ids === null) return <div className="post skeleton-card" />;
  return (
    <>
      <p className="muted small">ID images are visible to admins only, each view is logged, and the image is deleted when you decide. Approving also decides the free trial automatically (one per verified student).</p>
      {ids.length === 0 && <p className="muted">No pending verification requests.</p>}
      {ids.map((id) => <Item key={id} uid={id} onDone={(x) => setIds((p) => p?.filter((i) => i !== x) ?? p)} />)}
    </>
  );
}
