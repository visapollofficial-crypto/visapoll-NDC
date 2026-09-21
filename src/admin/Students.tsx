import { useCallback, useEffect, useState, type FormEvent } from "react";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, startAfter, where, type DocumentData, type QueryDocumentSnapshot } from "firebase/firestore";
import { db } from "../firebase/config";
import { adminSetSuspension, adminTrialAction } from "../services/admin";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/config";
import { friendlyError } from "../services/api";

interface Row { id: string; fullName: string; studentId: string; department: string; session: string; verificationStatus: string; suspended?: boolean; chatRestricted?: boolean }
type Sub = { status: string; endsAt?: { toMillis(): number } | null; trialStatus?: string } | null;

function StudentRow({ row, onChange }: { row: Row; onChange: () => void }) {
  const [sub, setSub] = useState<Sub | undefined>(undefined);
  const [days, setDays] = useState(7);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const loadSub = useCallback(() => getDoc(doc(db, "subscriptions", row.id)).then((s) => setSub(s.exists() ? (s.data() as Sub) : null)).catch(() => setSub(null)), [row.id]);
  useEffect(() => { loadSub(); }, [loadSub]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true); setMsg("");
    try { await fn(); setMsg(done); await loadSub(); onChange(); }
    catch (err) { setMsg((err as { message?: string }).message?.replace(/^.*?:\s*/, "") || friendlyError(err)); }
    finally { setBusy(false); }
  }
  const trial = (action: "grant" | "revoke" | "extend" | "block" | "unblock") => run(() => adminTrialAction({ uid: row.id, action, days: action === "extend" || action === "grant" ? days : undefined }), `Trial: ${action} done.`);
  const ends = sub?.endsAt ? new Date(sub.endsAt.toMillis()).toLocaleDateString() : "";

  return (
    <div className="post">
      <div className="page-head" style={{ margin: 0 }}>
        <div>
          <strong>{row.fullName}</strong> <span className="muted small">ID {row.studentId} · {row.department} · {row.session}</span>
          <div className="small">Plan: {sub === undefined ? "…" : sub?.status ?? "none"}{ends && ` (until ${ends})`}{sub?.trialStatus === "already_used" && " · trial already used"}</div>
        </div>
        <div>
          <span className={`badge ${row.verificationStatus}`}>{row.verificationStatus.replace("_", " ")}</span>{" "}
          {row.suspended && <span className="badge rejected">Suspended</span>}
        </div>
      </div>
      <details>
        <summary>Actions</summary>
        <div className="composer-bar" style={{ marginTop: ".6rem" }}>
          <label className="small">Days <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 80 }} /></label>
          <button className="btn ghost" disabled={busy} onClick={() => trial("grant")}>Grant trial</button>
          <button className="btn ghost" disabled={busy} onClick={() => trial("extend")}>Extend</button>
          <button className="btn ghost" disabled={busy} onClick={() => trial("revoke")}>Revoke trial</button>
          <button className="btn ghost" disabled={busy} onClick={() => trial("block")}>Block trial</button>
          <button className="btn ghost" disabled={busy} onClick={() => trial("unblock")}>Unblock</button>
          <button className="btn ghost" disabled={busy} onClick={() => run(() => httpsCallable(functions, "adminSetChatRestriction")({ uid: row.id, restricted: !row.chatRestricted }), row.chatRestricted ? "Chat restored." : "Chat restricted.")}>{row.chatRestricted ? "Restore chat" : "Restrict chat"}</button>
          <button className="btn ghost" disabled={busy} onClick={() => {
            const suspend = !row.suspended;
            const reason = suspend ? prompt("Reason for suspension (shown in the audit log):") ?? "" : "";
            if (suspend && !reason) return;
            run(() => adminSetSuspension({ uid: row.id, suspended: suspend, reason }), suspend ? "Student suspended." : "Student restored.");
          }}>{row.suspended ? "Unsuspend" : "Suspend"}</button>
        </div>
        {msg && <p className="small" role="status">{msg}</p>}
      </details>
    </div>
  );
}

export default function Students() {
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [done, setDone] = useState(false);
  const [term, setTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(from: typeof cursor, search = term) {
    setLoading(true); setError("");
    try {
      const q = search.trim()
        ? query(collection(db, "users"), where("studentId", "==", search.trim()), limit(10))
        : query(collection(db, "users"), orderBy("createdAt", "desc"), limit(25), ...(from ? [startAfter(from)] : []));
      const snap = await getDocs(q);
      const next = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Row, "id">) }));
      setRows((p) => (from ? [...p, ...next] : next));
      setCursor(snap.docs[snap.docs.length - 1] ?? from);
      setDone(!!search.trim() || snap.docs.length < 25);
    } catch { setError("Couldn't load students."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(null, ""); /* eslint-disable-next-line */ }, []);

  const search = (e: FormEvent) => { e.preventDefault(); load(null); };

  return (
    <>
      <form className="filters" onSubmit={search}>
        <input type="search" aria-label="Search by student ID" placeholder="Search by exact student ID" value={term} onChange={(e) => setTerm(e.target.value)} />
        <button className="btn">Search</button>
      </form>
      {rows.map((r) => <StudentRow key={r.id} row={r} onChange={() => undefined} />)}
      {loading && <div className="post skeleton-card" />}
      {error && <p className="error" role="alert">{error}</p>}
      {!loading && rows.length === 0 && !error && <p className="muted">No students found.</p>}
      {!done && !loading && <button className="btn ghost" onClick={() => load(cursor)}>Load more</button>}
    </>
  );
}
