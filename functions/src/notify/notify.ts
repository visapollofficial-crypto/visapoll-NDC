import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db, REGION } from "../lib/admin";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/guard";
import { audienceUids, notifyUsers, APP_URL, type Audience } from "../lib/notify";
import { rateLimit } from "../lib/rateLimit";

/** Called by the app after the browser grants notification permission. */
export const registerFcmToken = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = z.object({ token: z.string().min(100).max(4096) }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid device token.");
  await rateLimit(`fcm_${uid}`, 20, 3600);
  const ref = db.doc(`fcmTokens/${uid}`);
  await db.runTransaction(async (tx) => {
    const cur = ((await tx.get(ref)).get("tokens") as string[] | undefined) ?? [];
    const next = [...cur.filter((t) => t !== parsed.data.token), parsed.data.token].slice(-5); // keep the 5 newest devices
    tx.set(ref, { tokens: next });
  });
  return { ok: true };
});

export const unregisterFcmToken = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = z.object({ token: z.string().min(100).max(4096) }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid device token.");
  const ref = db.doc(`fcmTokens/${uid}`);
  const cur = ((await ref.get()).get("tokens") as string[] | undefined) ?? [];
  await ref.set({ tokens: cur.filter((t) => t !== parsed.data.token) });
  return { ok: true };
});

const Input = z.object({
  scope: z.enum(["all", "department", "section", "student"]),
  department: z.enum(["Science", "Commerce", "Humanities"]).optional(),
  section: z.string().trim().max(20).optional(),
  studentId: z.string().trim().max(30).optional(),
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(300),
  link: z.string().regex(/^\/[\w\-/]*$/).max(100).optional().or(z.literal("")),
  important: z.boolean().default(false),
});

/** Admin broadcast: individual, section, department, or all students. */
export const adminSendNotification = onCall({ region: REGION }, async (request) => {
  const { uid } = requireAdmin(request);
  const parsed = Input.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Check the title, message and audience.");
  const d = parsed.data;
  await rateLimit(`broadcast_${uid}`, 30, 3600);

  let audience: Audience;
  if (d.scope === "all") audience = { scope: "all" };
  else if (d.scope === "department" && d.department) audience = { scope: "department", departments: [d.department] };
  else if (d.scope === "section" && d.department && d.section) audience = { scope: "section", department: d.department, section: d.section };
  else if (d.scope === "student" && d.studentId) audience = { scope: "student", studentId: d.studentId };
  else throw new HttpsError("invalid-argument", "Choose who should receive this.");

  const uids = await audienceUids(audience);
  if (uids.length === 0) throw new HttpsError("not-found", "No students match that audience.");
  const r = await notifyUsers(uids, { type: "admin", title: d.title, body: d.body, link: d.link || undefined, important: d.important });
  await audit(uid, "notification_sent", d.scope, { audience: d.scope === "student" ? "one student" : d, recipients: r.inApp, pushed: r.pushed });
  return { recipients: r.inApp, pushed: r.pushed, pushConfigured: !!APP_URL.value() };
});
