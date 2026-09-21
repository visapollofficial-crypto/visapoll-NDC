import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { z } from "zod";
import { db, REGION } from "../lib/admin";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/guard";
import { identityHash, normalizeStudentId } from "../lib/identity";
import { IDENTITY_HMAC_PEPPER } from "../lib/secrets";
import { loadSettings } from "../lib/settings";

const Input = z.object({
  uid: z.string().min(1),
  action: z.enum(["grant", "revoke", "extend", "block", "unblock"]),
  days: z.number().int().min(1).max(365).optional(),
});

/** Manual trial controls. All decisions run server-side and are audit-logged. */
export const adminTrialAction = onCall({ region: REGION, secrets: [IDENTITY_HMAC_PEPPER] }, async (request) => {
  const { uid: adminId } = requireAdmin(request);
  const parsed = Input.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { uid, action, days } = parsed.data;

  const user = (await db.doc(`users/${uid}`).get()).data();
  if (!user) throw new HttpsError("not-found", "Student not found.");
  if (user.verificationStatus !== "verified") throw new HttpsError("failed-precondition", "Verify the student before changing their trial.");

  const s = await loadSettings();
  const hash = identityHash(IDENTITY_HMAC_PEPPER.value(), normalizeStudentId(user.studentId));
  const entRef = db.doc(`studentEntitlements/${hash}`);
  const subRef = db.doc(`subscriptions/${uid}`);
  const now = Timestamp.now();
  const ent = { currentAccountId: uid, previousAccountIds: FieldValue.arrayUnion(uid) };

  await db.runTransaction(async (tx) => {
    const sub = (await tx.get(subRef)).data() as { status?: string; endsAt?: Timestamp | null } | undefined;
    const plus = (from: number, d: number) => Timestamp.fromMillis(from + d * 86_400_000);

    if (action === "grant") {
      if (sub?.status === "active") throw new HttpsError("failed-precondition", "This student already has a paid plan.");
      const end = plus(now.toMillis(), days ?? s.freeTrialDurationDays);
      tx.set(subRef, { status: "trial", endsAt: end, trialStatus: "granted", warned3d: false, updatedAt: now }, { merge: true });
      tx.set(entRef, { ...ent, trialUsed: true, trialStartedAt: now, trialEndedAt: end, blocked: false }, { merge: true });
    } else if (action === "extend") {
      if (!days) throw new HttpsError("invalid-argument", "Enter the number of days.");
      const from = Math.max(now.toMillis(), sub?.endsAt?.toMillis() ?? 0);
      const end = plus(from, days);
      tx.set(subRef, { status: sub?.status === "active" ? "active" : "trial", endsAt: end, warned3d: false, updatedAt: now }, { merge: true });
      tx.set(entRef, { ...ent, trialUsed: true, trialEndedAt: end }, { merge: true });
    } else if (action === "revoke" || action === "block") {
      if (sub?.status === "trial") tx.update(subRef, { status: "expired", endsAt: now, updatedAt: now });
      else if (action === "revoke") throw new HttpsError("failed-precondition", "There is no active trial to revoke.");
      if (action === "block") tx.set(entRef, { ...ent, blocked: true }, { merge: true });
    } else {
      tx.set(entRef, { ...ent, blocked: false }, { merge: true });
    }
  });

  await audit(adminId, `trial_${action}`, uid, { days: days ?? null });
  return { ok: true };
});

/** Suspend blocks sign-in and revokes existing sessions. */
export const adminSetSuspension = onCall({ region: REGION }, async (request) => {
  const { uid: adminId } = requireAdmin(request);
  const parsed = z.object({ uid: z.string().min(1), suspended: z.boolean(), reason: z.string().trim().max(200).optional() }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { uid, suspended, reason } = parsed.data;
  if (uid === adminId) throw new HttpsError("failed-precondition", "You can't suspend yourself.");
  const target = await getAuth().getUser(uid);
  if (["admin", "superadmin"].includes(target.customClaims?.role)) throw new HttpsError("permission-denied", "Admins can't be suspended here.");
  await getAuth().updateUser(uid, { disabled: suspended });
  if (suspended) await getAuth().revokeRefreshTokens(uid);
  await db.doc(`users/${uid}`).update({ suspended, suspendedReason: suspended ? reason ?? null : null });
  await audit(adminId, suspended ? "student_suspended" : "student_unsuspended", uid, { reason: reason ?? null });
  return { ok: true };
});
