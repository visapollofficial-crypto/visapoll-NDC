import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/config";

export interface ChatMsg { role: "user" | "assistant"; content: string }
const opts = { timeout: 120_000 };

export const studyChat = (messages: ChatMsg[], materialId?: string) =>
  httpsCallable<{ messages: ChatMsg[]; materialId?: string }, { reply: string }>(functions, "studyChat", opts)({ messages, materialId }).then((r) => r.data.reply);

export type HwMode = "hint" | "steps" | "example";
export const homeworkHelp = (d: { question: string; mode: HwMode; materialId?: string; imagePath?: string }) =>
  httpsCallable<typeof d, { id: string; answer: string }>(functions, "homeworkHelp", opts)(d).then((r) => r.data);
