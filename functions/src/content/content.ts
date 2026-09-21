import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getStorage } from "firebase-admin/storage";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { db, REGION } from "../lib/admin";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/guard";
import { audienceUids, notifyUsers } from "../lib/notify";

const line = z.string().trim().min(1).max(300);
const Material = z.object({
  id: z.string().max(40).optional(),
  subjectId: z.string().min(1).max(60),
  subjectName: z.string().min(1).max(60),
  chapter: z.string().trim().min(1).max(120),
  topic: z.string().trim().max(120).default(""),
  classDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  teacher: z.string().trim().max(80).default(""),
  summary: z.string().trim().max(5000).default(""),
  keyPoints: z.array(line).max(40).default([]),
  formulas: z.array(line).max(40).default([]),
  definitions: z.array(z.object({ term: z.string().trim().min(1).max(100), meaning: z.string().trim().min(1).max(500) })).max(40).default([]),
  examples: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
  homework: z.string().trim().max(3000).default(""),
  links: z.array(z.object({ title: z.string().trim().max(100), url: z.string().url().startsWith("https://").max(500) })).max(20).default([]),
  attachments: z.array(z.object({
    name: z.string().max(120), path: z.string().startsWith("classMaterials/").max(300),
    url: z.string().url().startsWith("https://").max(800), type: z.enum(["pdf", "image", "video"]),
  })).max(15).default([]),
  departments: z.array(z.enum(["Science", "Commerce", "Humanities"])).min(1).max(3),
  status: z.enum(["draft", "published"]),
});

export const saveMaterial = onCall({ region: REGION }, async (request) => {
  const { uid } = requireAdmin(request);
  const parsed = Material.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Check the required fields (subject, chapter, date, department).");
  const { id, ...data } = parsed.data;
  const now = Timestamp.now();
  const announce = async (matId: string) => {
    const label = `${data.subjectName}: ${data.chapter}${data.topic ? ` (${data.topic})` : ""}`;
    await notifyUsers(await audienceUids({ scope: "department", departments: data.departments }), { type: "material", title: "New class material", body: label, link: `/learn/${matId}` });
  };
  if (id) {
    const ref = db.doc(`classMaterials/${id}`);
    const before = await ref.get();
    if (!before.exists) throw new HttpsError("not-found", "Material not found.");
    await ref.update({ ...data, updatedAt: now });
    await audit(uid, "material_updated", id, { status: data.status });
    if (data.status === "published" && before.get("status") !== "published") await announce(id); // only when it first goes live
    return { id };
  }
  const ref = db.collection("classMaterials").doc();
  await ref.set({ ...data, createdBy: uid, createdAt: now, updatedAt: now });
  await audit(uid, "material_created", ref.id, { status: data.status });
  if (data.status === "published") await announce(ref.id);
  return { id: ref.id };
});

export const deleteMaterial = onCall({ region: REGION }, async (request) => {
  const { uid } = requireAdmin(request);
  const id = z.string().min(1).max(40).parse(request.data?.id);
  const ref = db.doc(`classMaterials/${id}`);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true };
  const files = (snap.data()?.attachments ?? []) as { path: string }[];
  await Promise.all(files.map((f) => getStorage().bucket().file(f.path).delete().catch(() => undefined)));
  await ref.delete();
  await audit(uid, "material_deleted", id);
  return { ok: true };
});

export const saveSubject = onCall({ region: REGION }, async (request) => {
  const { uid } = requireAdmin(request);
  const parsed = z.object({ id: z.string().max(40).optional(), name: z.string().trim().min(2).max(60), active: z.boolean().default(true) }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Enter a subject name (2 to 60 characters).");
  const { id, ...data } = parsed.data;
  const ref = id ? db.doc(`subjects/${id}`) : db.collection("subjects").doc();
  await ref.set(data, { merge: true });
  await audit(uid, id ? "subject_updated" : "subject_created", ref.id, { name: data.name });
  return { id: ref.id };
});

export const deleteSubject = onCall({ region: REGION }, async (request) => {
  const { uid } = requireAdmin(request);
  const id = z.string().min(1).max(40).parse(request.data?.id);
  const used = await db.collection("classMaterials").where("subjectId", "==", id).limit(1).get();
  if (!used.empty) throw new HttpsError("failed-precondition", "This subject has materials. Deactivate it instead.");
  await db.doc(`subjects/${id}`).delete();
  await audit(uid, "subject_deleted", id);
  return { ok: true };
});
