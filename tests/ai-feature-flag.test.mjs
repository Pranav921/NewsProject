import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadAiModule } from "./helpers/load-ai-module.mjs";

const { isAiEnabled } = loadAiModule("../../lib/ai/feature-flag.ts");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the shared AI switch is the briefing's flags: enabled flag, plus production verification in production mode", () => {
  const cases = [
    [{}, false], [{ AI_BRIEFING_ENABLED: "false" }, false], [{ AI_BRIEFING_ENABLED: "TRUE" }, false],
    [{ AI_BRIEFING_ENABLED: "true" }, true], [{ AI_BRIEFING_ENABLED: "true", NODE_ENV: "development" }, true],
    [{ AI_BRIEFING_ENABLED: "true", NODE_ENV: "production" }, false],
    [{ AI_BRIEFING_ENABLED: "true", NODE_ENV: "production", AI_BRIEFING_PRODUCTION_VERIFIED: "false" }, false],
    [{ AI_BRIEFING_ENABLED: "true", NODE_ENV: "production", AI_BRIEFING_PRODUCTION_VERIFIED: "true" }, true],
    [{ AI_BRIEFING_ENABLED: "false", NODE_ENV: "production", AI_BRIEFING_PRODUCTION_VERIFIED: "true" }, false],
    // Former Ask-only flags have no effect in either direction.
    [{ AI_ASK_ENABLED: "true", AI_ASK_PRODUCTION_VERIFIED: "true", NODE_ENV: "production" }, false],
    [{ AI_BRIEFING_ENABLED: "true", AI_ASK_ENABLED: "false" }, true],
  ];
  for (const [env, expected] of cases) assert.equal(isAiEnabled(env), expected, JSON.stringify(env));
});

test("briefing, dashboard and Ask all use the same switch; Ask checks it before any other work", () => {
  const briefing = read("app/api/ai/briefing/route.ts");
  assert.match(briefing, /process\.env\.AI_BRIEFING_ENABLED !== "true"/);
  assert.match(briefing, /process\.env\.NODE_ENV === "production" && process\.env\.AI_BRIEFING_PRODUCTION_VERIFIED !== "true"/);
  const page = read("app/page.tsx");
  assert.match(page, /const aiEnabled = isAiEnabled\(process\.env\);/);
  assert.match(page, /aiBriefingEnabled=\{aiEnabled\}/); assert.match(page, /askKickerEnabled=\{aiEnabled\}/);
  assert.ok(page.indexOf("const aiEnabled") > page.indexOf("if (!user)"), "computed only on the authenticated path");
  const ask = read("app/api/ai/ask/route.ts");
  const body = ask.slice(ask.indexOf("export async function POST"));
  assert.ok(body.indexOf("isAiEnabled(process.env)") < body.indexOf("headers.get(\"origin\")"), "flag before origin/body/session work");
  for (const path of ["app/api/ai/ask/route.ts", "app/page.tsx", "lib/ai/ask-settings.ts", "lib/ai/ask-backend.ts", "components/DashboardView.tsx", "components/AskKicker.tsx"]) {
    assert.doesNotMatch(read(path), /AI_ASK_ENABLED|AI_ASK_PRODUCTION_VERIFIED|AI_ASK_MODEL/, path);
  }
});
