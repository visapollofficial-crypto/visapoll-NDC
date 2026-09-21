import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { db, REGION } from "../lib/admin";
import { assertPremium } from "../lib/premium";
import { rateLimit } from "../lib/rateLimit";
import { ALL_AI_SECRETS, getProvider } from "../ai/registry";

interface Facts {
  quizzes: number; avg: number; best: number; recentAvg: number; previousAvg: number | null; trend: "up" | "down" | "flat" | null;
  weakTopics: { topic: string; pct: number; answered: number }[]; strongTopics: { topic: string; pct: number; answered: number }[];
  subjects: { name: string; pct: number; answered: number }[]; difficulty: Record<string, number>;
  avgSecPerQuestion: number | null; quizzesLast14Days: number; activeDaysLast14: number; skippedRate: number;
}

type Bucket = Record<string, { correct: number; total: number }>;
const pctOf = (v: { correct: number; total: number }) => Math.round((v.correct / v.total) * 100);
const merge = (into: Bucket, from: Bucket | undefined) => Object.entries(from ?? {}).forEach(([k, v]) => { into[k] = into[k] ?? { correct: 0, total: 0 }; into[k].correct += v.correct; into[k].total += v.total; });
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Every number here is computed on the server from the student's own results. */
export function computeFacts(rows: FirebaseFirestore.DocumentData[]): Facts {
  const pcts = rows.map((r) => r.percent as number); // newest first
  const topics: Bucket = {}, subjects: Bucket = {}, diff: Bucket = {};
  let secs = 0, qs = 0, skipped = 0;
  rows.forEach((r) => { merge(topics, r.topics); merge(subjects, r.subjects); merge(diff, r.difficulty); secs += r.timeUsedSec ?? 0; qs += r.total ?? 0; skipped += r.skipped ?? 0; });
  const recent = pcts.slice(0, 3), previous = pcts.slice(3, 6);
  const recentAvg = Math.round(mean(recent)), previousAvg = previous.length ? Math.round(mean(previous)) : null;
  const trend = previousAvg === null ? null : recentAvg - previousAvg >= 5 ? "up" : previousAvg - recentAvg >= 5 ? "down" : "flat";
  const ranked = Object.entries(topics).filter(([, v]) => v.total >= 3).map(([topic, v]) => ({ topic, pct: pctOf(v), answered: v.total })).sort((a, b) => a.pct - b.pct);
  const cutoff = Date.now() - 14 * 86_400_000;
  const last14 = rows.filter((r) => (r.submittedAt as Timestamp).toMillis() >= cutoff);
  return {
    quizzes: rows.length, avg: Math.round(mean(pcts)), best: Math.max(...pcts), recentAvg, previousAvg, trend,
    weakTopics: ranked.filter((t) => t.pct < 70).slice(0, 5), strongTopics: ranked.filter((t) => t.pct >= 80).reverse().slice(0, 3),
    subjects: Object.entries(subjects).filter(([, v]) => v.total >= 3).map(([name, v]) => ({ name, pct: pctOf(v), answered: v.total })).sort((a, b) => a.pct - b.pct),
    difficulty: Object.fromEntries(Object.entries(diff).filter(([, v]) => v.total >= 3).map(([k, v]) => [k, pctOf(v)])),
    avgSecPerQuestion: qs ? Math.round(secs / qs) : null,
    quizzesLast14Days: last14.length, activeDaysLast14: new Set(last14.map((r) => new Date((r.submittedAt as Timestamp).toMillis()).toDateString())).size,
    skippedRate: qs ? Math.round((skipped / qs) * 100) : 0,
  };
}

/** Plain, deterministic tips. These always work, even if the AI provider is down. */
export function ruleInsights(f: Facts): { insights: string[]; suggestedRevision: string[] } {
  const insights: string[] = [];
  if (f.trend === "up") insights.push(`Your last 3 quizzes averaged ${f.recentAvg}%, up from ${f.previousAvg}% before. Keep going.`);
  if (f.trend === "down") insights.push(`Your last 3 quizzes averaged ${f.recentAvg}%, down from ${f.previousAvg}%. A short revision session could help.`);
  if (f.trend === "flat") insights.push(`Your scores have been steady around ${f.recentAvg}%.`);
  if (f.weakTopics[0]) insights.push(`You may need more practice in ${f.weakTopics[0].topic} (${f.weakTopics[0].pct}% correct).`);
  if (f.strongTopics[0]) insights.push(`${f.strongTopics[0].topic} is a strength (${f.strongTopics[0].pct}% correct).`);
  if (f.skippedRate >= 15) insights.push(`You leave about ${f.skippedRate}% of questions unanswered. If there's no negative marking, an educated guess costs nothing.`);
  if (f.quizzesLast14Days === 0) insights.push("You haven't taken a quiz in the last two weeks. Even one short practice quiz helps.");
  else if (f.activeDaysLast14 >= 4) insights.push(`You practised on ${f.activeDaysLast14} different days in the last two weeks. Regular practice pays off.`);
  return { insights: insights.slice(0, 5), suggestedRevision: f.weakTopics.slice(0, 4).map((t) => `Revise ${t.topic}, then try a practice quiz on it.`) };
}

// Insights are about study habits only. Anything that sounds like a judgement about the person is dropped.
const OFF_LIMITS = /(diagnos|disorder|depress|anxi|adhd|autis|mental|personalit|psycholog|stress|trauma|therap|lazy|stupid|dumb|intelligen|\biq\b|talent)/i;
export const safe = (xs: unknown): string[] => (Array.isArray(xs) ? xs : []).map((x) => String(x).trim()).filter((x) => x && x.length <= 220 && !OFF_LIMITS.test(x)).slice(0, 5);

export const learningInsights = onCall({ region: REGION, secrets: ALL_AI_SECRETS, timeoutSeconds: 90 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  await assertPremium(uid);

  const snap = await db.collection("quizResults").where("uid", "==", uid).orderBy("submittedAt", "desc").limit(30).get();
  if (snap.size < 3) return { needsMore: true, have: snap.size };
  const ref = db.doc(`learningInsights/${uid}`);
  const cached = (await ref.get()).data();
  const newest = snap.docs[0].id;
  if (cached && cached.lastResultId === newest && Date.now() - (cached.generatedAt as Timestamp).toMillis() < 24 * 3_600_000) return { needsMore: false, ...cached, generatedAt: (cached.generatedAt as Timestamp).toMillis() };

  await rateLimit(`insights_${uid}`, 8, 86400);
  const facts = computeFacts(snap.docs.map((d) => d.data()));
  const base = ruleInsights(facts);
  let insights = base.insights, suggestedRevision = base.suggestedRevision, aiUsed = false;
  try {
    const ai = await (await getProvider("learningPattern", uid)).analyzeLearningPattern({ stats: facts }); // aggregates only: no name, ID or contact details
    const i = safe(ai.insights), r = safe(ai.suggestedRevision);
    if (i.length) { insights = i; aiUsed = true; }
    if (r.length) suggestedRevision = r;
  } catch (e) { console.error("insights AI failed, using rule-based tips:", (e as Error).message); }

  const doc = { facts, insights, suggestedRevision, aiUsed, generatedAt: Timestamp.now(), lastResultId: newest, basedOn: snap.size };
  await ref.set(doc);
  return { needsMore: false, ...doc, generatedAt: doc.generatedAt.toMillis() };
});
