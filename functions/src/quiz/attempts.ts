import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { randomInt } from "crypto";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { db, REGION } from "../lib/admin";
import { assertPremium } from "../lib/premium";
import { rateLimit } from "../lib/rateLimit";
import { canReveal, finalizeAttempt, GRACE_MS, type ServedQuestion } from "../lib/quizScoring";

const shuffle = <T>(xs: T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

interface AttemptPayload {
  attemptId: string; serverNow: number; startedAt: number; deadline: number; mode: string; quizTitle: string;
  questions: ServedQuestion[]; answers: Record<string, string | null>;
}
const payloadOf = (id: string, a: FirebaseFirestore.DocumentData): AttemptPayload => ({
  attemptId: id, serverNow: Date.now(), startedAt: a.startedAt.toMillis(), deadline: a.deadline.toMillis(),
  mode: a.mode, quizTitle: a.quizTitle, questions: a.served, answers: a.answers ?? {},
});

export const startAttempt = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = z.object({ quizId: z.string().min(1).max(40), mode: z.enum(["practice", "exam"]) }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { quizId, mode } = parsed.data;

  await assertPremium(uid);
  await rateLimit(`start_${uid}`, 30, 3600);

  const quiz = (await db.doc(`quizzes/${quizId}`).get()).data();
  if (!quiz || quiz.status !== "published") throw new HttpsError("not-found", "This quiz isn't available.");
  const user = (await db.doc(`users/${uid}`).get()).data();
  if (!user || !(quiz.departments as string[]).includes(user.department)) throw new HttpsError("permission-denied", "This quiz isn't for your department.");

  const now = Date.now();
  const startAt = quiz.startAt ? (quiz.startAt as Timestamp).toMillis() : null;
  const endAt = quiz.endAt ? (quiz.endAt as Timestamp).toMillis() : null;
  if (mode === "exam") {
    if (quiz.type !== "weekly" || startAt === null || endAt === null) throw new HttpsError("failed-precondition", "This quiz has no live exam. Use practice mode.");
    if (now < startAt) throw new HttpsError("failed-precondition", "The exam hasn't started yet.");
    if (now > endAt) throw new HttpsError("failed-precondition", "The exam window has closed. You can still practice.");
  }

  // Close out any abandoned attempt whose time has run out, so it can't block a new one.
  const open = await db.collection("quizAttempts").where("uid", "==", uid).where("quizId", "==", quizId).where("mode", "==", mode).where("status", "==", "in_progress").get();
  for (const d of open.docs) {
    if (now > (d.data().deadline as Timestamp).toMillis() + GRACE_MS) await finalizeAttempt(d.id, undefined, true);
  }

  // Build the served question set (random subset, shuffled) from PUBLISHED questions only.
  let ids = quiz.questionIds as string[];
  if (quiz.questionCount > 0 && quiz.questionCount < ids.length) ids = shuffle(ids).slice(0, quiz.questionCount);
  const qSnaps = await db.getAll(...ids.map((id) => db.doc(`questions/${id}`)));
  let qs = qSnaps.filter((s) => s.exists && s.data()?.status === "published");
  if (qs.length === 0) throw new HttpsError("failed-precondition", "This quiz has no questions yet.");
  if (quiz.shuffleQuestions) qs = shuffle(qs);

  const served: ServedQuestion[] = qs.map((s) => {
    const d = s.data()!;
    const opts = d.options as { id: string; text: string }[];
    return { id: s.id, stem: d.stem, options: quiz.shuffleOptions ? shuffle(opts) : opts };
  });
  const meta = Object.fromEntries(qs.map((s) => [s.id, { topic: s.data()!.topic || s.data()!.chapter, difficulty: s.data()!.difficulty, subject: s.data()!.subjectName }]));

  const limitN: number = mode === "exam" ? quiz.examAttempts : quiz.practiceAttempts;
  const deadlineMs = Math.min(now + quiz.durationMin * 60_000, mode === "exam" && endAt ? endAt : Infinity);
  if (deadlineMs - now < 30_000) throw new HttpsError("failed-precondition", "The exam is about to close.");

  const counterRef = db.doc(`attemptCounters/${uid}_${quizId}_${mode}`);
  const attemptRef = db.collection("quizAttempts").doc();

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(db.collection("quizAttempts").where("uid", "==", uid).where("quizId", "==", quizId).where("mode", "==", mode).where("status", "==", "in_progress").limit(1));
    if (!existing.empty) return payloadOf(existing.docs[0].id, existing.docs[0].data()); // resume
    const counter = await tx.get(counterRef);
    const used = counter.exists ? (counter.data()!.count as number) : 0;
    if (used >= limitN) {
      throw new HttpsError("failed-precondition", mode === "exam" ? "You have already used your exam attempt." : "You have used all your practice attempts for this quiz.");
    }
    const attempt = {
      uid, quizId, quizTitle: quiz.title, mode, status: "in_progress", served, answers: {}, meta,
      cfg: { marksPerQuestion: quiz.marksPerQuestion, negativeMarking: quiz.negativeMarking },
      startedAt: Timestamp.fromMillis(now), deadline: Timestamp.fromMillis(deadlineMs),
    };
    tx.set(counterRef, { uid, quizId, mode, count: used + 1 });
    tx.set(attemptRef, attempt);
    return payloadOf(attemptRef.id, attempt as unknown as FirebaseFirestore.DocumentData);
  }).then((p) => ({ ...p, serverNow: Date.now() }));
});

