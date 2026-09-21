import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/config";

export interface ServedQuestion { id: string; stem: string; options: { id: string; text: string }[] }
export interface AttemptPayload {
  attemptId: string; serverNow: number; startedAt: number; deadline: number; mode: "practice" | "exam";
  quizTitle: string; questions: ServedQuestion[]; answers: Record<string, string | null>;
}
export interface Result {
  quizId: string; quizTitle: string; mode: "practice" | "exam"; score: number; maxScore: number; percent: number;
  correct: number; wrong: number; skipped: number; total: number; timeUsedSec: number;
  topics: Record<string, { correct: number; total: number }>; subjects?: Record<string, { correct: number; total: number }>;
  difficulty?: Record<string, { correct: number; total: number }>; autoSubmitted: boolean;
  submittedAt: { toMillis(): number } | { seconds: number };
}
export interface ReviewItem {
  questionId: string; stem: string; options: { id: string; text: string }[];
  chosen: string | null; correct: string; isCorrect: boolean; explanation: string;
}

export const startAttempt = (quizId: string, mode: "practice" | "exam") =>
  httpsCallable<{ quizId: string; mode: string }, AttemptPayload>(functions, "startAttempt")({ quizId, mode }).then((r) => r.data);
export const saveAnswer = (attemptId: string, questionId: string, optionId: string | null) =>
  httpsCallable(functions, "saveAnswer")({ attemptId, questionId, optionId });
export const submitAttempt = (attemptId: string, answers: Record<string, string | null>) =>
  httpsCallable<unknown, { attemptId: string; result: Result }>(functions, "submitAttempt")({ attemptId, answers }).then((r) => r.data);
export const getResult = (attemptId: string) =>
  httpsCallable<unknown, { result: Result; revealed: boolean; review: ReviewItem[] | null }>(functions, "getResult")({ attemptId }).then((r) => r.data);

export const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
