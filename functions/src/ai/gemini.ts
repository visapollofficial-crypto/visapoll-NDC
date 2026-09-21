import { BaseProvider, fetchJson } from "./base";
import type { CompleteInput, CompleteOutput, ProviderName } from "./types";

export class GeminiProvider extends BaseProvider {
  readonly name: ProviderName = "gemini";
  constructor(ctx: ConstructorParameters<typeof BaseProvider>[0], private apiKey: string) { super(ctx); }

  protected async callApi(i: CompleteInput): Promise<CompleteOutput> {
    const data = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(i.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: i.system }] },
        contents: [{ role: "user", parts: [{ text: i.user }, ...(i.images ?? []).map((im) => ({ inlineData: { mimeType: im.mime, data: im.data } }))] }],
        generationConfig: { temperature: i.temperature, maxOutputTokens: i.maxTokens, ...(i.json ? { responseMimeType: "application/json" } : {}) },
      }),
    });
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
    return { text, tokensIn: data.usageMetadata?.promptTokenCount, tokensOut: data.usageMetadata?.candidatesTokenCount };
  }
}
