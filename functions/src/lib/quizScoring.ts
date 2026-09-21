import { HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./admin";

export const GRACE_MS = 10_000;

export interface ServedQuestion { id: string; stem: string; options: { id: string; text: string }[] }
export interface ReviewItem {
  questionId: string; stem: string; options: { id: string; text: string }[];
  chosen: string | null; correct: string; isCorrect: boolean; explanation: string;
}
export interface ResultDoc {
  uid: string; quizId: string; quizTitle: string; mode: "practice" | "exam";
  score: number; maxScore: number; percent: number; correct: number; wrong: number; skipped: number; total: number;
  timeUsedSec: number; topics: Record<string, { correct: number; total: number }>;
  subjects: Record<string, { correct: number; total: number }>; difficulty: Record<string, { correct: number; total: number }>;
  autoSubmitted: boolean; submittedAt: Timestamp;
}

/**
 * Scores an attempt exactly once. Answers come from the server-stored attempt; the client's final
 * answers are only accepted if the attempt is still within its deadline (+ small grace).
 * Everything the client could tamper with (score, keys, timing) is decided here.
 */
export async function finalizeAttempt(attemptId: string, clientAnswers: Record<string, string | null> | undefined, auto: boolean): Promise<ResultDoc> {
  const attemptRef = db.doc(`quizAttempts/${attemptId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(attemptRef);
    if (!snap.exists) throw new HttpsError("not-found", "Attempt not found.");
    const a = snap.data()!;
    if (a.status === "submitted") {
      const existing = await tx.get(db.doc(`quizResults/${attemptId}`));
      return existing.data() as ResultDoc;
    }

    const now = Date.now();
    const deadline = (a.deadline as Timestamp).toMillis();
    const served = a.served as ServedQuestion[];
    const answers: Record<string, string | null> = { ...(a.answers ?? {}) };

    // Accept the client's final answers only while the attempt is still open.
    if (clientAnswers && !auto && now <= deadline + GRACE_MS) {
      for (const q of served) {
        const v = clientAnswers[q.id];
        if (v === null) answers[q.id] = null;
        else if (typeof v === "string" && q.options.some((o) => o.id === v)) answers[q.id] = v;
      }
    }

    const keyRefs = served.map((q) => db.doc(`questionKeys/${q.id}`));
    const keySnaps = await tx.getAll(...keyRefs);
    const cfg = a.cfg as { marksPerQuestion: number; negativeMarking: number };
    const meta = (a.meta ?? {}) as Record<string, { topic?: string; subject?: string; difficulty?: string }>;

    let correct = 0, wrong = 0, skipped = 0;
    const topics: ResultDoc["topics"] = {};
    const subjects: ResultDoc["subjects"] = {};
    const difficulty: ResultDoc["difficulty"] = {};
    const bump = (m: ResultDoc["topics"], k: string, ok: boolean) => { m[k] = m[k] ?? { correct: 0, total: 0 }; m[k].total++; if (ok) m[k].correct++; };
    const review: ReviewItem[] = served.map((q, i) => {
      const key = keySnaps[i].data() as { correct: string; explanation: string } | undefined;
      const chosen = answers[q.id] ?? null;
      const isCorrect = !!key && chosen === key.correct;
      if (chosen === null) skipped++; else if (isCorrect) correct++; else wrong++;
      const topic = meta[q.id]?.topic || "General";
      bump(topics, topic, isCorrect);
      bump(subjects, meta[q.id]?.subject || "General", isCorrect);
      if (meta[q.id]?.difficulty) bump(difficulty, meta[q.id].difficulty!, isCorrect);
      return { questionId: q.id, stem: q.stem, options: q.options, chosen, correct: key?.correct ?? "", isCorrect, explanation: key?.explanation ?? "" };
    });

    const maxScore = served.length * cfg.marksPerQuestion;
    const raw = correct * cfg.marksPerQuestion - wrong * cfg.marksPerQuestion * cfg.negativeMarking;
    const score = Math.max(0, Math.round(raw * 100) / 100);
    const startedAt = (a.startedAt as Timestamp).toMillis();
    const result: ResultDoc = {
      uid: a.uid, quizId: a.quizId, quizTitle: a.quizTitle, mode: a.mode,
      score, maxScore, percent: maxScore ? Math.round((score / maxScore) * 1000) / 10 : 0,
      correct, wrong, skipped, total: served.length,
      timeUsedSec: Math.max(0, Math.round((Math.min(now, deadline) - startedAt) / 1000)),
      topics, subjects, difficulty, autoSubmitted: auto || now > deadline, submittedAt: Timestamp.fromMillis(now),
    };

    tx.update(attemptRef, { status: "submitted", answers, submittedAt: result.submittedAt });
    tx.set(db.doc(`quizResults/${attemptId}`), result);
    tx.set(db.doc(`quizReviews/${attemptId}`), { uid: a.uid, quizId: a.quizId, items: review });
    return result;
  });
}

/** Whether answers/explanations may be shown, per the quiz's admin-configured policy. */
export function canReveal(quiz: FirebaseFirestore.DocumentData | undefined): boolean {
  if (!quiz) return true;
  const policy = quiz.revealAnswers ?? "immediately";
  if (policy === "immediately") return true;
  if (policy === "never") return false;
  const end = quiz.endAt ? (quiz.endAt as Timestamp).toMillis() : null;
  return quiz.status === "closed" || (end !== null && Date.now() > end);
}