/** Saves one answer as the student goes, so a closed tab or dead battery doesn't lose progress. */
export const saveAnswer = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = z.object({ attemptId: z.string().min(1).max(40), questionId: z.string().min(1).max(40), optionId: z.string().max(4).nullable() }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid answer.");
  const { attemptId, questionId, optionId } = parsed.data;
  const ref = db.doc(`quizAttempts/${attemptId}`);
  const a = (await ref.get()).data();
  if (!a || a.uid !== uid) throw new HttpsError("not-found", "Attempt not found.");
  if (a.status !== "in_progress") throw new HttpsError("failed-precondition", "This attempt is already submitted.");
  if (Date.now() > (a.deadline as Timestamp).toMillis() + 3000) throw new HttpsError("failed-precondition", "Time is up.");
  const q = (a.served as ServedQuestion[]).find((x) => x.id === questionId);
  if (!q || (optionId !== null && !q.options.some((o) => o.id === optionId))) throw new HttpsError("invalid-argument", "Invalid answer.");
  await ref.update(new FieldPath("answers", questionId), optionId);
  return { ok: true };
});

export const submitAttempt = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = z.object({ attemptId: z.string().min(1).max(40), answers: z.record(z.string().nullable()).optional() }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const a = (await db.doc(`quizAttempts/${parsed.data.attemptId}`).get()).data();
  if (!a || a.uid !== uid) throw new HttpsError("not-found", "Attempt not found.");
  const result = await finalizeAttempt(parsed.data.attemptId, parsed.data.answers, false);
  return { attemptId: parsed.data.attemptId, result };
});

/** Result summary always; per-question review only when the quiz's reveal policy allows. */
export const getResult = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const attemptId = z.string().min(1).max(40).parse(request.data?.attemptId);
  const result = (await db.doc(`quizResults/${attemptId}`).get()).data();
  if (!result || result.uid !== uid) throw new HttpsError("not-found", "Result not found.");
  const quiz = (await db.doc(`quizzes/${result.quizId}`).get()).data();
  const revealed = canReveal(quiz);
  const review = revealed ? ((await db.doc(`quizReviews/${attemptId}`).get()).data()?.items ?? []) : null;
  return { result, revealed, review };
});

/** Every 5 minutes: score attempts whose timer ran out (closed tab, no connection, etc.). */
export const autoSubmitExpired = onSchedule({ schedule: "every 5 minutes", region: REGION }, async () => {
  const snap = await db.collection("quizAttempts").where("status", "==", "in_progress").where("deadline", "<", Timestamp.fromMillis(Date.now() - GRACE_MS)).limit(200).get();
  for (const d of snap.docs) await finalizeAttempt(d.id, undefined, true).catch((e) => console.error("auto-submit failed", d.id, e));
});
