import { getMessaging } from "firebase-admin/messaging";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { defineString } from "firebase-functions/params";
import { db } from "./admin";

/** Public URL of the web app (e.g. https://ndc-learn.web.app). Used so tapping a push opens the right page. */
export const APP_URL = defineString("APP_URL", { default: "" });

export type NotifType = "quiz" | "result" | "material" | "announcement" | "admin" | "comment" | "subscription" | "verification";
export interface Payload { type: NotifType; title: string; body: string; link?: string; important?: boolean }

// Which user preference (if any) can silence each type. Account/security messages can't be muted.
const PREF_OF: Record<NotifType, "quiz" | "material" | "announcements" | "social" | null> = {
  quiz: "quiz", result: "quiz", material: "material", announcement: "announcements", admin: "announcements",
  comment: "social", subscription: null, verification: null,
};

const chunk = <T>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export type Audience =
  | { scope: "all" }
  | { scope: "department"; departments: string[] }
  | { scope: "section"; department: string; section: string }
  | { scope: "student"; studentId: string };

/** Resolves an audience to user ids on the server. Suspended accounts are skipped. */
export async function audienceUids(a: Audience): Promise<string[]> {
  const col = db.collection("users");
  const snaps: FirebaseFirestore.QuerySnapshot[] = [];
  if (a.scope === "all") snaps.push(await col.select("suspended").get());
  else if (a.scope === "department") for (const d of a.departments) snaps.push(await col.where("department", "==", d).select("suspended").get());
  else if (a.scope === "section") snaps.push(await col.where("department", "==", a.department).where("section", "==", a.section).select("suspended").get());
  else snaps.push(await col.where("studentId", "==", a.studentId).select("suspended").get());
  const ids = new Set<string>();
  snaps.forEach((s) => s.docs.forEach((d) => { if (!d.get("suspended")) ids.add(d.id); }));
  return [...ids];
}

/**
 * Creates the in-app notification for each user and sends a push to their devices.
 * Never throws for delivery problems: a failed push must not break the action that triggered it.
 */
export async function notifyUsers(uids: string[], p: Payload): Promise<{ inApp: number; pushed: number }> {
  try {
    let targets = [...new Set(uids)];
    if (targets.length === 0) return { inApp: 0, pushed: 0 };

    const prefKey = p.important ? null : PREF_OF[p.type];
    if (prefKey) {
      const muted = new Set<string>();
      for (const part of chunk(targets, 300)) {
        const snaps = await db.getAll(...part.map((u) => db.doc(`notificationPrefs/${u}`)));
        snaps.forEach((s, i) => { if (s.exists && s.get(prefKey) === false) muted.add(part[i]); });
      }
      targets = targets.filter((u) => !muted.has(u));
    }
    if (targets.length === 0) return { inApp: 0, pushed: 0 };

    const now = Timestamp.now();
    for (const part of chunk(targets, 400)) {
      const batch = db.batch();
      part.forEach((uid) => batch.set(db.collection("notifications").doc(), { uid, type: p.type, title: p.title, body: p.body, link: p.link ?? null, read: false, createdAt: now }));
      await batch.commit();
    }

    // ---- push ----
    const tokens: string[] = [], owners: string[] = [];
    for (const part of chunk(targets, 300)) {
      const snaps = await db.getAll(...part.map((u) => db.doc(`fcmTokens/${u}`)));
      snaps.forEach((s, i) => ((s.get("tokens") as string[] | undefined) ?? []).forEach((t) => { tokens.push(t); owners.push(part[i]); }));
    }
    const base = APP_URL.value().replace(/\/$/, "");
    let pushed = 0;
    const dead: { uid: string; token: string }[] = [];
    for (const part of chunk(tokens.map((t, i) => ({ t, u: owners[i] })), 500)) {
      const res = await getMessaging().sendEachForMulticast({
        tokens: part.map((x) => x.t),
        notification: { title: p.title, body: p.body },
        data: { type: p.type, link: p.link ?? "" },
        ...(p.link && base ? { webpush: { fcmOptions: { link: `${base}${p.link}` } } } : {}),
      });
      pushed += res.successCount;
      res.responses.forEach((r, i) => {
        const code = r.error?.code ?? "";
        if (!r.success && (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token")) dead.push({ uid: part[i].u, token: part[i].t });
      });
    }
    await Promise.all(dead.map((d) => db.doc(`fcmTokens/${d.uid}`).update({ tokens: FieldValue.arrayRemove(d.token) }).catch(() => undefined)));
    return { inApp: targets.length, pushed };
  } catch (e) {
    console.error("notifyUsers failed:", (e as Error).message);
    return { inApp: 0, pushed: 0 };
  }
}
