import { onDocumentCreated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { getStorage } from "firebase-admin/storage";
import { FieldValue } from "firebase-admin/firestore";
import { db, REGION } from "../lib/admin";
import { notifyUsers } from "../lib/notify";

const inc = (postId: string, field: "likeCount" | "commentCount", n: number) =>
  db.doc(`posts/${postId}`).update({ [field]: FieldValue.increment(n) }).catch(() => undefined);

export const onReactionCreated = onDocumentCreated({ document: "posts/{postId}/reactions/{uid}", region: REGION },
  (e) => inc(e.params.postId, "likeCount", 1));
export const onReactionDeleted = onDocumentDeleted({ document: "posts/{postId}/reactions/{uid}", region: REGION },
  (e) => inc(e.params.postId, "likeCount", -1));
export const onCommentCreated = onDocumentCreated({ document: "posts/{postId}/comments/{id}", region: REGION }, async (e) => {
  await inc(e.params.postId, "commentCount", 1);
  const c = e.data?.data();
  const post = (await db.doc(`posts/${e.params.postId}`).get()).data();
  if (!c || !post || post.authorId === c.authorId) return; // don't notify people about their own comments
  await notifyUsers([post.authorId], { type: "comment", title: `${c.authorName} commented on your post`, body: String(c.text).slice(0, 100), link: "/feed" });
});
export const onCommentDeleted = onDocumentDeleted({ document: "posts/{postId}/comments/{id}", region: REGION },
  (e) => inc(e.params.postId, "commentCount", -1));

/** When a post is deleted, remove its uploaded files and subcollections. */
export const onPostDeleted = onDocumentDeleted({ document: "posts/{postId}", region: REGION }, async (e) => {
  const media = (e.data?.data()?.media ?? []) as { path: string }[];
  const bucket = getStorage().bucket();
  await Promise.all(media.map((m) => bucket.file(m.path).delete().catch(() => undefined)));
  await db.recursiveDelete(db.doc(`posts/${e.params.postId}`));
});
