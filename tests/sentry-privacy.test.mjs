import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import * as privacy from "../lib/sentry.ts";
import { loadAiModule } from "./helpers/load-ai-module.mjs";

test("Sentry error/transaction/span hooks drop questions, payloads, credentials and arbitrary nested context", () => {
  const privateText = "PRIVATE_QUESTION_PROMPT_ARTICLE_RESPONSE_COOKIE_KEY";
  for (const type of [undefined, "transaction"]) {
    const event = { type, event_id: "a".repeat(32), timestamp: 123, level: "error", platform: "node",
      message: privateText, logentry: { message: privateText }, exception: { values: [{ value: privateText, stacktrace: { frames: [{ vars: { question: privateText } }] } }] },
      request: { url: `https://user:${privateText}@example.test/api/ai/ask?q=${privateText}`, data: { question: privateText }, cookies: privateText,
        headers: { Authorization: privateText, Cookie: privateText, "X-API-Key": privateText } },
      user: { email: privateText }, extra: { raw: privateText }, tags: { anything: privateText },
      contexts: { arbitrary: { question: privateText }, trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16), data: privateText } },
      breadcrumbs: [{ message: privateText }], spans: [{ data: { request_body: privateText } }], transaction: privateText,
    };
    const hint = { attachments: [{ filename: "question.txt", data: privateText }] };
    const safe = privacy.sanitizeSentryEvent(event, hint);
    assert.doesNotMatch(JSON.stringify(safe), /PRIVATE_|Authorization|Cookie|question\.txt/);
    assert.equal(hint.attachments.length, 0); assert.equal(safe.event_id, event.event_id);
    assert.equal(safe.contexts.trace.trace_id, "a".repeat(32));
    assert.equal(event.message, privateText, "do not mutate the original error/payload");
  }
  const span = privacy.sanitizeSentrySpan({ trace_id: "a".repeat(32), span_id: "b".repeat(16), start_timestamp: 1, timestamp: 2,
    description: privateText, data: { body: privateText }, unknown: privateText });
  assert.doesNotMatch(JSON.stringify(span), /PRIVATE_/);
  assert.equal(privacy.sentryPrivacyOptions.beforeBreadcrumb({ message: privateText }), null);
  assert.equal(privacy.sentryPrivacyOptions.beforeSendLog({ body: privateText }), null);
});

test("Sentry privacy hooks are actually registered in server, edge and browser initialization; no replay or logs", () => {
  for (const path of ["../../sentry.server.config.ts", "../../sentry.edge.config.ts", "../../instrumentation-client.ts"]) {
    let options;
    loadAiModule(path, { "@sentry/nextjs": { init(value) { options = value; } }, "./lib/sentry": privacy });
    assert.equal(options.beforeSend, privacy.sanitizeSentryEvent);
    assert.equal(options.beforeSendTransaction, privacy.sanitizeSentryEvent);
    assert.equal(options.beforeSendSpan, privacy.sanitizeSentrySpan);
    assert.equal(options.sendDefaultPii, false); assert.equal(options.enableLogs, false);
    assert.equal(options.integrations, undefined); assert.equal(options.replaysOnErrorSampleRate, undefined);
  }
});

test("the real Sentry SDK pipeline emits no sentinel text in any envelope (in-memory transport, no network)", () => {
  // Separate process: Sentry's global instrumentation must not leak into other tests.
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/verify-sentry-privacy-local.mjs"],
    { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 60000 });
  assert.equal(run.status, 0, run.stderr.split("\n").filter(line => !/MODULE_TYPELESS|Reparsing|eliminate|trace-warnings/.test(line)).join("\n"));
  assert.match(run.stdout, /PASS no question\/answer/);
});
