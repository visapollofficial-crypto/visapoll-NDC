import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getStorage } from "firebase-admin/storage";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { db, REGION } from "../lib/admin";
import { materialText } from "../lib/materialText";
import { assertPremium } from "../lib/premium";
import { rateLimit } from "../lib/rateLimit";
import { ALL_AI_SECRETS, getProvider } from "./registry";
import type { ImageInput } from "./types";

const opts = { region: REGION, secrets: ALL_AI_SECRETS, timeoutSeconds: 120, memory: "512MiB" as const };
const UNAVAILABLE = "The AI helper is busy or unavailable right now. Please try again in a minute.";

async function myDepartment(uid: string): Promise<string> {
  const u = (await db.doc(`users/${uid}`).get()).data();
  if (!u) throw new HttpsError("failed-precondition", "Finish registration first.");
  return u.department;
}

/** Published materials the student is allowed to see. */
async function studentMaterials(dept: string, ids?: string[]): Promise<FirebaseFirestore.DocumentData[]> {
  if (ids?.length) {
    const snaps = await db.getAll(...ids.map((i) => db.doc(`classMaterials/${i}`)));
    return snaps.map((s) => s.data()).filter((m): m is FirebaseFirestore.DocumentData => !!m && m.status === "published" && (m.departments as string[]).includes(dept));
  }
  const s = await db.collection("classMaterials").where("status", "==", "published").where("departments", "array-contains", dept).orderBy("classDate", "desc").limit(3).get();
  return s.docs.map((d) => d.data());
}

async function weakTopics(uid: string): Promise<string> {
  const rs = await db.collection("quizResults").where("uid", "==", uid).orderBy("submittedAt", "desc").limit(20).get();
  const agg: Record<string, { c: number; t: number }> = {};
  rs.docs.forEach((d) => Object.entries(d.get("topics") as Record<string, { correct: number; total: number }>).forEach(([k, v]) => { agg[k] = agg[k] ?? { c: 0, t: 0 }; agg[k].c += v.correct; agg[k].t += v.total; }));
  const weak = Object.entries(agg).filter(([, v]) => v.t >= 3).map(([k, v]) => ({ k, p: Math.round((v.c / v.t) * 100) })).sort((a, b) => a.p - b.p).slice(0, 5).filter((x) => x.p < 70);
  return weak.length ? `The student's weaker quiz topics (accuracy): ${weak.map((w) => `${w.k} ${w.p}%`).join(", ")}.` : "";
}

const Msg = z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) });

/** AI study assistant: answers from the student's own class material + quiz weak spots. Nothing is stored. */
export const studyChat = onCall(opts, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = z.object({ messages: z.array(Msg).min(1).max(12), materialId: z.string().max(40).optional() }).safeParse(request.data);
  if (!parsed.success || parsed.data.messages[parsed.data.messages.length - 1].role !== "user") throw new HttpsError("invalid-argument", "Type a question first.");
  await assertPremium(uid);
  await rateLimit(`studyh_${uid}`, 40, 3600);
  await rateLimit(`studyd_${uid}`, 150, 86400);

  const dept = await myDepartment(uid);
  const mats = await studentMaterials(dept, parsed.data.materialId ? [parsed.data.materialId] : undefined);
  const context = [...mats.map((m) => materialText(m, 5000)), await weakTopics(uid)].filter(Boolean).join("\n\n---\n\n") || "(No class material is available yet.)";
  try {
    const reply = await (await getProvider("chat", uid)).chat({ messages: parsed.data.messages, context });
    return { reply: reply.trim() };
  } catch (e) { console.error("studyChat failed:", (e as Error).message); throw new HttpsError("unavailable", UNAVAILABLE); }
});

const ALLOWED_IMG = ["image/jpeg", "image/png", "image/webp"];

/** Homework help: hint / step-by-step / similar example, optionally from a photo. The photo is deleted right after use. */
export const homeworkHelp = onCall(opts, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = z.object({
    question: z.string().trim().max(2000).default(""),
    mode: z.enum(["hint", "steps", "example"]),
    materialId: z.string().max(40).optional(),
    imagePath: z.string().max(300).optional(),
  }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Check your question and try again.");
  const { question, mode, materialId, imagePath } = parsed.data;
  if (!question && !imagePath) throw new HttpsError("invalid-argument", "Type your question or add a photo of it.");
  await assertPremium(uid);
  await rateLimit(`hwh_${uid}`, 20, 3600);
  await rateLimit(`hwd_${uid}`, 60, 86400);

  let images: ImageInput[] | undefined;
  const file = imagePath && imagePath.startsWith(`homework/${uid}/`) ? getStorage().bucket().file(imagePath) : null;
  if (imagePath && !file) throw new HttpsError("invalid-argument", "Invalid photo.");
  if (file) {
    const [meta] = await file.getMetadata().catch(() => { throw new HttpsError("invalid-argument", "The photo didn't upload. Try again."); });
    if (!ALLOWED_IMG.includes(String(meta.contentType)) || Number(meta.size) > 4 * 1024 * 1024) throw new HttpsError("invalid-argument", "Use a JPG, PNG or WebP photo under 4 MB.");
    images = [{ mime: String(meta.contentType), data: (await file.download())[0].toString("base64") }];
  }

  const dept = await myDepartment(uid);
  const mats = materialId ? await studentMaterials(dept, [materialId]) : [];
  const context = mats.map((m) => materialText(m, 6000)).join("\n\n") || undefined;

  try {
    const answer = (await (await getProvider("homework", uid)).answerHomework({ question, mode, context, images })).trim();
    const ref = await db.collection("homeworkHistory").add({ uid, question, mode, answer, hadImage: !!images, createdAt: Timestamp.now() });
    return { id: ref.id, answer };
  } catch (e) {
    console.error("homeworkHelp failed:", (e as Error).message);
    throw new HttpsError("unavailable", images ? "The AI couldn't read the photo or is busy. Try typing the question, or try again in a minute." : UNAVAILABLE);
  } finally {
    if (file) await file.delete().catch(() => undefined); // photos are not kept
  }
});
