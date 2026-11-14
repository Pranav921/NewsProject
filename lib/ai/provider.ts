import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { BriefingValidationError, briefingInstructions, briefingSchema, validateBriefingOutput } from "./briefing.ts";
import type { BriefingArticle } from "./briefing.ts";
import { BriefingError } from "./settings.ts";
import type { BriefingConfig } from "./settings.ts";

export type ModelResult = {
  output: unknown;
  usage: { inputTokens: number | null; outputTokens: number | null };
};

export async function generateBriefing(
  articles: BriefingArticle[], config: BriefingConfig, apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ModelResult> {
  if (!apiKey.trim()) throw new BriefingError("missing-api-key");
  if (!articles.length || new TextEncoder().encode(JSON.stringify(articles)).length > config.limits.maxInputBytes) throw new BriefingError("invalid-input", 502);
  // Claude's wire schema does not support all length/array constraints. The
  // official transformer preserves these as descriptions; our ORIGINAL schema
  // and all business validation remain unchanged and enforced after generation.
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: config.model, max_tokens: config.maxOutputTokens,
    system: briefingInstructions(config.limits),
    messages: [{ role: "user", content: JSON.stringify({ articles }) }],
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: transformJSONSchema(briefingSchema(articles, config.limits)) },
    },
  };
  if (new TextEncoder().encode(JSON.stringify(params)).length > 32000) throw new BriefingError("invalid-input", 502);
  let boundaryError: BriefingError | null = null;
  try {
    const client = new Anthropic({
      apiKey, baseURL: "https://api.anthropic.com", maxRetries: 0,
      timeout: config.timeoutMs, logLevel: "off", openTelemetry: false,
      // Preserve the byte cap, no-redirect policy and body-read deadline while
      // letting the official SDK handle Messages API transport/authentication.
      fetch: async (input, init) => {
        try {
          const response = await fetcher(input, {
            ...init, cache: "no-store", redirect: "error",
            signal: AbortSignal.any([AbortSignal.timeout(config.timeoutMs), ...(init?.signal ? [init.signal] : [])]),
          });
          const reader = response.body?.getReader();
          if (!reader) return response;
          let bytes = 0;
          const chunks: Uint8Array[] = [];
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              bytes += value.byteLength;
              if (bytes > 65536) throw new BriefingError("provider-response-too-large", 502);
              chunks.push(value);
            }
          } finally { await reader.cancel(); }
          const buffer = new Uint8Array(bytes);
          let offset = 0;
          for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
          return new Response(buffer, { status: response.status, statusText: response.statusText, headers: response.headers });
        } catch (error) {
          if (error instanceof BriefingError) boundaryError = error;
          if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) boundaryError = new BriefingError("provider-timeout", 502);
          throw error;
        }
      },
    });
    const data = await client.messages.create(params);
    if (data.stop_reason === "refusal") throw new BriefingError("provider-refusal", 502);
    // Never accept a partial JSON document even if it happens to parse.
    if (data.stop_reason !== "end_turn") throw new BriefingError("incomplete-provider-response", 502);
    if (data.type !== "message" || data.role !== "assistant" || !Array.isArray(data.content)) throw new BriefingError("provider-invalid-envelope", 502);
    const texts = data.content.filter((block) => block?.type === "text");
    if (!texts.length || texts.some((block) => typeof block.text !== "string")) throw new BriefingError("provider-invalid-envelope", 502);
    if (data.content.some((block) => !["text", "thinking", "redacted_thinking"].includes(block?.type))) throw new BriefingError("provider-invalid-envelope", 502);
    let output: unknown;
    try { output = JSON.parse(texts.map((block) => block.text).join("")); }
    catch { throw new BriefingError("provider-malformed-json", 502); }
    validateBriefingOutput(output, articles, config.limits);
    const tokenCount = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
    return { output, usage: { inputTokens: tokenCount(data.usage?.input_tokens), outputTokens: tokenCount(data.usage?.output_tokens) } };
  } catch (error) {
    // Never propagate provider response bodies, fetch errors, prompts, or headers to logs/Sentry.
    if (error instanceof BriefingError) throw error;
    if (error instanceof BriefingValidationError) throw new BriefingError(`provider-${error.category}`, 502);
    if (boundaryError) throw boundaryError;
    if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIUserAbortError || error instanceof Anthropic.APIError && error.status === 408) throw new BriefingError("provider-timeout", 502);
    if (error instanceof Anthropic.APIError) {
      const code = error.status === 401 || error.status === 403 ? "provider-authentication-failed"
        : error.status === 429 ? "provider-rate-limited"
          : error instanceof Anthropic.APIConnectionError ? "provider-connection-error" : "provider-error";
      throw new BriefingError(code, 502);
    }
    throw new BriefingError("invalid-provider-response", 502);
  }
}
