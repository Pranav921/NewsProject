import type { ErrorEvent, EventHint } from "@sentry/nextjs";
type SentryOptions = NonNullable<Parameters<typeof import("@sentry/nextjs").init>[0]>;
type TransactionEvent = Parameters<NonNullable<SentryOptions["beforeSendTransaction"]>>[0];
type SpanJSON = Parameters<NonNullable<SentryOptions["beforeSendSpan"]>>[0];

// Privacy allowlist, rather than a growing blacklist of secret/question fields.
// Keep correlation/status/timing; never forward arbitrary text, payloads or context.
export function sanitizeSentryEvent<T extends ErrorEvent | TransactionEvent>(event: T, hint?: EventHint): T {
  if (hint) hint.attachments = [];
  const safe: Record<string, unknown> = { type: event.type, event_id: event.event_id,
    timestamp: event.timestamp, platform: event.platform, level: event.level,
    release: event.release, environment: event.environment };
  if (event.type === "transaction") {
    const transaction = event as TransactionEvent;
    safe.transaction = "Application request";
    safe.start_timestamp = transaction.start_timestamp;
    safe.spans = [];
  } else {
    safe.message = "Application error (private content removed)";
    safe.fingerprint = ["sanitized-application-error"];
  }
  const trace = event.contexts?.trace;
  if (trace && /^[a-f0-9]{32}$/.test(String(trace.trace_id)) && /^[a-f0-9]{16}$/.test(String(trace.span_id))) {
    safe.contexts = { trace: { trace_id: trace.trace_id, span_id: trace.span_id,
      ...(typeof trace.status === "string" && ["ok", "internal_error", "deadline_exceeded", "unknown_error"].includes(trace.status) ? { status: trace.status } : {}) } };
  }
  return safe as T;
}

export function sanitizeSentrySpan(span: SpanJSON): SpanJSON {
  return { trace_id: span.trace_id, span_id: span.span_id, parent_span_id: span.parent_span_id,
    start_timestamp: span.start_timestamp, timestamp: span.timestamp, status: span.status,
    op: "application", description: "Private span content removed", data: {} };
}

export const sentryPrivacyOptions = {
  beforeSend: sanitizeSentryEvent,
  beforeSendTransaction: sanitizeSentryEvent,
  beforeSendSpan: sanitizeSentrySpan,
  beforeBreadcrumb: () => null,
  beforeSendLog: () => null,
  enableLogs: false,
  sendDefaultPii: false,
};

export function getSentryEnabled() {
  return Boolean(
    process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim(),
  );
}
