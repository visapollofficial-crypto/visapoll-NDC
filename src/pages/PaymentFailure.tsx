import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config";
import { Loader } from "../components/Loader";
import { FAILURE_TEXT, methodName, type Payment } from "../services/payments";

export default function PaymentFailure() {
  const [params] = useSearchParams();
  const pid = params.get("pid");
  const nav = useNavigate();
  const [p, setP] = useState<Payment | null | undefined>(undefined);

  useEffect(() => {
    if (!pid) { setP(null); return; }
    return onSnapshot(doc(db, "payments", pid), (s) => setP(s.exists() ? ({ id: s.id, ...(s.data() as Omit<Payment, "id">) }) : null), () => setP(null));
  }, [pid]);
  useEffect(() => { if (p?.status === "verified") nav(`/payment/success?pid=${p.id}`, { replace: true }); }, [p, nav]);

  if (p === undefined) return <Loader />;
  const reason = FAILURE_TEXT[p?.failureReason ?? ""] ?? { title: "The payment didn't go through", help: "Something went wrong while confirming it. Please try again. If money left your account, contact the admin." };

  return (
    <div className="result-page">
      <div className="result-icon bad" aria-hidden="true">✕</div>
      <h1>Payment failed</h1>
      <h2 style={{ fontFamily: "var(--body)" }}>{reason.title}</h2>
      <p className="muted">{reason.help}</p>
      {p && (
        <dl className="receipt">
          <div><dt>Method</dt><dd>{methodName(p.method)}</dd></div>
          <div><dt>Amount</dt><dd>{p.amount} BDT</dd></div>
          {p.trxId && <div><dt>Transaction ID</dt><dd className="num">{p.trxId}</dd></div>}
          <div><dt>Reference</dt><dd className="num">{p.id}</dd></div>
        </dl>
      )}
      <p className="muted small">Your access hasn't changed. If you were charged, quote the reference above to the admin.</p>
      <div className="composer-bar" style={{ justifyContent: "center" }}>
        <Link className="btn" to="/subscription">Try again</Link>
        <Link className="btn ghost" to="/dashboard">Back to dashboard</Link>
      </div>
    </div>
  );
}
