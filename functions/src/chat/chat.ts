import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { z } from "zod";
import { db, REGION } from "../lib/admin";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/guard";
import { notifyUsers } from "../lib/notify";
import { assertPremium } from "../lib/premium";
import { rateLimit } from "../lib/rateLimit";

interface ChatDoc {
  type: "dm" | "group"; members?: string[]; name?: string; department?: string; sectionKey?: string | null; sectionLabel?: string | null;
  lastMessage?: string; lastSenderId?: string; lastMessageAt?: Timestamp | null; notifiedAt?: Record<string, number>;
}
interface Person { department: string; section: string; fullName: string; chatRestricted?: boolean }

const dmId = (a: string, b: string) => `dm_${[a, b].sort().join("_")}`;
const secKey = (s: string) => s.trim().toLowerCase();

/** Same access logic as the Firestore rules for reading messages. */
function canAccess(c: ChatDoc, uid: string, u: Person): boolean {
  if (c.type === "dm") return !!c.members?.includes(uid);
  return (c.department === "All" || c.department === u.department) && (!c.sectionKey || c.sectionKey === secKey(u.section));
}

async function person(uid: string): Promise<Person> {
  const u = (await db.doc(`users/${uid}`).get()).data();
  if (!u) throw new HttpsError("failed-precondition", "Finish registration first.");
  return u as Person;
}
async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([db.doc(`blocks/${a}/list/${b}`).get(), db.doc(`blocks/${b}/list/${a}`).get()]);
  return x.exists || y.exists;
}
const CANT = "You can't message this person.";

export const searchStudents = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  await assertPremium(uid);
  const q = z.string().trim().toLowerCase().min(2).max(30).safeParse(request.data?.q);
  if (!q.success) throw new HttpsError("invalid-argument", "Type at least 2 letters.");
  await rateLimit(`chsearch_${uid}`, 60, 3600);
  const s = await db.collection("publicProfiles").orderBy("nameLower").startAt(q.data).endAt(q.data + "\uf8ff").limit(11).get();
  return s.docs.filter((d) => d.id !== uid).slice(0, 10).map((d) => ({ uid: d.id, name: d.get("displayName"), department: d.get("department"), session: d.get("session"), photoURL: d.get("photoURL") ?? null }));
});

export const startDirectChat = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  await assertPremium(uid);
  const other = z.string().min(1).max(40).safeParse(request.data?.uid);
  if (!other.success || other.data === uid) throw new HttpsError("invalid-argument", "Choose another student.");
  const me = await person(uid);
  if (me.chatRestricted) throw new HttpsError("permission-denied", "Your messaging has been restricted by an admin.");
  const them = (await db.doc(`users/${other.data}`).get()).data();
  if (!them || them.suspended) throw new HttpsError("not-found", CANT);
  if (await isBlockedEitherWay(uid, other.data)) throw new HttpsError("permission-denied", CANT);
  await rateLimit(`chstart_${uid}`, 30, 3600);
  const id = dmId(uid, other.data);
  const ref = db.doc(`chats/${id}`);
  if (!(await ref.get()).exists) await ref.set({ type: "dm", members: [uid, other.data], createdAt: Timestamp.now(), lastMessageAt: null });
  return { chatId: id };
});

/** The student's chat list: their one-to-one chats and the class groups they belong to. */
export const listMyChats = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  await assertPremium(uid);
  const me = await person(uid);
  const [dms, groups, blocks] = await Promise.all([
    db.collection("chats").where("members", "array-contains", uid).get(),
    db.collection("chats").where("type", "==", "group").get(),
    db.collection(`blocks/${uid}/list`).get(),
  ]);
  const blocked = new Set(blocks.docs.map((d) => d.id));
  const otherIds = dms.docs.map((d) => (d.get("members") as string[]).find((m) => m !== uid)!).filter(Boolean);
  const profiles = otherIds.length ? await db.getAll(...otherIds.map((o) => db.doc(`publicProfiles/${o}`))) : [];
  const pmap = new Map(profiles.map((p) => [p.id, p.data()]));

  const shape = (id: string, c: ChatDoc) => ({ id, type: c.type, lastMessage: c.lastMessage ?? "", lastSenderId: c.lastSenderId ?? null, lastMessageAt: c.lastMessageAt?.toMillis() ?? 0 });
  const out = [
    ...dms.docs.map((d) => {
      const c = d.data() as ChatDoc;
      const o = c.members!.find((m) => m !== uid)!;
      return { ...shape(d.id, c), otherUid: o, name: (pmap.get(o)?.displayName as string) ?? "Student", photoURL: (pmap.get(o)?.photoURL as string) ?? null, blocked: blocked.has(o) };
    }),
    ...groups.docs.filter((d) => canAccess(d.data() as ChatDoc, uid, me)).map((d) => {
      const c = d.data() as ChatDoc;
      return { ...shape(d.id, c), name: c.name ?? "Class chat", otherUid: null, photoURL: null, blocked: false };
    }),
  ];
  return { chats: out.sort((a, b) => b.lastMessageAt - a.lastMessageAt), restricted: !!me.chatRestricted };
});

