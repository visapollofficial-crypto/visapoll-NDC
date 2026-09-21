import { BaseProvider, fetchJson } from "./base";
import type { CompleteInput, CompleteOutput, ProviderName } from "./types";

export class OpenAIProvider extends BaseProvider {
  readonly name: ProviderName = "openai";
  constructor(ctx: ConstructorParameters<typeof BaseProvider>[0], private apiKey: string) { super(ctx); }

  protected async callApi(i: CompleteInput): Promise<CompleteOutput> {
    const data = await fetchJson("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: i.model,
        messages: [{ role: "system", content: i.system }, { role: "user", content: i.images?.length ? [{ type: "text", text: i.user }, ...i.images.map((im) => ({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.data}` } }))] : i.user }],
        temperature: i.temperature,
        max_completion_tokens: i.maxTokens,
        ...(i.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    return { text: data.choices?.[0]?.message?.content ?? "", tokensIn: data.usage?.prompt_tokens, tokensOut: data.usage?.completion_tokens };
  }
}
