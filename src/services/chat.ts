import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/config";

export interface ChatSummary {
  id: string; type: "dm" | "group"; name: string; photoURL: string | null; otherUid: string | null; blocked: boolean;
  lastMessage: string; lastSenderId: string | null; lastMessageAt: number;
}
export interface Found { uid: string; name: string; department: string; session: string; photoURL: string | null }
const call = <I, O>(n: string) => (d: I) => httpsCallable<I, O>(functions, n)(d).then((r) => r.data);

export const listMyChats = () => httpsCallable<void, { chats: ChatSummary[]; restricted: boolean }>(functions, "listMyChats")().then((r) => r.data);
export const searchStudents = call<{ q: string }, Found[]>("searchStudents");
export const startDirectChat = call<{ uid: string }, { chatId: string }>("startDirectChat");
export const sendMessage = call<{ chatId: string; text: string }, { id: string }>("sendMessage");
export const deleteMessage = call<{ chatId: string; messageId: string }, { ok: boolean }>("deleteMessage");
export const reportMessage = call<{ chatId: string; messageId: string; reason: string }, { ok: boolean }>("reportMessage");

export const seenKey = (chatId: string) => `chatSeen:${chatId}`;
export const markSeen = (chatId: string) => localStorage.setItem(seenKey(chatId), String(Date.now()));
export const isUnread = (c: ChatSummary, me: string) => !!c.lastMessageAt && c.lastSenderId !== me && c.lastMessageAt > Number(localStorage.getItem(seenKey(c.id)) ?? 0);
