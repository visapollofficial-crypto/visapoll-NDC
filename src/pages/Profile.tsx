import { useState, type FormEvent } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { Avatar } from "../components/Avatar";
import { uploadAvatar } from "../services/upload";
import { friendlyError } from "../services/api";
import { VerifyPrompt } from "../components/VerifyPrompt";
import { PushSettings } from "../components/PushSettings";
import { useQuizStats } from "../hooks/useQuizStats";
import { Link } from "react-router-dom";

export default function Profile() {
  const { user, profile, subscription, hasPremiumAccess } = useAuth();
  const { stats } = useQuizStats();
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [section, setSection] = useState(profile?.section ?? "");
  const [visibility, setVisibility] = useState<"private" | "public">(profile?.scoreVisibility ?? "private");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!user || !profile) return null;

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(""); setError("");
    try {
      await updateDoc(doc(db, "users", user!.uid), { phone: phone.trim(), section: section.trim(), scoreVisibility: visibility });
      setMsg("Profile saved.");
    } catch (err) { setError(friendlyError(err) === "Something went wrong. Please try again." ? "Check your mobile number (01XXXXXXXXX) and section." : friendlyError(err)); }
    finally { setBusy(false); }
  }

  async function photo(file: File | undefined) {
    if (!file) return;
    setBusy(true); setMsg(""); setError("");
    try {
      const url = await uploadAvatar(user!.uid, file);
      await updateDoc(doc(db, "users", user!.uid), { photoURL: url });
      setMsg("Photo updated.");
    } catch (err) { setError(err instanceof Error && !("code" in err) ? err.message : "Couldn't upload your photo. Try a smaller image."); }
    finally { setBusy(false); }
  }

  const plan = hasPremiumAccess ? (subscription?.status === "trial" ? "Free trial active" : "Subscribed")
    : subscription?.status === "expired" ? "Expired" : "No active plan";

  return (
    <>
      <header className="page-head"><h1>Profile</h1></header>
      <VerifyPrompt />
      <section className="plan-card">
        <div className="profile-id">
          <Avatar name={profile.fullName} url={profile.photoURL} size={72} />
          <div>
            <h2>{profile.fullName}</h2>
            <p>{profile.department} · Session {profile.session} · ID {profile.studentId}</p>
            <p>Verification: {profile.verificationStatus.replace("_", " ")} · Plan: {plan}</p>
          </div>
        </div>
        <label className="btn ghost filebtn">
          Change photo
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { photo(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      </section>

      <form className="auth-form" style={{ margin: 0, padding: 0, maxWidth: 520 }} onSubmit={save}>
        <label>Mobile number<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></label>
        <label>Class / section<input value={section} onChange={(e) => setSection(e.target.value)} maxLength={20} /></label>
        <fieldset className="fieldset">
          <legend>Who can see your quiz scores?</legend>
          <label className="check"><input type="radio" name="vis" checked={visibility === "private"} onChange={() => setVisibility("private")} /><span>Only me</span></label>
          <label className="check"><input type="radio" name="vis" checked={visibility === "public"} onChange={() => setVisibility("public")} /><span>Other students can see my name and scores. Email, phone and ID stay private.</span></label>
        </fieldset>
        {error && <p className="error" role="alert">{error}</p>}
        {msg && <p role="status" style={{ color: "var(--green)", margin: 0 }}>{msg}</p>}
        <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
      </form>

      <PushSettings />

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Quiz statistics</h2>
        {stats ? (
          <div className="grid">
            <div className="tile"><span>Quizzes</span><strong className="stat">{stats.total}</strong></div>
            <div className="tile"><span>Average</span><strong className="stat">{stats.avg}%</strong></div>
            <div className="tile"><span>Highest</span><strong className="stat">{stats.best}%</strong></div>
            <div className="tile"><span>Day streak</span><strong className="stat">{stats.streak}</strong></div>
          </div>
        ) : <p className="muted">No quizzes taken yet. Your scores, streak and weak topics appear here after your first quiz.</p>}
        <p><Link to="/results">See all results</Link></p>
      </section>
    </>
  );
}
