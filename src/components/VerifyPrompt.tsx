import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { uploadVerificationId } from "../services/upload";
import { submitVerification } from "../services/admin";
import { friendlyError } from "../services/api";

/** Shown while the student isn't verified yet. Upload is optional, consent-gated, and private. */
export function VerifyPrompt() {
  const { user, profile } = useAuth();
  const [pending, setPending] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, "verificationRequests", user.uid), (s) => setPending(s.exists() && s.data()?.status === "pending"), () => setPending(false));
  }, [user]);

  if (!user || !profile || profile.verificationStatus === "verified") return null;

  async function upload(file: File | undefined) {
    if (!file || !user) return;
    if (!consent) return setError("Please tick the consent box first.");
    setBusy(true); setError(""); setMsg("");
    try {
      const path = await uploadVerificationId(user.uid, file);
      await submitVerification({ path, idConsent: true });
      setMsg("Submitted. An admin will review it soon.");
    } catch (err) {
      setError(err instanceof Error && !("code" in err) ? err.message : friendlyError(err));
    } finally { setBusy(false); }
  }

  return (
    <section className="notice" style={{ marginBottom: "1.25rem" }}>
      <h2>Verify your student ID</h2>
      {profile.verificationNote && <p><strong>Note from admin:</strong> {profile.verificationNote}</p>}
      {pending ? (
        <p>Your ID is waiting for review. You'll see the result here.</p>
      ) : (
        <>
          <p>Your details didn't match the NDC student list automatically. You can upload a photo of your NDC ID card for an admin to check.</p>
          <label className="check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I agree to upload my ID card for verification only. It stays private, is seen only by admins, and is deleted after the review.</span>
          </label>
          <label className="btn filebtn" style={{ marginTop: ".6rem" }}>
            {busy ? "Uploading…" : "Choose ID photo"}
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {msg && <p role="status">{msg}</p>}
    </section>
  );
}
