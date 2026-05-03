import type { ErrorEvent } from "@sentry/nextjs";

function redactSensitiveHeaders(headers: Record<string, unknown>) {
  for (const headerName of ["authorization", "cookie", "set-cookie", "x-supabase-auth"]) {
    if (headerName in headers) {
      headers[headerName] = "[redacted]";
    }
  }
}

function redactSensitiveRequestData(event: ErrorEvent) {
  if (event.request?.headers && typeof event.request.headers === "object") {
    redactSensitiveHeaders(event.request.headers as Record<string, unknown>);
  }

  if (event.request?.url) {
    event.request.url = event.request.url.replace(
      /(token=)[^&]+/gi,
      "$1[redacted]",
    );
  }
}

export function sanitizeSentryEvent(event: ErrorEvent) {
  redactSensitiveRequestData(event);

  return event;
}

export function getSentryEnabled() {
  return Boolean(
    process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim(),
  );
}
