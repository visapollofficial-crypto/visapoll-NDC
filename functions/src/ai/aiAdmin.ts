import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { db, REGION } from "../lib/admin";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/guard";
import { rateLimit } from "../lib/rateLimit";
import { materialText } from "../lib/materialText";
import { PROMPT_VERSION } from "./base";
import { ALL_AI_SECRETS, buildProvider, getProvider, keyStatus, loadAiConfig } from "./registry";
import { AI_TASKS, AIError, type QType, type RawQuestion } from "./types";

const opts = { region: REGION, secrets: ALL_AI_SECRETS };

const RouteSchema = z.object({
  provider: z.enum(["gemini", "openai"]),
  model: z.string().trim().min(2).max(80).regex(/^[\w.\-:]+$/),
  temperature: z.number().min(0).max(1.5),
});

export const adminGetAiConfig = onCall(opts, async (request) => {
  requireAdmin(request);
  return { config: await loadAiConfig(), keys: keyStatus(), tasks: AI_TASKS };
});

export const adminSaveAiConfig = onCall(opts, async (request) => {
  const { uid } = requireAdmin(request);
  const parsed = z.object({ default: RouteSchema, tasks: z.record(z.enum(AI_TASKS as [string, ...string[]]), RouteSchema) }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Check the provider, model name and temperature.");
  await db.doc("settings/aiRouting").set(parsed.data);
  await audit(uid, "ai_config_changed", "settings/aiRouting", { default: parsed.data.default });
  return { ok: true };
});

/** Lets an admin confirm a key + model actually work before relying on them. */
export const adminTestAi = onCall(opts, async (request) => {
  const { uid } = requireAdmin(request);
  const parsed = RouteSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid provider or model.");
  await rateLimit(`aitest_${uid}`, 20, 3600);
  const t0 = Date.now();
  try {
    const p = buildProvider(parsed.data, "summarization", uid);
    const reply = await p.chat({ messages: [{ role: "user", content: "Reply with the single word OK." }], context: "test" });
    return { ok: true, latencyMs: Date.now() - t0, reply: reply.slice(0, 60) };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error("AI test failed", (e as Error).message);
    throw new HttpsError("unavailable", "The provider rejected the request. Check the API key and that the model name exists on your account.");
  }
});

// ---------------- AI quiz generation → review queue ----------------

const Input = z.object({
  materialIds: z.array(z.string().min(1).max(40)).min(1).max(5),
  count: z.number().int().min(1).max(30),
  mix: z.object({ hard: z.number().min(0).max(100), medium: z.number().min(0).max(100), easy: z.number().min(0).max(100) }),
  types: z.array(z.enum(["conceptual", "calculation", "application", "important"])).min(1),
});

const Question = z.object({
  source: z.number().int().min(0).catch(0),
  stem: z.string().trim().min(10).max(1000),
  options: z.array(z.string().trim().min(1).max(300)).length(4),
  correct: z.enum(["a", "b", "c", "d"]),
  explanation: z.string().trim().min(5).max(1500),
  difficulty: z.enum(["easy", "medium", "hard"]),
  type: z.enum(["conceptual", "calculation", "application", "important"]).catch("conceptual"),
  topic: z.string().trim().max(120).catch(""),
});

/** Cleans common model quirks before strict validation. */
function normalize(q: RawQuestion): unknown {
  const c = typeof q.correct === "number" ? "abcd"[q.correct] : String(q.correct ?? "").trim().toLowerCase().charAt(0);
  const options = Array.isArray(q.options) ? q.options.map((o) => String(o).replace(/^\s*[A-Da-d][).:\-]\s+/, "").trim()) : q.options;
  return { ...q, correct: c, options, difficulty: String(q.difficulty ?? "").toLowerCase(), type: String(q.type ?? "").toLowerCase() };
}

