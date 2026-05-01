type LogDetails = Record<string, unknown>;

type MaybeStructuredError = {
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  message?: string | null;
  stack?: string | null;
};

export function getErrorLogDetails(error: unknown): LogDetails {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  if (error && typeof error === "object") {
    const structuredError = error as MaybeStructuredError;

    return {
      code: structuredError.code ?? null,
      details: structuredError.details ?? null,
      hint: structuredError.hint ?? null,
      message: structuredError.message ?? String(error),
      stack: structuredError.stack ?? undefined,
    };
  }

  return {
    message: String(error),
  };
}

export function logApiInfo(scope: string, details: LogDetails) {
  console.info(scope, details);
}

export function logApiError(
  scope: string,
  error: unknown,
  details: LogDetails = {},
) {
  console.error(scope, {
    ...details,
    ...getErrorLogDetails(error),
  });
}
