import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../lib/admin";
import { GEMINI_API_KEY, OPENAI_API_KEY } from "../lib/secrets";
import { GeminiProvider } from "./gemini";
import { OpenAIProvider } from "./openai";
import type { AIProvider, AiConfig, AITask, ProviderName, Route } from "./types";

export const ALL_AI_SECRETS = [GEMINI_API_KEY, OPENAI_API_KEY];

// Suggested starting points. Admins should set models that exist on their own account.
export const DEFAULT_CONFIG: AiConfig = { default: { provider: "gemini", model: "gemini-2.5-flash", temperature: 0.4 }, tasks: {} };

export async function loadAiConfig(): Promise<AiConfig> {
  const d = (await db.doc("settings/aiRouting").get()).data() as Partial<AiConfig> | undefined;
  return { default: d?.default ?? DEFAULT_CONFIG.default, tasks: d?.tasks ?? {} };
}

export function keyFor(p: ProviderName): string {
  const v = (p === "gemini" ? GEMINI_API_KEY : OPENAI_API_KEY).value();
  return v && v !== "unused" ? v : "";
}
export const keyStatus = () => ({ gemini: !!keyFor("gemini"), openai: !!keyFor("openai") });

export function buildProvider(route: Route, task: AITask, uid: string): AIProvider {
  const key = keyFor(route.provider);
  if (!key) throw new HttpsError("failed-precondition", "The selected AI provider isn't set up yet. Ask the developer to add its API key.");
  const ctx = { uid, task, model: route.model, temperature: route.temperature };
  return route.provider === "gemini" ? new GeminiProvider(ctx, key) : new OpenAIProvider(ctx, key);
}

/** The single entry point: pick the provider/model the admin configured for this task. */
export async function getProvider(task: AITask, uid: string): Promise<AIProvider> {
  const cfg = await loadAiConfig();
  return buildProvider(cfg.tasks[task] ?? cfg.default, task, uid);
}
