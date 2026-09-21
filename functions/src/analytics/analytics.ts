import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { db, REGION } from "../lib/admin";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/guard";
import { rateLimit } from "../lib/rateLimit";

const DAY = 86_400_000, DHAKA = 6 * 3_600_000;
const dhakaDate = (ms: number) => new Date(ms + DHAKA).toISOString().slice(0, 10);
const dayStart = (date: string) => Date.parse(`${date}T00:00:00+06:00`);

/** Students open the app; we record "active today" once per person per day (no page tracking, no content). */
export const pingActive = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const date = dhakaDate(Date.now());
  await db.doc(`activeUsers/${date}_${uid}`).set({ date, uid, at: Timestamp.now() });
  return { ok: true };
});

type Bucket = Record<string, { correct: number; total: number }>;
const add = (into: Bucket, from: Bucket | undefined) => Object.entries(from ?? {}).forEach(([k, v]) => { into[k] = into[k] ?? { correct: 0, total: 0 }; into[k].correct += v.correct; into[k].total += v.total; });

/** Builds one anonymous daily summary. Admin dashboards read only these summaries, never individual students. */
export async function computeDay(date: string): Promise<void> {
  const start = Timestamp.fromMillis(dayStart(date));
  const end = Timestamp.fromMillis(start.toMillis() + DAY);
  const weekFrom = dhakaDate(start.toMillis() - 6 * DAY);
  const count = async (q: FirebaseFirestore.Query) => (await q.count().get()).data().count;

  const [activeSnap, weekSnap, results, newStudents, pays, posts, aiReq, totalStudents, trial, paid, expired, none] = await Promise.all([
    db.collection("activeUsers").where("date", "==", date).count().get(),
    db.collection("activeUsers").where("date", ">=", weekFrom).where("date", "<=", date).select("uid").get(),
    db.collection("quizResults").where("submittedAt", ">=", start).where("submittedAt", "<", end).get(),
    count(db.collection("users").where("createdAt", ">=", start).where("createdAt", "<", end)),
    db.collection("payments").where("status", "==", "verified").where("verifiedAt", ">=", start).where("verifiedAt", "<", end).get(),
    count(db.collection("posts").where("createdAt", ">=", start).where("createdAt", "<", end)),
    count(db.collection("aiRequests").where("at", ">=", start).where("at", "<", end)),
    count(db.collection("users")),
    count(db.collection("subscriptions").where("status", "==", "trial")),
    count(db.collection("subscriptions").where("status", "==", "active")),
    count(db.collection("subscriptions").where("status", "==", "expired")),
    count(db.collection("subscriptions").where("status", "==", "none")),
  ]);

  const subjects: Bucket = {}, topics: Bucket = {};
  const takers = new Set<string>();
  let pctSum = 0, exam = 0, practice = 0;
  results.docs.forEach((d) => {
    takers.add(d.get("uid")); pctSum += d.get("percent") ?? 0;
    d.get("mode") === "exam" ? exam++ : practice++;
    add(subjects, d.get("subjects")); add(topics, d.get("topics"));
  });
  // Keep the 60 busiest topics so the summary stays small.
  const topTopics = Object.fromEntries(Object.entries(topics).sort((a, b) => b[1].total - a[1].total).slice(0, 60));

  await db.doc(`analyticsDaily/${date}`).set({
    date,
    activeStudents: activeSnap.data().count,
    weeklyActive: new Set(weekSnap.docs.map((d) => d.get("uid"))).size,
    totalStudents, newStudents,
    quizAttempts: results.size, quizParticipants: takers.size, examAttempts: exam, practiceAttempts: practice,
    avgScore: results.size ? Math.round((pctSum / results.size) * 10) / 10 : null,
    subjects, topics: topTopics,
    paymentsVerified: pays.size, revenue: pays.docs.reduce((a, d) => a + (d.get("paidAmount") ?? d.get("amount") ?? 0), 0),
    posts, aiRequests: aiReq,
    subscriptions: { trial, paid, expired, none }, // point-in-time when this summary was computed
    computedAt: Timestamp.now(),
  });
}

export const aggregateAnalytics = onSchedule({ schedule: "30 0 * * *", timeZone: "Asia/Dhaka", region: REGION, timeoutSeconds: 300 }, async () => {
  const now = Date.now();
  await computeDay(dhakaDate(now - DAY));
  await computeDay(dhakaDate(now));
  const old = await db.collection("activeUsers").where("date", "<", dhakaDate(now - 90 * DAY)).limit(400).get(); // keep 90 days
  const b = db.batch(); old.docs.forEach((d) => b.delete(d.ref)); await b.commit();
});

/** "Refresh now" button: recomputes today and, optionally, the past N days (for a first-time backfill). */
export const adminRefreshAnalytics = onCall({ region: REGION, timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
  const { uid } = requireAdmin(request);
  const parsed = z.object({ days: z.number().int().min(1).max(30).default(1) }).safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError("invalid-argument", "Choose 1 to 30 days.");
  await rateLimit(`analytics_${uid}`, 6, 3600);
  const now = Date.now();
  for (let i = parsed.data.days - 1; i >= 0; i--) await computeDay(dhakaDate(now - i * DAY));
  await audit(uid, "analytics_refreshed", "analyticsDaily", { days: parsed.data.days });
  return { ok: true, days: parsed.data.days };
});