export const generateQuestions = onCall({ ...opts, timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
  const { uid } = requireAdmin(request);
  const parsed = Input.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Choose 1 to 5 materials, 1 to 30 questions, and at least one question type.");
  const { materialIds, count, mix, types } = parsed.data;
  if (Math.round(mix.hard + mix.medium + mix.easy) !== 100) throw new HttpsError("invalid-argument", "The difficulty mix must add up to 100%.");
  await rateLimit(`aigen_${uid}`, 20, 3600);

  const snaps = await db.getAll(...materialIds.map((id) => db.doc(`classMaterials/${id}`)));
  const mats = snaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data()! }));
  if (mats.length !== materialIds.length) throw new HttpsError("not-found", "One of the selected materials no longer exists.");
  const subjectIds = new Set(mats.map((m) => (m as unknown as { subjectId: string }).subjectId));
  if (subjectIds.size > 1) throw new HttpsError("invalid-argument", "Select materials from a single subject at a time.");
  const first = mats[0] as unknown as { subjectId: string; subjectName: string };
  const withText = mats.map((m) => materialText(m));
  if (withText.every((t) => t.trim().length < 80)) throw new HttpsError("failed-precondition", "These materials have too little text to generate questions from. Add a summary and important points first.");

  const hard = Math.round((count * mix.hard) / 100), medium = Math.round((count * mix.medium) / 100);
  const counts = { hard, medium, easy: Math.max(0, count - hard - medium) };

  const provider = await getProvider("quizGeneration", uid);
  const cfg = await loadAiConfig();
  const used = cfg.tasks.quizGeneration ?? cfg.default;

  const input = {
    subjectName: first.subjectName,
    materials: mats.map((m, i) => {
      const mm = m as unknown as { chapter: string; topic: string; classDate: string };
      return { chapter: mm.chapter, topic: mm.topic, date: mm.classDate, text: withText[i] };
    }),
    counts, types: types as QType[],
  };

  let raw;
  try {
    try { raw = await provider.generateQuiz(input); }
    catch (e) { if (e instanceof AIError && e.kind === "bad_json") raw = await provider.generateQuiz(input); else throw e; } // one retry on malformed JSON
  } catch (e) {
    console.error("generateQuestions failed:", (e as Error).message);
    throw new HttpsError("unavailable", "The AI service couldn't produce questions right now. Try again in a few minutes, or fewer questions at once.");
  }

  // ---- validate everything the model returned; nothing is trusted ----
  const reasons: string[] = [];
  const seen = new Set<string>();
  const good: { q: z.infer<typeof Question>; mat: (typeof mats)[number] }[] = [];
  const list = Array.isArray(raw?.questions) ? raw.questions : [];
  list.forEach((r, i) => {
    const p = Question.safeParse(normalize(r));
    if (!p.success) return void reasons.push(`Question ${i + 1}: incomplete or malformed`);
    const q = p.data;
    if (new Set(q.options.map((o) => o.toLowerCase())).size !== 4) return void reasons.push(`Question ${i + 1}: duplicate options`);
    const key = q.stem.toLowerCase().replace(/\W+/g, " ");
    if (seen.has(key)) return void reasons.push(`Question ${i + 1}: duplicate question`);
    seen.add(key);
    good.push({ q, mat: mats[Math.min(q.source, mats.length - 1)] });
  });
  if (good.length === 0) throw new HttpsError("failed-precondition", "The AI's answer couldn't be used. Try again or reduce the number of questions.");

  // ---- save as AI-generated drafts; NOTHING is published automatically ----
  const now = Timestamp.now();
  const ids: string[] = [];
  const batch = db.batch();
  for (const { q, mat } of good.slice(0, count)) {
    const m = mat as unknown as { chapter: string; topic: string; classDate: string };
    const ref = db.collection("questions").doc();
    ids.push(ref.id);
    batch.set(ref, {
      subjectId: first.subjectId, subjectName: first.subjectName, chapter: m.chapter, topic: q.topic || m.topic || "",
      difficulty: q.difficulty, type: types.includes(q.type) ? q.type : types[0], sourceDate: m.classDate, sourceMaterialId: mat.id,
      stem: q.stem, options: q.options.map((text, i) => ({ id: "abcd"[i], text })),
      status: "ai_generated", aiGenerated: true, ai: { provider: used.provider, model: used.model, promptVersion: PROMPT_VERSION },
      createdBy: uid, createdAt: now, updatedAt: now,
    });
    batch.set(db.doc(`questionKeys/${ref.id}`), { correct: q.correct, explanation: q.explanation });
  }
  await batch.commit();

  const actual = { hard: 0, medium: 0, easy: 0 };
  good.slice(0, count).forEach(({ q }) => actual[q.difficulty]++);
  await audit(uid, "ai_questions_generated", first.subjectId, { requested: count, created: ids.length, materials: materialIds, provider: used.provider, model: used.model });
  return { created: ids.length, requested: count, rejected: reasons.length, reasons: reasons.slice(0, 5), actual };
});
