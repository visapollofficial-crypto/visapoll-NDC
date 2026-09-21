import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getStorage } from "firebase-admin/storage";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { db, REGION } from "../lib/admin";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/guard";
import { notifyUsers } from "../lib/notify";
import { identityHash, normalizeStudentId } from "../lib/identity";
import { rateLimit } from "../lib/rateLimit";
import { IDENTITY_HMAC_PEPPER } from "../lib/secrets";
import { loadSettings } from "../lib/settings";
import { computeTrialStatus } from "../lib/trial";

const bucket = () => getStorage().bucket();

/** Student submits an ID card image (already uploaded to their private folder) with explicit consent. */
export const submitVerification = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = z.object({ path: z.string().max(300), idConsent: z.literal(true) }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Please confirm your consent to upload your ID.");
  const { path } = parsed.data;
  if (!path.startsWith(`verification/${uid}/`)) throw new HttpsError("invalid-argument", "Invalid file.");
  await rateLimit(`verify_${uid}`, 5, 86400);

  const user = (await db.doc(`users/${uid}`).get()).data();
  if (!user) throw new HttpsError("failed-precondition", "Finish registration first.");
  if (user.verificationStatus === "verified") throw new HttpsError("already-exists", "You are already verified.");
  if (!(await bucket().file(path).exists())[0]) throw new HttpsError("invalid-argument", "Upload didn't finish. Try again.");

  await db.doc(`verificationRequests/${uid}`).set({
    status: "pending",
    idCardPath: path,
    consentAt: Timestamp.now(),
    submittedAt: Timestamp.now(),
  });
  await db.doc(`users/${uid}`).update({ verificationStatus: "pending", verificationNote: null });
  return { ok: true };
});

/** Admin-only, 5-minute signed link. Every view is audit-logged. */
export const getVerificationImageUrl = onCall({ region: REGION }, async (request) => {
  const { uid: adminId } = requireAdmin(request);
  const uid = z.string().min(1).parse(request.data?.uid);
  const req = (await db.doc(`verificationRequests/${uid}`).get()).data();
  if (!req?.idCardPath) throw new HttpsError("not-found", "No ID image on file.");
  const [url] = await bucket().file(req.idCardPath).getSignedUrl({ action: "read", expires: Date.now() + 5 * 60_000 });
  await audit(adminId, "viewed_verification_id", uid);
  return { url };
});

const Review = z.object({
  uid: z.string().min(1),
  decision: z.enum(["approve", "reject", "reupload"]),
  note: z.string().trim().max(300).optional(),
});

/** Approve / reject / ask for re-upload. Approval triggers the server-side trial decision. The ID image is deleted after any decision. */
export const reviewVerification = onCall({ region: REGION, secrets: [IDENTITY_HMAC_PEPPER] }, async (request) => {
  const { uid: adminId } = requireAdmin(request);
  const parsed = Review.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { uid, decision, note } = parsed.data;

  const reqRef = db.doc(`verificationRequests/${uid}`);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists || reqSnap.data()?.status !== "pending") throw new HttpsError("failed-precondition", "No pending request.");
  const user = (await db.doc(`users/${uid}`).get()).data();
  if (!user) throw new HttpsError("not-found", "Student not found.");
  if (decision !== "approve" && !note) throw new HttpsError("invalid-argument", "Add a short reason for the student.");

  const now = Timestamp.now();
  let trialStatus: string | null = null;

  if (decision === "approve") {
    const settings = await loadSettings();
    const hash = identityHash(IDENTITY_HMAC_PEPPER.value(), normalizeStudentId(user.studentId));
    trialStatus = await db.runTransaction(async (tx) => {
      const entRef = db.doc(`studentEntitlements/${hash}`);
      const subRef = db.doc(`subscriptions/${uid}`);
      const [entSnap, subSnap] = await Promise.all([tx.get(entRef), tx.get(subRef)]);
      const ent = entSnap.data() as { trialUsed?: boolean; blocked?: boolean; currentAccountId?: string } | undefined;
      const status = computeTrialStatus(true, ent, settings);
      const end = Timestamp.fromMillis(now.toMillis() + settings.freeTrialDurationDays * 86_400_000);
      const base = { currentAccountId: uid, previousAccountIds: FieldValue.arrayUnion(uid) };

      tx.update(db.doc(`users/${uid}`), { verificationStatus: "verified", verificationNote: null });
      // Never overwrite a paid or running plan.
      const cur = subSnap.data()?.status;
      if (!subSnap.exists || cur === "none" || cur === undefined) {
        tx.set(subRef, { status: status === "granted" ? "trial" : "none", endsAt: status === "granted" ? end : null, trialStatus: status, plan: null, updatedAt: now }, { merge: true });
      }
      tx.set(entRef, status === "granted" ? { ...base, trialUsed: true, trialStartedAt: now, trialEndedAt: end } : { ...base, trialUsed: ent?.trialUsed ?? false }, { merge: true });
      if (status === "already_used" && ent?.currentAccountId && ent.currentAccountId !== uid) {
        tx.set(db.collection("securityLogs").doc(), { type: "repeat_trial_attempt", uid, previousAccountId: ent.currentAccountId, at: now });
      }
      return status;
    });
  } else {
    await db.doc(`users/${uid}`).update({
      verificationStatus: decision === "reject" ? "rejected" : "reupload_required",
      verificationNote: note ?? null,
    });
  }

  // Retention: the ID image is removed as soon as a decision is made.
  const path = reqSnap.data()?.idCardPath as string | undefined;
  if (path) await bucket().file(path).delete().catch(() => undefined);
  await reqRef.update({
    status: decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "reupload_required",
    reviewedBy: adminId, reviewedAt: now, note: note ?? null, idCardPath: null, purgedAt: now,
  });
  await audit(adminId, `verification_${decision}`, uid, { trialStatus });
  await notifyUsers([uid], {
    type: "verification", link: decision === "approve" ? "/dashboard" : "/profile",
    title: decision === "approve" ? "You're verified" : decision === "reject" ? "Verification was not approved" : "Please upload your ID again",
    body: decision === "approve" ? (trialStatus === "granted" ? "Your free trial has started." : "Your student ID is verified.") : (note ?? "Open your profile for details."),
  });
  return { ok: true, trialStatus };
});
