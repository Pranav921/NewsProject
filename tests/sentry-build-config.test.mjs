import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

// The Sentry bundler plugin reads a local `.env.sentry-build-plugin` token on its own,
// so the config must disable uploads/releases explicitly everywhere except Vercel.
// Loads the real next.config.ts (with module interop, as Next does) and captures the
// options passed to withSentryConfig for a given build environment.
function sentryOptions(env) {
  const url = new URL("../next.config.ts", import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const nativeRequire = createRequire(url);
  let captured;
  runInNewContext(outputText, {
    exports: {}, process: { env }, __dirname: fileURLToPath(new URL("..", import.meta.url)),
    require: (name) => name === "@sentry/nextjs"
      ? { withSentryConfig: (config, options) => { captured = options; return config; } } : nativeRequire(name),
  });
  return captured;
}

test("Sentry source maps and releases are produced only by builds running on Vercel", () => {
  for (const env of [{}, { CI: "true" }, { SENTRY_AUTH_TOKEN: "sntrys_fixture", SENTRY_ORG: "org", SENTRY_PROJECT: "project" }, { VERCEL: "0" }]) {
    const options = sentryOptions(env);
    assert.equal(options.sourcemaps.disable, true, JSON.stringify(env));
    assert.equal(options.release.create, false); assert.equal(options.release.finalize, false);
  }
  for (const env of [{ VERCEL: "1", VERCEL_ENV: "production" }, { VERCEL: "1", VERCEL_ENV: "preview" }]) {
    const options = sentryOptions(env);
    assert.equal(options.sourcemaps.disable, false, JSON.stringify(env));
    assert.equal(options.release.create, true); assert.equal(options.release.finalize, true);
  }
  assert.equal(sentryOptions({}).tunnelRoute, "/monitoring", "the rest of the Sentry config is unchanged");
});
