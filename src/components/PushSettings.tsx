import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { disablePush, enablePush, pushState, type PushState } from "../firebase/messaging";

const PREFS = [["quiz", "Quizzes and results"], ["material", "New class material"], ["announcements", "Announcements"], ["social", "Comments and chat messages"]] as const;
type Prefs = Record<(typeof PREFS)[number][0], boolean>;
const DEFAULT: Prefs = { quiz: true, material: true, announcements: true, social: true };

export function PushSettings() {
  const { user } = useAuth();
  const [state, setState] = useState<PushState>("off");
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    pushState().then(setState);
    if (user) getDoc(doc(db, "notificationPrefs", user.uid)).then((s) => s.exists() && setPrefs({ ...DEFAULT, ...(s.data() as Prefs) })).catch(() => undefined);
  }, [user]);

  async function toggle() {
    setBusy(true); setMsg("");
    try {
      if (state === "on") { await disablePush(); setState("off"); }
      else setState(await enablePush());
    } catch { setMsg("Couldn't turn on notifications on this device. Try again."); }
    finally { setBusy(false); }
  }
  async function setPref(k: keyof Prefs, v: boolean) {
    if (!user) return;
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    try { await setDoc(doc(db, "notificationPrefs", user.uid), next); } catch { setPrefs(prefs); setMsg("Couldn't save that setting."); }
  }

  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h2>Notifications</h2>
      {state === "unsupported" && <p className="muted">This browser can't receive push notifications. On iPhone, add the site to your Home Screen first. You will still see everything in the notification bell.</p>}
      {state === "blocked" && <p className="notice">Notifications are blocked in your browser settings for this site. Allow them there, then come back.</p>}
      {(state === "on" || state === "off") && (
        <button className="btn ghost" disabled={busy} onClick={toggle}>{busy ? "Please wait…" : state === "on" ? "Turn off push on this device" : "Turn on push on this device"}</button>
      )}
      <fieldset className="fieldset" style={{ marginTop: ".8rem", maxWidth: 520 }}>
        <legend>What should we tell you about?</legend>
        {PREFS.map(([k, label]) => <label key={k} className="check"><input type="checkbox" checked={prefs[k]} onChange={(e) => setPref(k, e.target.checked)} /><span>{label}</span></label>)}
        <p className="muted small" style={{ margin: 0 }}>Payment, subscription and verification messages are always sent.</p>
      </fieldset>
      {msg && <p className="error" role="alert">{msg}</p>}
    </section>
  );
}
