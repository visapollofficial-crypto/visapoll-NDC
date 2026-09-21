import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { db, REGION } from "../lib/admin";
import { notifyUsers } from "../lib/notify";

/** Nightly: warn 3 days before a plan ends, then flip lapsed trials/subscriptions to "expired" so premium features lock. */
export const expireSubscriptions = onSchedule(
  { schedule: "10 0 * * *", timeZone: "Asia/Dhaka", region: REGION },
  async () => {
    const now = Timestamp.now();

    const soon = await db.collection("subscriptions").where("status", "in", ["trial", "active"])
      .where("endsAt", ">", now).where("endsAt", "<", Timestamp.fromMillis(now.toMillis() + 3 * 86_400_000)).get();
    const pending = soon.docs.filter((d) => d.get("warned3d") !== true);
    for (const kind of ["trial", "active"] as const) {
      const ids = pending.filter((d) => d.get("status") === kind).map((d) => d.id);
      if (ids.length) await notifyUsers(ids, {
        type: "subscription", link: "/subscription",
        title: kind === "trial" ? "Your free trial ends soon" : "Your subscription ends soon",
        body: kind === "trial" ? "Subscribe to keep your quizzes, class notes and AI study guide." : "Renew to avoid losing access.",
      });
    }
    for (let i = 0; i < pending.length; i += 400) {
      const batch = db.batch();
      pending.slice(i, i + 400).forEach((d) => batch.update(d.ref, { warned3d: true }));
      await batch.commit();
    }

    const lapsed = await db.collection("subscriptions").where("status", "in", ["trial", "active"]).where("endsAt", "<", now).get();
    for (let i = 0; i < lapsed.docs.length; i += 400) {
      const batch = db.batch();
      lapsed.docs.slice(i, i + 400).forEach((d) => batch.update(d.ref, { status: "expired", updatedAt: now }));
      await batch.commit();
    }
    if (lapsed.docs.length) await notifyUsers(lapsed.docs.map((d) => d.id), { type: "subscription", title: "Your plan has expired", body: "Subscribe to unlock learning materials, quizzes and the AI study guide again.", link: "/subscription" });
  }
);
