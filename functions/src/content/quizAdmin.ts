import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { db, REGION } from "../lib/admin";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/guard";
import { audienceUids, notifyUsers } from "../lib/notify";

const Question = z.object({
  id: z.string().max(40).optional(),
  subjectId: z.string().min(1).max(60), subjectName: z.string().min(1).max(60),
  chapter: z.string().trim().min(1).max(120), topic: z.string().trim().max(120).default(""),
  difficulty: z.enum(["easy", "medium", "hard"]),
  type: z.enum(["conceptual", "calculation", "application", "important"]),
  sourceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  stem: z.string().trim().min(5).max(1000),
  options: z.array(z.string().trim().min(1).max(300)).length(4),
  correct: z.enum(["a", "b", "c", "d"]),
  explanation: z.string().trim().max(1500).default(""),
  status: z.enum(["draft", "ai_generated", "approved", "published", "rejected"]),
});

/** AI-generated questions must be approved by an admin before they can be published. */
function assertCanPublish(cur: FirebaseFirestore.DocumentData | undefined, next: string) {
  if (cur?.aiGenerated && next === "published" && !["approved", "published"].includes(cur.status)) {
    throw new HttpsError("failed-precondition", "AI-generated questions must be reviewed and approved before they are published.");
  }
}

export const saveQuestion = onCall({ region: REGION }, async (request) => {
  const { uid } = requireAdmin(request);
  const parsed = Question.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Check the question: it needs 4 options, a correct answer and a subject.");
  const { id, options, correct, explanation, ...rest } = parsed.data;
  if (new Set(options.map((o) => o.toLowerCase())).size !== 4) throw new HttpsError("invalid-argument", "The four options must all be different.");

  const ref = id ? db.doc(`questions/${id}`) : db.collection("questions").doc();
  if (id) {
    const cur = (await ref.get()).data();
    assertCanPublish(cur, rest.status);
  }
  const now = Timestamp.now();
  const batch = db.batch();
  batch.set(ref, {
    ...rest, sourceDate: rest.sourceDate || null,
    options: options.map((text, i) => ({ id: "abcd"[i], text })),
    updatedAt: now, ...(id ? { editedByAdmin: true } : { createdBy: uid, createdAt: now }),
  }, { merge: true });
  // The answer key lives in its own collection that students can never read.
  batch.set(db.doc(`questionKeys/${ref.id}`), { correct, explanation });
  await batch.commit();
  await audit(uid, id ? "question_updated" : "question_created", ref.id, { status: rest.status });
  return { id: ref.id };
});

export const deleteQuestion = onCall({ region: REGION }, async (request) => {
  const { uid } = requireAdmin(request);
  const id = z.string().min(1).max(40).parse(request.data?.id);
  const used = await db.collection("quizzes").where("questionIds", "array-contains", id).limit(1).get();
  if (!used.empty) throw new HttpsError("failed-precondition", "This question is used in a quiz. Remove it from the quiz first, or reject it instead.");
  await Promise.all([db.doc(`questions/${id}`).delete(), db.doc(`questionKeys/${id}`).delete()]);
  await audit(uid, "question_deleted", id);
  return { ok: true };
});

const Quiz = z.object({
  id: z.string().max(40).optional(),
  title: z.string().trim().min(3).max(120),
  type: z.enum(["weekly", "topic"]),
  subjectName: z.string().trim().max(60).default(""),
  questionIds: z.array(z.string().min(1).max(40)).min(1).max(100),
  questionCount: z.number().int().min(0).max(100).default(0),
  durationMin: z.number().int().min(1).max(300),
  marksPerQuestion: z.number().min(0.5).max(10).default(1),
  negativeMarking: z.number().min(0).max(1).default(0),
  examAttempts: z.number().int().min(1).max(5).default(1),
  practiceAttempts: z.number().int().min(0).max(50).default(3),
  shuffleQuestions: z.boolean().default(true),
  shuffleOptions: z.boolean().default(true),
  revealAnswers: z.enum(["immediately", "after_close", "never"]).default("immediately"),
  startAt: z.number().int().nullable().default(null),
  endAt: z.number().int().nullable().default(null),
  departments: z.array(z.enum(["Science", "Commerce", "Humanities"])).min(1).max(3),
  status: z.enum(["draft", "published", "closed"]),
});

