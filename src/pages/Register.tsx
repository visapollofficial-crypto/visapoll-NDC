import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createUserWithEmailAndPassword, sendEmailVerification } from "firebase/auth";
import { auth } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { friendlyError, registerStudent } from "../services/api";

const CONSENT_VERSION = "2026-09";

export default function Register() {
  const { user, profile, loading, refreshClaims } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({
    fullName: "",
    studentId: "",
    department: "Science" as "Science" | "Commerce" | "Humanities",
    section: "",
    session: "",
    phone: "",
    email: "",
    password: "",
    privacy: false,
    terms: false,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  // Once the profile document exists, we're done.
  useEffect(() => {
    if (!loading && profile) nav("/dashboard", { replace: true });
  }, [profile, loading, nav]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!f.privacy || !f.terms) return setError("Please accept the Privacy Policy and Terms to continue.");
    if (!user && f.password.length < 8) return setError("Choose a password with at least 8 characters.");
    setBusy(true);
    try {
      let current = auth.currentUser;
      if (!current) {
        const cred = await createUserWithEmailAndPassword(auth, f.email.trim(), f.password);
        current = cred.user;
        sendEmailVerification(current).catch(() => undefined);
      }
      await registerStudent({
        fullName: f.fullName,
        studentId: f.studentId,
        department: f.department,
        section: f.section,
        session: f.session,
        phone: f.phone,
        consent: { privacy: true, terms: true, version: CONSENT_VERSION },
      });
      await refreshClaims();
      // Navigation happens in the effect above when the profile snapshot arrives.
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <section className="auth-side" aria-hidden="true">
        <h1>Create your student account</h1>
        <p>
          Your details are checked against the NDC student list. Your free month starts once you are verified, and
          each verified student gets one.
        </p>
      </section>
      <form className="auth-form" onSubmit={submit}>
        <h2>{user ? "Finish your profile" : "Register"}</h2>
        <label>
          Full name
          <input required autoComplete="name" value={f.fullName} onChange={(e) => set("fullName", e.target.value)} />
        </label>
        <label>
          Student ID
          <input required value={f.studentId} onChange={(e) => set("studentId", e.target.value)} />
        </label>
        <label>
          Department
          <select value={f.department} onChange={(e) => set("department", e.target.value as typeof f.department)}>
            <option>Science</option>
            <option>Commerce</option>
            <option>Humanities</option>
          </select>
        </label>
        <div className="row">
          <label>
            Class / section
            <input required value={f.section} onChange={(e) => set("section", e.target.value)} />
          </label>
          <label>
            Session
            <input required placeholder="2025-26" value={f.session} onChange={(e) => set("session", e.target.value)} />
          </label>
        </div>
        <label>
          Mobile number
          <input
            required
            type="tel"
            autoComplete="tel"
            placeholder="01XXXXXXXXX"
            value={f.phone}
            onChange={(e) => set("phone", e.target.value)}
          />
        </label>
        {!user && (
          <>
            <label>
              Email
              <input required type="email" autoComplete="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
            </label>
            <label>
              Password
              <input
                required
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={f.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </label>
          </>
        )}
        <label className="check">
          <input type="checkbox" checked={f.privacy} onChange={(e) => set("privacy", e.target.checked)} />
          <span>
            I have read the <Link to="/privacy" target="_blank">Privacy Policy</Link> and agree to how my student data is used.
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={f.terms} onChange={(e) => set("terms", e.target.checked)} />
          <span>
            I accept the <Link to="/terms" target="_blank">Terms</Link>.
          </span>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
        {!user && (
          <p className="muted small">
            Already registered? <Link to="/login">Sign in</Link>
          </p>
        )}
      </form>
    </div>
  );
}
