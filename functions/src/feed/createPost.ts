import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { db, REGION } from "../lib/admin";
import { rateLimit } from "../lib/rateLimit";
import { audienceUids, notifyUsers } from "../lib/notify";

const Media = z.object({
  path: z.string().max(300),
  url: z.string().url().max(800).startsWith("https://"),
  type: z.enum(["image", "video"]),
});

const Input = z.object({
  text: z.string().trim().max(2000).default(""),
  link: z.string().trim().url().max(500).startsWith("https://").optional(),
  media: z.array(Media).max(4).default([]),
  kind: z.enum(["post", "announcement"]).default("post"),
  pinned: z.boolean().default(false),
});

/** Students need an active trial/subscription; staff can post announcements and pin. */
async function assertPremium(uid: string, role?: string) {
  if (role && ["moderator", "admin", "superadmin"].includes(role)) return;
  const sub = (await db.doc(`subscriptions/${uid}`).get()).data();
  const ok = sub && ["trial", "active"].includes(sub.status) && sub.endsAt && sub.endsAt.toMillis() > Date.now();
  if (!ok) throw new HttpsError("permission-denied", "An active trial or subscription is required.");
}

export const createPost = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const role = request.auth?.token.role as string | undefined;
  const isStaff = !!role && ["moderator", "admin", "superadmin"].includes(role);

  const parsed = Input.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Check your post and try again.");
  const { text, link, media, kind, pinned } = parsed.data;

  if (!text && media.length === 0 && !link) throw new HttpsError("invalid-argument", "Write something or add a photo.");
  if ((kind === "announcement" || pinned) && !isStaff) {
    throw new HttpsError("permission-denied", "Only staff can post announcements.");
  }
  // Uploaded files must live in the caller's own folder.
  if (media.some((m) => !m.path.startsWith(`feedMedia/${uid}/`))) {
    throw new HttpsError("invalid-argument", "Invalid media.");
  }

  await assertPremium(uid, role);
  await rateLimit(`post_${uid}`, isStaff ? 60 : 10, 3600);

  const profile = (await db.doc(`publicProfiles/${uid}`).get()).data();
  const ref = db.collection("posts").doc();
  await ref.set({
    authorId: uid,
    authorName: profile?.displayName ?? "Student",
    authorPhoto: profile?.photoURL ?? null,
    authorRole: isStaff ? "staff" : "student",
    text,
    link: link ?? null,
    media,
    kind,
    pinned,
    status: "active",
    likeCount: 0,
    commentCount: 0,
    reportCount: 0,
    createdAt: Timestamp.now(),
  });
  if (kind === "announcement") {
    await notifyUsers(await audienceUids({ scope: "all" }), { type: "announcement", title: "New announcement", body: text.slice(0, 120) || "Tap to read", link: "/feed" });
  }
  return { id: ref.id };
});