export const saveQuiz = onCall({ region: REGION }, async (request) => {
  const { uid } = requireAdmin(request);
  const parsed = Quiz.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Check the quiz settings (title, duration, questions, departments).");
  const { id, startAt, endAt, ...q } = parsed.data;
  if (q.type === "weekly" && (startAt === null || endAt === null || endAt <= startAt)) {
    throw new HttpsError("invalid-argument", "A weekly quiz needs a start time and a later end time.");
  }
  if (q.questionCount > q.questionIds.length) throw new HttpsError("invalid-argument", "'Questions per attempt' is larger than the number of selected questions.");

  if (q.status === "published") {
    const snaps = await db.getAll(...q.questionIds.map((qid) => db.doc(`questions/${qid}`)));
    const bad = snaps.filter((s) => !s.exists || s.data()?.status !== "published").length;
    if (bad > 0) throw new HttpsError("failed-precondition", `${bad} selected question(s) aren't published. Publish or remove them first.`);
  }

  const now = Timestamp.now();
  const ref = id ? db.doc(`quizzes/${id}`) : db.collection("quizzes").doc();
  const before = id ? await ref.get() : null;
  const startChanged = !before?.exists || before.get("startAt")?.toMillis() !== startAt || before.get("endAt")?.toMillis() !== endAt;
  await ref.set({
    ...q, startAt: startAt === null ? null : Timestamp.fromMillis(startAt), endAt: endAt === null ? null : Timestamp.fromMillis(endAt),
    updatedAt: now, ...(id ? {} : { createdBy: uid, createdAt: now }),
    // A rescheduled quiz gets its reminders again.
    ...(startChanged ? { reminderDaySent: false, reminder15Sent: false, closedNotified: false } : {}),
  }, { merge: true });
  await audit(uid, id ? "quiz_updated" : "quiz_created", ref.id, { status: q.status });
  if (q.status === "published" && before?.get("status") !== "published") {
    await notifyUsers(await audienceUids({ scope: "department", departments: q.departments }), {
      type: "quiz", title: q.type === "weekly" ? "New weekly model quiz" : "New quiz available", body: q.title, link: `/quiz/${ref.id}`,
    });
  }
  return { id: ref.id };
});

export const deleteQuiz = onCall({ region: REGION }, async (request) => {
  const { uid } = requireAdmin(request);
  const id = z.string().min(1).max(40).parse(request.data?.id);
  await db.doc(`quizzes/${id}`).delete();
  await audit(uid, "quiz_deleted", id);
  return { ok: true };
});

/** Bulk status changes for the review queue (approve / reject / publish). */
export const setQuestionsStatus = onCall({ region: REGION }, async (request) => {
  const { uid } = requireAdmin(request);
  const parsed = z.object({ ids: z.array(z.string().min(1).max(40)).min(1).max(100), status: z.enum(["draft", "approved", "published", "rejected"]) }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { ids, status } = parsed.data;
  const snaps = await db.getAll(...ids.map((id) => db.doc(`questions/${id}`)));
  const batch = db.batch();
  let updated = 0, skipped = 0;
  for (const s of snaps) {
    try {
      if (!s.exists) throw new Error("missing");
      assertCanPublish(s.data(), status);
      batch.update(s.ref, { status, updatedAt: Timestamp.now() });
      updated++;
    } catch { skipped++; }
  }
  await batch.commit();
  await audit(uid, `questions_${status}`, "questions", { updated, skipped });
  return { updated, skipped };
});
