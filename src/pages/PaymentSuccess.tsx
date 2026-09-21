import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config";
import { Loader } from "../components/Loader";
import { methodName, type Payment } from "../services/payments";

/**
 * This page only DISPLAYS a payment the server has already verified.
 * Opening the address by hand, or with someone else's payment id, shows nothing and unlocks nothing.
 */
export default function PaymentSuccess() {
  const [params] = useSearchParams();
  const pid = params.get("pid");
  const nav = useNavigate();
  const [p, setP] = useState<Payment | null | undefined>(undefined);

  useEffect(() => {
    if (!pid) { setP(null); return; }
    return onSnapshot(doc(db, "payments", pid), (s) => setP(s.exists() ? ({ id: s.id, ...(s.data() as Omit<Payment, "id">) }) : null), () => setP(null));
  }, [pid]);

  useEffect(() => { if (p && (p.status === "failed" || p.status === "expired")) nav(`/payment/failure?pid=${p.id}`, { replace: true }); }, [p, nav]);

  if (p === undefined) return <Loader label="Checking your payment" />;
  if (!p || p.status === "initiated") {
    return (
      <div className="center-screen">
        <h1>We couldn't find a confirmed payment</h1>
        <p className="muted">A payment only counts after our server confirms it.</p>
        <Link className="btn" to="/subscription">Back to Subscription</Link>
      </div>
    );
  }
  if (p.status === "pending") {
    return (
      <div className="center-screen" role="status">
        <h1>Confirming your payment…</h1>
        <p className="muted">This page updates by itself as soon as it's confirmed.</p>
      </div>
    );
  }

  const fmt = (t?: { toMillis(): number }) => (t ? new Date(t.toMillis()).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "");
  return (
    <div className="result-page">
      <div className="result-icon ok" aria-hidden="true">✓</div>
      <h1>Payment successful</h1>
      <p className="muted">Your subscription is active. Thank you!</p>
      <dl className="receipt">
        <div><dt>Subscription</dt><dd>Premium monthly{p.months && p.months > 1 ? ` × ${p.months}` : ""}</dd></div>
        <div><dt>Amount</dt><dd>{p.paidAmount ?? p.amount} BDT</dd></div>
        <div><dt>Method</dt><dd>{methodName(p.method)}</dd></div>
        <div><dt>Transaction ID</dt><dd className="num">{p.trxId}</dd></div>
        <div><dt>Valid until</dt><dd>{fmt(p.subscriptionEnd)}</dd></div>
      </dl>
      <div className="notice" style={{ textAlign: "left" }}>
        <strong>Now unlocked:</strong> class materials, quizzes and practice, the feed, and the AI study guide. We'll remind you 3 days before it ends.
      </div>
      <Link className="btn" to="/dashboard">Go to dashboard</Link>
    </div>
  );
}
