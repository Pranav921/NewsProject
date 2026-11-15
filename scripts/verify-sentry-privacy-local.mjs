// Sends synthetic sentinel events through the REAL Sentry Next.js SDK pipeline
// (scope, integrations, event processors, envelope creation) using the app's
// registered privacy options. A custom in-memory transport captures envelopes;
// the DSN uses the reserved `.invalid` TLD, so nothing can reach a live service.
//
//   node --experimental-strip-types scripts/verify-sentry-privacy-local.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { sentryPrivacyOptions } from "../lib/sentry.ts";

// The Node build is CommonJS with getter re-exports that ESM named imports cannot see.
const Sentry = createRequire(import.meta.url)("@sentry/nextjs");

const SENTINEL = "ASKPRIVATE7731";
const envelopes = [];
const decoder = new TextDecoder();
Sentry.init({
  dsn: "https://publickey@sentry.invalid/1",
  tracesSampleRate: 1,
  transport: () => ({
    send: async (envelope) => { envelopes.push(envelope); return { statusCode: 200 }; },
    flush: async () => true,
  }),
  ...sentryPrivacyOptions,
});

// Everything an interactive Ask request might attach, deliberately.
Sentry.setUser({ id: SENTINEL, email: `${SENTINEL}@example.test`, ip_address: "203.0.113.9" });
Sentry.setTag("question", SENTINEL);
Sentry.setExtra("question", SENTINEL);
Sentry.setContext("ask", { question: SENTINEL, answer: SENTINEL });
Sentry.addBreadcrumb({ message: `fetch /api/ai/ask ${SENTINEL}`, data: { body: SENTINEL } });
Sentry.withScope((scope) => {
  scope.setSDKProcessingMetadata({ normalizedRequest: { method: "POST",
    url: `https://kicker.example/api/ai/ask?question=${SENTINEL}`, query_string: `question=${SENTINEL}`,
    headers: { cookie: `sb-access-token=${SENTINEL}`, authorization: `Bearer ${SENTINEL}`, "x-api-key": SENTINEL },
    cookies: { sb: SENTINEL }, data: JSON.stringify({ question: SENTINEL }) } });
  scope.addAttachment({ filename: "question.txt", data: SENTINEL });
  Sentry.captureException(new Error(`Provider failed for question ${SENTINEL}`));
});
Sentry.captureMessage(`Question was ${SENTINEL}`, "error");
Sentry.captureEvent({ message: SENTINEL, extra: { prompt: SENTINEL }, request: { data: SENTINEL }, tags: { model: SENTINEL } });
Sentry.startSpan({ name: "POST /api/ai/ask", op: "http.server", attributes: { "http.request.body": SENTINEL, question: SENTINEL } }, () => {
  Sentry.startSpan({ name: `anthropic.messages ${SENTINEL}`, attributes: { prompt: SENTINEL } }, () => {});
});
Sentry.logger?.info?.(`log line ${SENTINEL}`);
await Sentry.flush(3000);

const serialized = JSON.stringify(envelopes, (_, value) => value instanceof Uint8Array ? decoder.decode(value) : value);
const items = envelopes.flatMap(([, list]) => list.map(([header]) => header.type));
console.log(`Captured ${envelopes.length} envelopes; item types: ${[...new Set(items)].join(", ")}`);
assert.ok(items.filter((type) => type === "event").length >= 3, "error events were captured (test is not vacuous)");
assert.ok(items.includes("transaction"), "a transaction was captured (test is not vacuous)");
for (const forbidden of ["attachment", "log", "replay_event", "replay_recording"]) assert.ok(!items.includes(forbidden), `${forbidden} item was sent`);
assert.ok(!serialized.includes(SENTINEL), `sentinel leaked: ${serialized.slice(Math.max(0, serialized.indexOf(SENTINEL) - 200), serialized.indexOf(SENTINEL) + 60)}`);
assert.doesNotMatch(serialized, /203\.0\.113\.9|sb-access-token|Bearer |question\.txt/);
console.log("PASS no question/answer/prompt/cookie/header/user/IP/attachment/log text in any outgoing envelope (headers included)");
