import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { ASK_LIMITS, AskRetrievalError, askToolDefinitions } from "./ask.ts";
import { createAskTools } from "./ask-retrieval.ts";
import type { AskSnapshot } from "./ask-retrieval.ts";
import type { AskProvider } from "./ask-provider.ts";
import { ASK_ANSWER_SCHEMA, ASK_INSTRUCTIONS, ASK_PROMPT_VERSION, ASK_WORKFLOW_DEFAULTS,
  ASK_WORKFLOW_LIMITS, AskWorkflowError, askBytes, validateAskAnswer, validateAskConfig } from "./ask-answer.ts";
import type { AskWorkflowConfig } from "./ask-answer.ts";

type Usage = { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number };
type ModelMessage = { content: Anthropic.ContentBlock[]; stop_reason: string; usage: Usage };

function message(value: unknown, maxTokens: number): ModelMessage {
  if (askBytes(value) > ASK_WORKFLOW_LIMITS.responseBytes) throw new AskWorkflowError("response-too-large");
  if (!value || typeof value !== "object") throw new AskWorkflowError("invalid-envelope");
  const data = value as Record<string, unknown>;
  if (data.stop_reason === "refusal") throw new AskWorkflowError("provider-refusal");
  if (!["tool_use", "end_turn"].includes(data.stop_reason as string)) throw new AskWorkflowError("incomplete-response");
  if (data.type !== "message" || data.role !== "assistant" || !Array.isArray(data.content) || !data.content.length
    || data.content.some(block => !block || typeof block !== "object" || !["text", "thinking", "redacted_thinking", "tool_use"].includes(block.type)
      || block.type === "text" && typeof block.text !== "string"
      || block.type === "thinking" && (typeof block.thinking !== "string" || typeof block.signature !== "string")
      || block.type === "redacted_thinking" && typeof block.data !== "string")) throw new AskWorkflowError("invalid-envelope");
  const raw = data.usage as Record<string, unknown> | undefined;
  const count = (name: string, optional = false): number => {
    const value = raw?.[name];
    if (optional && (value === undefined || value === null)) return 0;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new AskWorkflowError("invalid-envelope");
    return value;
  };
  const usage = { inputTokens: count("input_tokens"), outputTokens: count("output_tokens"),
    cacheReadInputTokens: count("cache_read_input_tokens", true), cacheCreationInputTokens: count("cache_creation_input_tokens", true) };
  if (usage.outputTokens > maxTokens) throw new AskWorkflowError("token-budget");
  return { content: data.content, stop_reason: data.stop_reason as string, usage };
}

// Internal fixed workflow, not a route/Server Action. The caller owns authentication,
// flags and Redis budgets. A provider is mandatory so tests cannot call by accident.
export async function runAskQuestion(question: string, snapshot: AskSnapshot, provider: AskProvider,
  config: AskWorkflowConfig = ASK_WORKFLOW_DEFAULTS) {
  validateAskConfig(config);
  if (typeof question !== "string" || !question.trim() || question.length > ASK_WORKFLOW_LIMITS.questionCharacters
    || new TextEncoder().encode(question).length > ASK_WORKFLOW_LIMITS.questionBytes || /[\u0000-\u001f\u007f]/.test(question)) throw new AskWorkflowError("invalid-question");
  // Copy config to prevent a caller changing budgets between the two requests.
  const settings = { ...config };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new AskWorkflowError("provider-timeout")); }, settings.timeoutMs);
  });
  let requests = 0;
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
  const request = async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    if (controller.signal.aborted) throw new AskWorkflowError("provider-timeout");
    if (requests >= 2 || askBytes(params) > ASK_WORKFLOW_LIMITS.requestBytes) throw new AskWorkflowError("request-too-large");
    requests++;
    const data = message(await Promise.race([provider(params, controller.signal), deadline]), params.max_tokens);
    for (const key of Object.keys(usage) as (keyof Usage)[]) {
      usage[key] += data.usage[key];
      if (!Number.isSafeInteger(usage[key])) throw new AskWorkflowError("token-budget");
    }
    return data;
  };
  try {
    // Ordinary custom-tool JSON Schema is supported by Messages. Stage A's exact
    // local parsers remain authoritative; no schema relaxation affects execution.
    const tools: Anthropic.Tool[] = askToolDefinitions(snapshot.sources).map(tool => ({
      ...tool, input_schema: { ...tool.input_schema, type: "object" },
    }));
    const initial: Anthropic.MessageParam = { role: "user", content: JSON.stringify({
      question: question.trim(), snapshotTime: snapshot.asOf, promptVersion: ASK_PROMPT_VERSION,
    }) };
    const base = { model: settings.model, system: ASK_INSTRUCTIONS, tools };
    const selected = await request({ ...base, max_tokens: settings.selectionTokens,
      tool_choice: { type: "any", disable_parallel_tool_use: true }, messages: [initial] });
    const calls = selected.content.filter(block => block.type === "tool_use");
    if (selected.stop_reason !== "tool_use" || calls.length !== 1) throw new AskWorkflowError("invalid-tool-call");
    const call = calls[0];
    if (typeof call.id !== "string" || !call.id.length || call.id.length > 200 || /[^a-zA-Z0-9_-]/.test(call.id)) throw new AskWorkflowError("invalid-tool-call");
    const bound = createAskTools(snapshot);
    let result;
    try {
      // Explicit dispatch prevents prototype/property tricks or arbitrary execution.
      switch (call.name) {
        case "search_articles": result = bound.search_articles(call.input); break;
        case "recent_news": result = bound.recent_news(call.input); break;
        case "article_details": result = bound.article_details(call.input); break;
        default: throw new AskWorkflowError("unknown-tool");
      }
    } catch (error) {
      if (error instanceof AskRetrievalError) throw new AskWorkflowError("invalid-tool-arguments");
      throw error;
    }
    if (askBytes(result) > ASK_LIMITS.resultBytes) throw new AskWorkflowError("tool-result-too-large");
    if (result.status === "unavailable") throw new AskWorkflowError("tool-unavailable");
    // No evidence means no paid summarization call. No synthetic tool-result is
    // needed because this conversation ends locally rather than resuming Claude.
    if (!result.articles.length) return { answer: validateAskAnswer({ status: "no_results", statements: [], clarification: null }, result),
      usage, modelRequests: requests, toolExecutions: 1, promptVersion: ASK_PROMPT_VERSION,
      evidence: result };
    const final = await request({ ...base, max_tokens: settings.answerTokens,
      tool_choice: { type: "none" }, output_config: { effort: "low",
        format: { type: "json_schema", schema: transformJSONSchema(ASK_ANSWER_SCHEMA) } },
      messages: [initial, { role: "assistant", content: selected.content },
        { role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) }] }],
    });
    if (final.stop_reason !== "end_turn" || final.content.some(block => block.type === "tool_use")) throw new AskWorkflowError("invalid-tool-call");
    const text = final.content.filter(block => block.type === "text").map(block => block.text).join("");
    let output: unknown;
    try { output = JSON.parse(text); } catch { throw new AskWorkflowError("malformed-answer"); }
    return { answer: validateAskAnswer(output, result), usage, modelRequests: requests,
      toolExecutions: 1, promptVersion: ASK_PROMPT_VERSION, evidence: result };
  } catch (error) {
    if (error instanceof AskWorkflowError) throw error;
    throw new AskWorkflowError("provider-error");
  } finally { clearTimeout(timer); controller.abort(); }
}
