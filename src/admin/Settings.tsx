import { useEffect, useState, type FormEvent } from "react";
import { adminGetSettings, adminSaveSettings, type SystemSettings } from "../services/admin";
import { Loader } from "../components/Loader";

export default function Settings() {
  const [s, setS] = useState<SystemSettings | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { adminGetSettings().then(setS).catch(() => setError("Couldn't load settings.")); }, []);
  if (error && !s) return <p className="error" role="alert">{error}</p>;
  if (!s) return <Loader />;
  const set = <K extends keyof SystemSettings>(k: K, v: SystemSettings[K]) => setS({ ...s, [k]: v });

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(""); setError("");
    try { await adminSaveSettings(s!); setMsg("Settings saved."); } catch { setError("Check the values and try again."); }
    finally { setBusy(false); }
  }
  const check = (k: "freeTrialEnabled" | "oneTrialPerVerifiedStudent" | "requireStudentVerification" | "requireFaceVerification", label: string) => (
    <label className="check"><input type="checkbox" checked={s[k]} onChange={(e) => set(k, e.target.checked)} /><span>{label}</span></label>
  );

  return (
    <form className="auth-form" style={{ margin: 0, padding: 0, maxWidth: 520 }} onSubmit={save}>
      <label>Subscription price (BDT / month)<input type="number" min={0} value={s.subscriptionPriceBDT} onChange={(e) => set("subscriptionPriceBDT", Number(e.target.value))} /></label>
      <label>Free trial length (days)<input type="number" min={0} max={365} value={s.freeTrialDurationDays} onChange={(e) => set("freeTrialDurationDays", Number(e.target.value))} /></label>
      {check("freeTrialEnabled", "Free trial enabled")}
      {check("oneTrialPerVerifiedStudent", "One free trial per verified student")}
      {check("requireStudentVerification", "Require student verification")}
      {check("requireFaceVerification", "Require face verification (only if NDC mandates it; needs a verification provider)")}
      <h2>Payments</h2>
      <label className="check"><input type="checkbox" checked={s.paymentsEnabled} onChange={(e) => set("paymentsEnabled", e.target.checked)} /><span>Accept payments</span></label>
      <label>bKash number students send money to<input inputMode="tel" placeholder="01XXXXXXXXX" value={s.bkashNumber} onChange={(e) => set("bkashNumber", e.target.value.trim())} /></label>
      <label>Nagad number students send money to<input inputMode="tel" placeholder="01XXXXXXXXX" value={s.nagadNumber} onChange={(e) => set("nagadNumber", e.target.value.trim())} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      {msg && <p role="status">{msg}</p>}
      <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
    </form>
  );
}
