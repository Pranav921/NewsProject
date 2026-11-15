// Ask Kicker evaluation CLI. Default is a zero-cost MOCK run. Never reads .env files.
//
//   node --experimental-strip-types scripts/eval-ask-kicker.mjs                    # mock, in-memory budgets
//   node --experimental-strip-types scripts/eval-ask-kicker.mjs --store local-redis # mock, real Lua on disposable Redis
//   node --experimental-strip-types scripts/eval-ask-kicker.mjs --profile flawed    # mock with deliberate mistakes
//
// PAID live run (only after explicit approval; see docs/ASK_KICKER_EVAL.md):
//   requires --live --allow-paid-calls, AI_BRIEFING_MODEL=claude-haiku-5-5, ANTHROPIC_API_KEY in this
//   shell, a loopback Redis shim (ASK_LOCAL_REDIS_URL / ASK_LOCAL_REDIS_TOKEN), and
//   ASK_EVAL_APPROVAL=I-approve-up-to-<max-calls>-paid-calls matching --max-calls (default and maximum 10).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIVE_MAX_CALLS, runEvaluation } from "./ask-eval/run.mjs";
import { worstCaseUsd } from "./ask-eval/scoring.mjs";

const args = process.argv.slice(2);
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const live = args.includes("--live");
const maxCalls = Number(value("--max-calls", "10"));
const store = value("--store", live ? "local-redis" : "memory");
const profile = value("--profile", "good");

function refuse(message) { console.error(`No model call made. ${message}`); process.exit(2); }
if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > LIVE_MAX_CALLS) refuse(`--max-calls must be an integer from 1 to ${LIVE_MAX_CALLS}.`);
if (!["memory", "local-redis"].includes(store)) refuse("--store must be memory or local-redis.");
if (!["good", "flawed"].includes(profile)) refuse("--profile must be good or flawed.");
if (live) {
  const phrase = `I-approve-up-to-${maxCalls}-paid-calls`;
  if (!args.includes("--allow-paid-calls")) refuse("Pass --allow-paid-calls with --live.");
  if (process.env.ASK_EVAL_APPROVAL !== phrase) refuse(`Set ASK_EVAL_APPROVAL=${phrase} after the owner approves.`);
  if (process.env.AI_BRIEFING_MODEL !== "claude-haiku-5-5") refuse("Set AI_BRIEFING_MODEL=claude-haiku-5-5 in this shell (Ask reuses the briefing model).");
  if (!process.env.ANTHROPIC_API_KEY?.trim()) refuse("ANTHROPIC_API_KEY is not set in this shell.");
  if (store !== "local-redis") refuse("Live runs must use --store local-redis.");
  if (!process.env.ASK_LOCAL_REDIS_TOKEN) refuse("Set ASK_LOCAL_REDIS_TOKEN for the disposable local Redis shim.");
  const bound = worstCaseUsd({ calls: maxCalls });
  console.log(`LIVE evaluation: model ${process.env.AI_BRIEFING_MODEL}, at most ${maxCalls} paid calls, worst-case bound $${bound.toFixed(4)}.`);
  console.log("Starting in 5 seconds. Press Ctrl+C to abort; no call has been made yet.");
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

const result = await runEvaluation({
  mode: live ? "live" : "mock", profile, store, maxCalls, approved: live,
  apiKey: live ? process.env.ANTHROPIC_API_KEY.trim() : undefined,
  // Only Ask tuning settings and the shared briefing model/provider flow in.
  env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("AI_ASK_") || key === "AI_BRIEFING_MODEL" || key === "AI_BRIEFING_PROVIDER")),
  redisUrl: process.env.ASK_LOCAL_REDIS_URL ?? "http://127.0.0.1:8079", redisToken: process.env.ASK_LOCAL_REDIS_TOKEN,
  paceMs: store === "memory" ? 21000 : Number(value("--pace-ms", "21000")),
  log: (line) => console.log(`  ${line}`),
});
const stamp = result.json.startedAt.replace(/[:.]/g, "-");
const directory = path.join(process.cwd(), ".ask-eval");
mkdirSync(directory, { recursive: true });
const base = path.join(directory, `${stamp}-${result.json.mode}${result.json.profile ? "-" + result.json.profile : ""}`);
writeFileSync(base + ".md", result.report);
writeFileSync(base + ".json", JSON.stringify(result.json, null, 2));
const verdicts = result.json.scores.map((s) => `${s.id}=${s.verdict}`).join(" ");
console.log(`\n${verdicts} cache-repeat=${result.json.repeat.cacheHit && result.json.repeat.modelCalls === 0 ? "PASS" : "FAIL"}`);
console.log(`${result.json.totals.modelCalls} model calls, ${result.json.totals.inputTokens} in / ${result.json.totals.outputTokens} out tokens, est. $${result.json.totals.cost.toFixed(6)}`);
console.log(`Report: ${base}.md`);
