import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ASK_WORKFLOW_LIMITS, AskWorkflowError, askBytes } from "./ask-answer.ts";

export type AskProvider = (params: Anthropic.MessageCreateParamsNonStreaming, signal: AbortSignal) => Promise<unknown>;

// Same official SDK/server-only boundary as the briefing, without changing its adapter.
// The caller supplies the server credential; no env lookup, telemetry or SDK logging.
export function createAskProvider(apiKey: string, fetcher: typeof fetch = fetch): AskProvider {
  if (!apiKey.trim()) throw new AskWorkflowError("provider-authentication-failed");
  return async (params, signal) => {
    let boundaryError: AskWorkflowError | undefined;
    try {
      if (askBytes(params) > ASK_WORKFLOW_LIMITS.requestBytes) throw new AskWorkflowError("request-too-large");
      if (signal.aborted) throw new AskWorkflowError("provider-timeout");
      const client = new Anthropic({ apiKey, baseURL: "https://api.anthropic.com", maxRetries: 0,
        timeout: 60000, logLevel: "off", openTelemetry: false,
        fetch: async (input, init) => {
          const response = await fetcher(input, { ...init, cache: "no-store", redirect: "error",
            signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) });
          const reader = response.body?.getReader();
          if (!reader) return response;
          let bytes = 0; let emptyChunks = 0;
          const chunks: Uint8Array[] = [];
          let abort: () => void = () => {};
          const aborted = new Promise<never>((_, reject) => {
            abort = () => reject(new AskWorkflowError("provider-timeout"));
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) abort();
          });
          try {
            while (true) {
              const { done, value } = await Promise.race([reader.read(), aborted]);
              if (done) break;
              bytes += value.byteLength;
              if (bytes > ASK_WORKFLOW_LIMITS.responseBytes || !value.byteLength && ++emptyChunks > 64) {
                boundaryError = new AskWorkflowError("response-too-large");
                throw boundaryError;
              }
              chunks.push(value);
            }
          } finally {
            signal.removeEventListener("abort", abort);
            void reader.cancel().catch(() => {});
          }
          const buffer = new Uint8Array(bytes);
          let offset = 0;
          for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
          return new Response(buffer, { status: response.status, headers: response.headers });
        },
      });
      return await client.messages.create(params, { signal });
    } catch (error) {
      // Deliberately discard raw SDK errors, response bodies, headers and causes.
      if (error instanceof AskWorkflowError) throw error;
      if (boundaryError) throw boundaryError;
      if (signal.aborted || error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIUserAbortError) throw new AskWorkflowError("provider-timeout");
      if (error instanceof Anthropic.APIError) {
        const code = error.status === 401 || error.status === 403 ? "provider-authentication-failed"
          : error.status === 429 ? "provider-rate-limited" : error.status === 408 ? "provider-timeout"
            : error instanceof Anthropic.APIConnectionError ? "provider-connection-error" : "provider-error";
        throw new AskWorkflowError(code);
      }
      throw new AskWorkflowError("provider-error");
    }
  };
}
