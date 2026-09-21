import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/config";

/** Turns backend/Firebase errors into messages safe to show students. */
export function friendlyError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  const msg = (err as { message?: string })?.message ?? "";
  if (code.includes("email-already-in-use")) return "An account with this email already exists. Try signing in.";
  if (code.includes("wrong-password") || code.includes("invalid-credential") || code.includes("user-not-found"))
    return "Email or password is incorrect.";
  if (code.includes("weak-password")) return "Choose a password with at least 8 characters.";
  // Messages from our own functions are written for students, so pass them through.
  if (/(failed-precondition|not-found|permission-denied|resource-exhausted|invalid-argument|already-exists)/.test(code) && msg && !msg.includes("INTERNAL"))
    return msg;
  if (code.includes("too-many-requests")) return "Too many attempts. Please wait a few minutes and try again.";
  if (code.includes("network")) return "Network problem. Check your connection and try again.";
  if (code.includes("popup-closed")) return "Sign-in was cancelled.";
  return "Something went wrong. Please try again.";
}

export interface RegisterInput {
  fullName: string;
  studentId: string;
  department: "Science" | "Commerce" | "Humanities";
  section: string;
  session: string;
  phone: string;
  consent: { privacy: true; terms: true; version: string };
}
export interface RegisterResult {
  verificationStatus: "verified" | "pending";
  trialStatus: "granted" | "already_used" | "not_verified" | "disabled" | "blocked";
}

export const registerStudent = (input: RegisterInput) =>
  httpsCallable<RegisterInput, RegisterResult>(functions, "registerStudent")(input).then((r) => r.data);

export const getPublicSettings = () =>
  httpsCallable<void, { subscriptionPriceBDT: number; freeTrialDurationDays: number; methods: { bkash: boolean; nagad: boolean } }>(
    functions,
    "getPublicSettings"
  )().then((r) => r.data);