export const sendMessage = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = z.object({ chatId: z.string().min(1).max(120), text: z.string().trim().min(1).max(1000) }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Write a message (up to 1000 characters).");
  await assertPremium(uid);
  await rateLimit(`msg_${uid}`, 25, 60);

  const me = await person(uid);
  if (me.chatRestricted) throw new HttpsError("permission-denied", "Your messaging has been restricted by an admin.");
  const chatRef = db.doc(`chats/${parsed.data.chatId}`);
  const chat = (await chatRef.get()).data() as ChatDoc | undefined;
  if (!chat || !canAccess(chat, uid, me)) throw new HttpsError("not-found", "This chat isn't available.");

  const other = chat.type === "dm" ? chat.members!.find((m) => m !== uid)! : null;
  if (other && (await isBlockedEitherWay(uid, other))) throw new HttpsError("permission-denied", CANT);

  const now = Timestamp.now();
  const msgRef = chatRef.collection("messages").doc();
  const batch = db.batch();
  batch.set(msgRef, { senderId: uid, senderName: me.fullName, text: parsed.data.text, createdAt: now });
  batch.update(chatRef, { lastMessage: parsed.data.text.slice(0, 80), lastSenderId: uid, lastMessageAt: now });
  await batch.commit();

  // One-to-one messages notify the other person, at most once every 2 minutes per chat.
  if (other) {
    const last = chat.notifiedAt?.[other] ?? 0;
    if (Date.now() - last > 120_000) {
      await chatRef.update({ [`notifiedAt.${other}`]: Date.now() });
      await notifyUsers([other], { type: "comment", title: me.fullName, body: parsed.data.text.slice(0, 80), link: `/chat/${parsed.data.chatId}` });
    }
  }
  return { id: msgRef.id };
});

export const deleteMessage = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = z.object({ chatId: z.string().min(1).max(120), messageId: z.string().min(1).max(40) }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const ref = db.doc(`chats/${parsed.data.chatId}/messages/${parsed.data.messageId}`);
  const m = (await ref.get()).data();
  const role = request.auth?.token.role as string | undefined;
  const admin = role === "admin" || role === "superadmin";
  if (!m || (m.senderId !== uid && !admin)) throw new HttpsError("permission-denied", "You can only delete your own messages.");
  await ref.update({ deleted: true, text: "" });
  if (admin && m.senderId !== uid) await audit(uid, "message_deleted", parsed.data.messageId, { chatId: parsed.data.chatId });
  return { ok: true };
});

/** Keeps a copy of the message as evidence, so the report still works if the sender deletes it. */
export const reportMessage = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = z.object({
    chatId: z.string().min(1).max(120), messageId: z.string().min(1).max(40),
    reason: z.enum(["spam", "abuse", "inappropriate", "cheating", "other"]),
  }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid report.");
  await rateLimit(`report_${uid}`, 20, 3600);
  const me = await person(uid);
  const chat = (await db.doc(`chats/${parsed.data.chatId}`).get()).data() as ChatDoc | undefined;
  if (!chat || !canAccess(chat, uid, me)) throw new HttpsError("not-found", "This chat isn't available.");
  const m = (await db.doc(`chats/${parsed.data.chatId}/messages/${parsed.data.messageId}`).get()).data();
  if (!m || m.senderId === uid) throw new HttpsError("not-found", "Message not found.");
  await db.doc(`reports/msg_${parsed.data.messageId}_${uid}`).set({
    type: "message", targetId: parsed.data.messageId, chatId: parsed.data.chatId, messageId: parsed.data.messageId, senderId: m.senderId,
    senderName: m.senderName, snapshot: String(m.text).slice(0, 1000), reporterId: uid, reason: parsed.data.reason, status: "open", createdAt: Timestamp.now(),
  });
  return { ok: true };
});

// ------------------------- admin -------------------------

