export type AITask =
  | "quizGeneration" | "difficultyClassification" | "explanation" | "homework"
  | "chat" | "summarization" | "extraction" | "learningPattern";
export const AI_TASKS: AITask[] = ["quizGeneration", "difficultyClassification", "explanation", "homework", "chat", "summarization", "extraction", "learningPattern"];

export type ProviderName = "gemini" | "openai";
export interface Route { provider: ProviderName; model: string; temperature: number }
export interface AiConfig { default: Route; tasks: Partial<Record<AITask, Route>> }

export type QType = "conceptual" | "calculation" | "application" | "important";
export interface QuizGenInput {
  subjectName: string;
  materials: { chapter: string; topic: string; date: string; text: string }[];
  counts: { hard: number; medium: number; easy: number };
  types: QType[];
}
export interface RawQuestion {
  source?: unknown; stem?: unknown; options?: unknown; correct?: unknown;
  explanation?: unknown; difficulty?: unknown; type?: unknown; topic?: unknown;
}
export interface QuizGenOutput { questions: RawQuestion[] }
export interface PatternInsights { insights: string[]; suggestedRevision: string[] }

/** Every AI vendor sits behind this interface. The rest of the app never touches a vendor SDK/API directly. */
export interface AIProvider {
  readonly name: ProviderName;
  generateQuiz(input: QuizGenInput): Promise<QuizGenOutput>;
  generateExplanation(input: { context: string; question: string; level: "simple" | "detailed" }): Promise<string>;
  analyzeLearningPattern(input: { stats: unknown }): Promise<PatternInsights>;
  answerHomework(input: { question: string; mode: "hint" | "steps" | "example"; context?: string; images?: ImageInput[] }): Promise<string>;
  chat(input: { messages: { role: "user" | "assistant"; content: string }[]; context: string }): Promise<string>;
}

export interface ImageInput { mime: string; data: string } // base64
export interface CompleteInput { system: string; user: string; json?: boolean; temperature: number; maxTokens: number; model: string; images?: ImageInput[] }
export interface CompleteOutput { text: string; tokensIn?: number; tokensOut?: number }

export class AIError extends Error {
  constructor(public kind: "bad_json" | "http" | "timeout" | "not_configured", message: string) { super(message); }
}
