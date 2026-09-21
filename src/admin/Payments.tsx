import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase/config";
import { adminReviewPayment, methodName, type Payment } from "../services/payments";

interface Incoming { id: string; method: string; trxId: string; amount: number; sender: string | null; receivedAt: { toMillis(): number }; used: boolean }
interface Unparsed { id: string; from: string; raw: string; at: { toMillis(): number } }
const when = (t: { toMillis(): number }) => new Date(t.toMillis()).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export default function Payments() {
  const [pending, setPending] = useState<Payment[] | null>(null);
  const [recent, setRecent] = useState<Payment[]>([]);
  const [incoming, setIncoming] = useState<Incoming[]>([]);
  const [unparsed, setUnparsed] = useState<Unparsed[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      const [p, v, i, u] = await Promise.all([
        getDocs(query(collection(db, "payments"), where("status", "==", "pending"), orderBy("createdAt", "desc"), limit(50))),
        getDocs(query(collection(db, "payments"), where("status", "==", "verified"), orderBy("createdAt", "desc"), limit(200))),
        getDocs(query(collection(db, "incomingPayments"), where("used", "==", false), orderBy("receivedAt", "desc"), limit(30))),
        getDocs(query(collection(db, "unparsedSms"), orderBy("at", "desc"), limit(20))),
      ]);
      const m = <T,>(s: typeof p) => s.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T);
      setPending(m<Payment>(p)); setRecent(m<Payment>(v)); setIncoming(m<Incoming>(i)); setUnparsed(m<Unparsed>(u));
    } catch { setError("Couldn't load payments."); }
  }
  useEffect(() => { load(); }, []);

  const month = useMemo(() => {
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const rows = recent.filter((r) => (r.verifiedAt ?? r.createdAt).toMillis() >= start.getTime());
    return { count: rows.length, total: rows.reduce((a, r) => a + (r.paidAmount ?? r.amount), 0) };
  }, [recent]);

  async function decide(id: string, d: "approve" | "reject") {
    if (d === "approve" && !confirm("Approve only if you saw this exact transaction in your bKash/Nagad app. Continue?")) return;
    setBusy(id); setError("");
    try { await adminReviewPayment(id, d); await load(); } catch { setError("Couldn't save that decision."); }
    finally { setBusy(""); }
  }

  return (
    <>
      <section className="grid" style={{ marginBottom: "1rem" }}>
        <div className="tile"><span>Verified this month</span><strong className="stat">{month.count}</strong></div>
        <div className="tile"><span>Revenue this month</span><strong className="stat">{month.total} BDT</strong></div>
        <div className="tile"><span>Waiting for review</span><strong className="stat">{pending?.length ?? "…"}</strong></div>
      </section>
      {error && <p className="error" role="alert">{error}</p>}

      <h2>Waiting for confirmation</h2>
      <p className="muted small">Most payments confirm by themselves when the SMS reaches the server. Anything here is waiting for its SMS, or couldn't be checked automatically. Approve only what you can see in your own bKash/Nagad app.</p>
      {pending?.length === 0 && <p className="muted">Nothing waiting.</p>}
      {pending?.map((p) => (
        <div key={p.id} className="post">
          <strong>{p.amount} BDT · {methodName(p.method)}</strong>
          <div className="small">Trx <span className="num">{p.trxId}</span> · from <span className="num">{p.senderNumber}</span> · {when(p.createdAt)} · student {p.uid}</div>
          <div className="composer-bar">
            <button className="btn" disabled={busy === p.id} onClick={() => decide(p.id, "approve")}>Approve</button>
            <button className="btn ghost" disabled={busy === p.id} onClick={() => decide(p.id, "reject")}>Reject</button>
          </div>
        </div>
      ))}

      <h2 style={{ marginTop: "1.5rem" }}>Received but not matched yet</h2>
      <p className="muted small">Payments the server heard about by SMS that no student has claimed. Use these to match a student who is waiting.</p>
      {incoming.length === 0 && <p className="muted">None.</p>}
      <div className="table-wrap"><table><tbody>
        {incoming.map((i) => <tr key={i.id}><td>{when(i.receivedAt)}</td><td>{methodName(i.method as "bkash" | "nagad")}</td><td className="num">{i.trxId}</td><td>{i.amount} BDT</td><td className="num">{i.sender ?? "unknown"}</td></tr>)}
      </tbody></table></div>

      {unparsed.length > 0 && (
        <>
          <h2 style={{ marginTop: "1.5rem" }}>Messages we couldn't read</h2>
          <p className="muted small">If real payments show up here, the SMS wording changed. Tell the developer so the reader can be updated.</p>
          {unparsed.map((u) => <div key={u.id} className="post small"><span className="muted">{when(u.at)} · {u.from}</span><span>{u.raw}</span></div>)}
        </>
      )}

      <h2 style={{ marginTop: "1.5rem" }}>Recent verified payments</h2>
      <div className="table-wrap"><table><thead><tr><th>When</th><th>Method</th><th>Trx</th><th>Amount</th><th>By</th></tr></thead><tbody>
        {recent.slice(0, 30).map((r) => <tr key={r.id}><td>{when(r.verifiedAt ?? r.createdAt)}</td><td>{methodName(r.method)}</td><td className="num">{r.trxId}</td><td>{r.paidAmount ?? r.amount}</td><td className="small">{(r as unknown as { verifiedBy?: string }).verifiedBy === "auto" ? "auto" : "admin"}</td></tr>)}
      </tbody></table></div>
    </>
  );
}