export const adminCreateGroupChat = onCall({ region: REGION }, async (request) => {
  const { uid } = requireAdmin(request);
  const parsed = z.object({ name: z.string().trim().min(2).max(60), department: z.enum(["All", "Science", "Commerce", "Humanities"]), section: z.string().trim().max(20).optional() }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Enter a group name and choose who can join.");
  const { name, department, section } = parsed.data;
  const ref = db.collection("chats").doc();
  await ref.set({ type: "group", name, department, sectionKey: section ? secKey(section) : null, sectionLabel: section || null, createdBy: uid, createdAt: Timestamp.now(), lastMessageAt: null });
  await audit(uid, "chat_group_created", ref.id, { name, department, section: section ?? null });
  return { id: ref.id };
});

export const adminDeleteChat = onCall({ region: REGION }, async (request) => {
  const { uid } = requireAdmin(request);
  const id = z.string().min(1).max(120).parse(request.data?.chatId);
  const c = (await db.doc(`chats/${id}`).get()).data();
  if (!c || c.type !== "group") throw new HttpsError("failed-precondition", "Only class groups can be deleted here.");
  await db.recursiveDelete(db.doc(`chats/${id}`));
  await audit(uid, "chat_group_deleted", id, { name: c.name });
  return { ok: true };
});

export const adminSetChatRestriction = onCall({ region: REGION }, async (request) => {
  const { uid: adminId } = requireAdmin(request);
  const parsed = z.object({ uid: z.string().min(1), restricted: z.boolean() }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  await db.doc(`users/${parsed.data.uid}`).update({ chatRestricted: parsed.data.restricted });
  await audit(adminId, parsed.data.restricted ? "chat_restricted" : "chat_unrestricted", parsed.data.uid);
  return { ok: true };
});

/** Handles a report on a post or a message. Closes every open report on the same item. */
export const adminResolveReport = onCall({ region: REGION }, async (request) => {
  const { uid: adminId } = requireAdmin(request);
  const parsed = z.object({ reportId: z.string().min(1).max(160), action: z.enum(["dismiss", "remove", "remove_and_restrict", "remove_and_suspend"]) }).safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { reportId, action } = parsed.data;
  const rep = (await db.doc(`reports/${reportId}`).get()).data();
  if (!rep || rep.status !== "open") throw new HttpsError("failed-precondition", "This report was already handled.");

  let offender: string | null = null;
  if (rep.type === "post") {
    const ref = db.doc(`posts/${rep.targetId}`);
    const post = (await ref.get()).data();
    offender = post?.authorId ?? null;
    if (post) {
      if (action === "dismiss") { if (post.status === "hidden") await ref.update({ status: "active", reportCount: 0 }); } // report was unfounded
      else await ref.delete(); // trigger removes its files and comments
    }
  } else if (rep.type === "message") {
    offender = rep.senderId;
    if (action !== "dismiss") await db.doc(`chats/${rep.chatId}/messages/${rep.messageId}`).update({ deleted: true, text: "" }).catch(() => undefined);
  }

  if (offender && action === "remove_and_restrict") await db.doc(`users/${offender}`).update({ chatRestricted: true }).catch(() => undefined);
  if (offender && action === "remove_and_suspend") {
    const t = await getAuth().getUser(offender).catch(() => null);
    if (t && !["admin", "superadmin"].includes(t.customClaims?.role)) {
      await getAuth().updateUser(offender, { disabled: true });
      await getAuth().revokeRefreshTokens(offender);
      await db.doc(`users/${offender}`).update({ suspended: true, suspendedReason: "Removed after a report" });
    }
  }

  const same = await db.collection("reports").where("targetId", "==", rep.targetId).where("status", "==", "open").get();
  const batch = db.batch();
  same.docs.forEach((d) => batch.update(d.ref, { status: action === "dismiss" ? "dismissed" : "actioned", action, resolvedBy: adminId, resolvedAt: Timestamp.now() }));
  await batch.commit();
  await audit(adminId, `report_${action}`, rep.targetId, { type: rep.type, offender });
  return { ok: true };
});

/** One-off: gives existing students a searchable name. New/edited profiles get it automatically. */
export const adminBackfillPublicProfiles = onCall({ region: REGION }, async (request) => {
  const { uid } = requireAdmin(request);
  const users = await db.collection("users").select("fullName", "department", "session", "photoURL", "scoreVisibility").get();
  for (let i = 0; i < users.docs.length; i += 400) {
    const b = db.batch();
    users.docs.slice(i, i + 400).forEach((d) => b.set(db.doc(`publicProfiles/${d.id}`), {
      displayName: d.get("fullName"), nameLower: String(d.get("fullName")).toLowerCase(), department: d.get("department"), session: d.get("session"),
      photoURL: d.get("photoURL") ?? null, scoreVisibility: d.get("scoreVisibility") ?? "private",
    }, { merge: true }));
    await b.commit();
  }
  await audit(uid, "public_profiles_backfilled", "publicProfiles", { count: users.size });
  return { updated: users.size };
});
