import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { db, REGION } from "../lib/admin";
import { rateLimit } from "../lib/rateLimit";

const AUTO_HIDE_AT = 5; // distinct reports before a post is hidden pending staff review
const Input = z.object({
  postId: z.string().min(1).max(60),
  reason: z.enum(["spam", "abuse", "inappropriate", "cheating", "other"]),
  note: z.string().trim().max(300).optional(),
});

export const reportPost = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = Input.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid report.");
  const { postId, reason, note } = parsed.data;

  await rateLimit(`report_${uid}`, 20, 3600);

  const postRef = db.doc(`posts/${postId}`);
  const reportRef = db.doc(`reports/post_${postId}_${uid}`); // one report per user per post

  await db.runTransaction(async (tx) => {
    const [post, existing] = await Promise.all([tx.get(postRef), tx.get(reportRef)]);
    if (!post.exists) throw new HttpsError("not-found", "This post no longer exists.");
    if (existing.exists) return; // already reported; stay idempotent
    tx.set(reportRef, {
      type: "post", targetId: postId, reporterId: uid, reason, note: note ?? null,
      status: "open", createdAt: Timestamp.now(),
    });
    const count = (post.data()?.reportCount ?? 0) + 1;
    tx.update(postRef, {
      reportCount: FieldValue.increment(1),
      ...(count >= AUTO_HIDE_AT && post.data()?.kind !== "announcement" ? { status: "hidden" } : {}),
    });
  });
  return { ok: true };
});
