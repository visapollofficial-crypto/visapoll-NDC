import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, doc, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { getPublicSettings, friendlyError } from "../services/api";
import { cancelPayment, createPaymentRequest, methodName, submitPaymentProof, type Method, type Payment, type PaymentRequest } from "../services/payments";

const STATUS_BADGE: Record<string, string> = { verified: "verified", pending: "pending", initiated: "pending", failed: "rejected", expired: "rejected" };

export default function Subscription() {
  const { user, subscription, hasPremiumAccess } = useAuth();
  const nav = useNavigate();
  const [price, setPrice] = useState<number | null>(null);
  const [methods, setMethods] = useState<Record<Method, boolean>>({ bkash: false, nagad: false });
  const [req, setReq] = useState<PaymentRequest | null>(null);
  const [trx, setTrx] = useState("");
  const [sender, setSender] = useState("");
  const [watching, setWatching] = useState<string | null>(null);
  const [history, setHistory] = useState<Payment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getPublicSettings().then((s) => { setPrice(s.subscriptionPriceBDT); setMethods(s.methods); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(query(collection(db, "payments"), where("uid", "==", user.uid), orderBy("createdAt", "desc"), limit(10)),
      (s) => setHistory(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Payment, "id">) }))), () => undefined);
  }, [user]);

  // Resume an unfinished payment.
  useEffect(() => {
    const p = history.find((h) => h.status === "pending");
    if (p && !watching) setWatching(p.id);
  }, [history, watching]);

  // The screen only REACTS to what the server records.
  useEffect(() => {
    if (!watching) return;
    return onSnapshot(doc(db, "payments", watching), (s) => {
      const st = s.get("status");
      if (st === "verified") nav(`/payment/success?pid=${watching}`, { replace: true });
      else if (st === "failed" || st === "expired") nav(`/payment/failure?pid=${watching}`, { replace: true });
    });
  }, [watching, nav]);

  async function choose(m: Method) {
    setBusy(true); setError("");
    try { setReq(await createPaymentRequest(m)); } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!req) return;
    setBusy(true); setError("");
    try {
      const r = await submitPaymentProof(req.paymentId, trx, sender);
      setWatching(req.paymentId); setReq(null);
      if (r.status === "failed") nav(`/payment/failure?pid=${req.paymentId}`, { replace: true });
    } catch (err) { setError(friendlyError(err)); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (req) await cancelPayment(req.paymentId).catch(() => undefined);
    setReq(null); setTrx(""); setError("");
  }

  const daysLeft = subscription?.endsAt ? Math.max(0, Math.ceil((subscription.endsAt.toMillis() - Date.now()) / 86_400_000)) : 0;
  const anyMethod = methods.bkash || methods.nagad;

  return (
    <>
      <header className="page-head"><h1>Subscription</h1></header>
      {subscription?.trialStatus === "already_used" && !hasPremiumAccess && <p className="notice">Your free trial has already been used.</p>}
      {hasPremiumAccess && <p className="notice">Your plan is active. {daysLeft} day{daysLeft === 1 ? "" : "s"} left. Paying now adds a month on top of the time you have.</p>}

      {watching ? (
        <section className="plan-card" role="status" style={{ display: "block" }}>
          <h2>We're confirming your payment</h2>
          <p>This usually takes a minute or two. You can leave this page. We'll notify you as soon as it's confirmed.</p>
        </section>
      ) : req ? (
        <form className="plan-card auth-form" style={{ display: "grid", maxWidth: "none" }} onSubmit={submit}>
          <h2>Pay with {methodName(req.method)}</h2>
          <ol className="steps">
            <li>Open your {methodName(req.method)} app and choose <strong>Send Money</strong>.</li>
            <li>Send <strong>{req.amount} BDT</strong> to <strong className="num">{req.sendTo}</strong>.</li>
            <li>Come back here and enter the <strong>transaction ID</strong> (from the confirmation SMS) and the number you paid <strong>from</strong>.</li>
          </ol>
          <label>Transaction ID<input required value={trx} onChange={(e) => setTrx(e.target.value)} maxLength={20} autoCapitalize="characters" /></label>
          <label>Number you paid from<input required type="tel" placeholder="01XXXXXXXXX" value={sender} onChange={(e) => setSender(e.target.value)} /></label>
          <p className="muted small">This request stays open for 30 minutes. Each transaction ID can be used only once.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="composer-bar">
            <button className="btn" disabled={busy}>{busy ? "Checking…" : "Submit payment"}</button>
            <button type="button" className="btn ghost" onClick={cancel}>Cancel</button>
          </div>
        </form>
      ) : (
        <section className="plan-card" style={{ display: "block" }}>
          <h2>Premium monthly</h2>
          <p>{price === null ? "Loading price…" : `${price} BDT / month`}. Unlocks class materials, quizzes, the feed and the AI study guide.</p>
          {!anyMethod && <p className="muted">Payments aren't open yet. Please check back soon.</p>}
          <div className="composer-bar" style={{ marginTop: ".8rem" }}>
            <button className="btn bkash" disabled={busy || !methods.bkash} onClick={() => choose("bkash")}>Pay with bKash</button>
            <button className="btn nagad" disabled={busy || !methods.nagad} onClick={() => choose("nagad")}>Pay with Nagad</button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </section>
      )}

      {history.length > 0 && (
        <section style={{ marginTop: "1.25rem" }}>
          <h2>Payment history</h2>
          {history.map((p) => (
            <Link key={p.id} className="tile material" style={{ marginBottom: ".6rem" }} to={p.status === "verified" ? `/payment/success?pid=${p.id}` : `/payment/failure?pid=${p.id}`}>
              <span className="small">{methodName(p.method)} · {new Date(p.createdAt.toMillis()).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
              <strong>{p.amount} BDT</strong>
              <span className={`badge ${STATUS_BADGE[p.status]}`} style={{ justifySelf: "start" }}>{p.status}</span>
            </Link>
          ))}
        </section>
      )}
    </>
  );
}
