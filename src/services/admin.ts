import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/config";

const call = <I, O = { ok: boolean }>(name: string) => (data?: I) =>
  httpsCallable<I, O>(functions, name)(data as I).then((r) => r.data);

export interface SystemSettings {
  freeTrialEnabled: boolean;
  freeTrialDurationDays: number;
  oneTrialPerVerifiedStudent: boolean;
  requireStudentVerification: boolean;
  requireFaceVerification: boolean;
  subscriptionPriceBDT: number;
  paymentsEnabled: boolean;
  bkashNumber: string;
  nagadNumber: string;
}
export interface MaterialInput {
  id?: string;
  subjectId: string; subjectName: string; chapter: string; topic: string; classDate: string; teacher: string;
  summary: string; keyPoints: string[]; formulas: string[];
  definitions: { term: string; meaning: string }[]; examples: string[]; homework: string;
  links: { title: string; url: string }[];
  attachments: { name: string; path: string; url: string; type: "pdf" | "image" | "video" }[];
  departments: ("Science" | "Commerce" | "Humanities")[];
  status: "draft" | "published";
}

export const submitVerification = call<{ path: string; idConsent: true }>("submitVerification");
export const getVerificationImageUrl = call<{ uid: string }, { url: string }>("getVerificationImageUrl");
export const reviewVerification = call<{ uid: string; decision: "approve" | "reject" | "reupload"; note?: string }, { ok: boolean; trialStatus: string | null }>("reviewVerification");
export const adminTrialAction = call<{ uid: string; action: "grant" | "revoke" | "extend" | "block" | "unblock"; days?: number }>("adminTrialAction");
export const adminSetSuspension = call<{ uid: string; suspended: boolean; reason?: string }>("adminSetSuspension");
export const adminGetSettings = call<void, SystemSettings>("adminGetSettings");
export const adminSaveSettings = call<SystemSettings>("adminSaveSettings");
export const importRoster = call<{ rows: { studentId: string; fullName: string; department: string; session: string }[] }, { imported: number }>("importRoster");
export const saveMaterial = call<MaterialInput, { id: string }>("saveMaterial");
export const deleteMaterial = call<{ id: string }>("deleteMaterial");
export const saveSubject = call<{ id?: string; name: string; active: boolean }, { id: string }>("saveSubject");
export const deleteSubject = call<{ id: string }>("deleteSubject");

export type QStatus = "draft" | "ai_generated" | "approved" | "published" | "rejected";
export interface QuestionInput {
  id?: string; subjectId: string; subjectName: string; chapter: string; topic: string;
  difficulty: "easy" | "medium" | "hard"; type: "conceptual" | "calculation" | "application" | "important";
  sourceDate?: string; stem: string; options: string[]; correct: "a" | "b" | "c" | "d"; explanation: string; status: QStatus;
}
export interface QuizInput {
  id?: string; title: string; type: "weekly" | "topic"; subjectName: string; questionIds: string[]; questionCount: number;
  durationMin: number; marksPerQuestion: number; negativeMarking: number; examAttempts: number; practiceAttempts: number;
  shuffleQuestions: boolean; shuffleOptions: boolean; revealAnswers: "immediately" | "after_close" | "never";
  startAt: number | null; endAt: number | null; departments: ("Science" | "Commerce" | "Humanities")[]; status: "draft" | "published" | "closed";
}
export const saveQuestion = call<QuestionInput, { id: string }>("saveQuestion");
export const deleteQuestion = call<{ id: string }>("deleteQuestion");
export const saveQuiz = call<QuizInput, { id: string }>("saveQuiz");
export const deleteQuiz = call<{ id: string }>("deleteQuiz");

// ---- Phase 5: AI ----
export type ProviderName = "gemini" | "openai";
export interface Route { provider: ProviderName; model: string; temperature: number }
export interface AiConfig { default: Route; tasks: Partial<Record<string, Route>> }
export const adminGetAiConfig = call<void, { config: AiConfig; keys: Record<ProviderName, boolean>; tasks: string[] }>("adminGetAiConfig");
export const adminSaveAiConfig = call<AiConfig>("adminSaveAiConfig");
export const adminTestAi = call<Route, { ok: boolean; latencyMs: number; reply: string }>("adminTestAi");
export const generateQuestions = (data: { materialIds: string[]; count: number; mix: { hard: number; medium: number; easy: number }; types: string[] }) =>
  httpsCallable<typeof data, { created: number; requested: number; rejected: number; reasons: string[]; actual: { hard: number; medium: number; easy: number } }>(functions, "generateQuestions", { timeout: 300_000 })(data).then((r) => r.data);
export const setQuestionsStatus = call<{ ids: string[]; status: "draft" | "approved" | "published" | "rejected" }, { updated: number; skipped: number }>("setQuestionsStatus");

// ---- Phase 6: notifications ----
export const adminSendNotification = call<{
  scope: "all" | "department" | "section" | "student"; department?: string; section?: string; studentId?: string;
  title: string; body: string; link?: string; important: boolean;
}, { recipients: number; pushed: number; pushConfigured: boolean }>("adminSendNotification");
