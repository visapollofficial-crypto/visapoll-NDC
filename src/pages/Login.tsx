import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { auth } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { friendlyError } from "../services/api";

export default function Login() {
  const { user, profile, loading } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    nav(profile ? "/dashboard" : "/register", { replace: true });
  }, [user, profile, loading, nav]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError("");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  return (
    <div className="auth">
      <section className="auth-side" aria-hidden="true">
        <h1>Study what was taught. Test what you learned.</h1>
        <p>Class notes, weekly model quizzes and an AI study guide for NDC students.</p>
      </section>
      <form className="auth-form" onSubmit={submit} noValidate>
        <h2>Sign in</h2>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <button type="button" className="btn ghost" onClick={google}>
          Continue with Google
        </button>
        <p className="muted small">
          New here? <Link to="/register">Create your student account</Link>
        </p>
      </form>
    </div>
  );
}


