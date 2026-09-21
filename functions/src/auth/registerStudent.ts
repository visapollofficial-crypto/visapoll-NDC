import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { z } from "zod";
import { db, REGION } from "../lib/admin";
import { identityHash, normalizeName, normalizeStudentId } from "../lib/identity";
import { loadSettings } from "../lib/settings";
import { rateLimit } from "../lib/rateLimit";
import { IDENTITY_HMAC_PEPPER } from "../lib/secrets";
import { computeTrialStatus, type TrialStatus } from "../lib/trial";

const Input = z.object({
  fullName: z.string().trim().min(3).max(80),
  studentId: z.string().trim().min(3).max(30),
  department: z.enum(["Science", "Commerce", "Humanities"]),
  section: z.string().trim().min(1).max(20),
  session: z.string().trim().regex(/^\d{4}(-\d{2,4})?$/, "Use a format like 2025-26"),
  phone: z.string().trim().regex(/^(\+?88)?01[3-9]\d{8}$/, "Enter a valid Bangladesh mobile number"),
  consent: z.object({
    privacy: z.literal(true),
    terms: z.literal(true),
    version: z.string().max(20),
  }),
});

/**
 * Creates the student profile, decides verification, and decides trial eligibility.
 * Everything that matters is decided HERE, never in the browser.
 */
export const registerStudent = onCall(
  {
    region: REGION,
    secrets: [IDENTITY_HMAC_PEPPER],
    enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true",
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");

    const parsed = Input.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input.");
    }
    const input = parsed.data;

    await rateLimit(`register_uid_${uid}`, 5, 3600);
    const ip = request.rawRequest.ip ?? "unknown";
    await rateLimit(`register_ip_${ip}`, 20, 3600);

    const settings = await loadSettings();
    const key = normalizeStudentId(input.studentId);
    if (key.length < 3) throw new HttpsError("invalid-argument", "Invalid student ID.");
    const hash = identityHash(IDENTITY_HMAC_PEPPER.value(), key);

    const result = await db.runTransaction(async (tx) => {
      const userRef = db.doc(`users/${uid}`);
      const rosterRef = db.doc(`studentRoster/${key}`);
      const entRef = db.doc(`studentEntitlements/${hash}`);
      const subRef = db.doc(`subscriptions/${uid}`);

      // ---- all reads first ----
      const [userSnap, rosterSnap, entSnap] = await Promise.all([tx.get(userRef), tx.get(rosterRef), tx.get(entRef)]);
      if (userSnap.exists) throw new HttpsError("already-exists", "Your profile already exists.");

      // ---- verification: claimed details must match the admin-managed roster ----
      const roster = rosterSnap.data() as
        | { fullName: string; department: string; session: string; active?: boolean }
        | undefined;
      const verified =
        !!roster &&
        roster.active !== false &&
        normalizeName(roster.fullName) === normalizeName(input.fullName) &&
        roster.department === input.department &&
        roster.session === input.session;

      // ---- trial decision (server-authoritative) ----
      const ent = entSnap.data() as { trialUsed?: boolean; blocked?: boolean; currentAccountId?: string } | undefined;
      const trialStatus: TrialStatus = computeTrialStatus(verified, ent, settings);

      const now = Timestamp.now();
      const trialEnd = Timestamp.fromMillis(now.toMillis() + settings.freeTrialDurationDays * 86_400_000);

      // ---- all writes ----
      tx.set(userRef, {
        fullName: input.fullName,
        studentId: input.studentId,
        department: input.department,
        section: input.section,
        session: input.session,
        phone: input.phone,
        email: request.auth?.token.email ?? null,
        photoURL: null,
        scoreVisibility: "private",
        verificationStatus: verified ? "verified" : "pending",
        consent: { ...input.consent, at: now },
        createdAt: now,
      });

      tx.set(subRef, {
        status: trialStatus === "granted" ? "trial" : "none",
        endsAt: trialStatus === "granted" ? trialEnd : null,
        trialStatus,
        plan: null,
        updatedAt: now,
      });

      if (verified) {
        const base = { currentAccountId: uid, previousAccountIds: FieldValue.arrayUnion(uid) };
        if (trialStatus === "granted") {
          tx.set(entRef, { ...base, trialUsed: true, trialStartedAt: now, trialEndedAt: trialEnd }, { merge: true });
        } else {
          tx.set(entRef, { ...base, trialUsed: ent?.trialUsed ?? false }, { merge: true });
        }
        if (trialStatus === "already_used" && ent?.currentAccountId && ent.currentAccountId !== uid) {
          tx.set(db.collection("securityLogs").doc(), {
            type: "repeat_trial_attempt",
            uid,
            previousAccountId: ent.currentAccountId,
            ip,
            at: now,
          });
        }
      } else {
        tx.set(db.collection("securityLogs").doc(), { type: "unverified_registration", uid, ip, at: now });
      }

      return { verified, trialStatus };
    });

    // Custom claims are set outside the transaction; never downgrade staff roles.
    const auth = getAuth();
    const record = await auth.getUser(uid);
    if (!record.customClaims?.role) await auth.setCustomUserClaims(uid, { role: "student" });

    return {
      verificationStatus: result.verified ? "verified" : "pending",
      trialStatus: result.trialStatus,
    };
  }
);
