import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import * as settings from "../../lib/ai/ask-settings.ts";
import * as answer from "../../lib/ai/ask-answer.ts";
import * as retrieval from "../../lib/ai/ask-retrieval.ts";
import * as contract from "../../lib/ai/ask.ts";
import { ASK_NOW, askArticles } from "../fixtures/ask-news.mjs";
import { loadAiModule } from "./load-ai-module.mjs";

export function backendWithRetrieval(boundary = retrieval) {
  const workflow = loadAiModule("../../lib/ai/ask-service.ts", {
    "./ask-answer.ts": answer, "./ask.ts": contract, "./ask-retrieval.ts": boundary,
    "@anthropic-ai/sdk/lib/transform-json-schema": { transformJSONSchema },
  }, { AbortController, setTimeout, clearTimeout });
  return loadAiModule("../../lib/ai/ask-backend.ts", {
    "./ask-answer.ts": answer, "./ask.ts": contract, "./ask-service.ts": workflow, "./ask-settings.ts": settings,
  });
}
export const backend = backendWithRetrieval();
export const snapshot = retrieval.createAskSnapshot(askArticles, ASK_NOW);
export const config = settings.readAskConfig({ AI_BRIEFING_MODEL: "claude-haiku-5-5" });

// An independent in-memory storage double for orchestration tests. This models
// atomic admission/accounting, not a Lua interpreter or real Redis verification.
export function memoryStore() {
  let now = ASK_NOW.getTime();
  let day = Math.floor(now / 86400000);
  const users = new Map(), ips = new Map(), active = new Map(), reservations = new Map(), cache = new Map();
  // requests = all admitted (uncapped globally); generations = global cache-miss cap.
  const stats = { attempts: 0, pending: 0, tokens: 0, reservedTokens: 0, requests: 0, generations: 0, reserves: 0, starts: 0, finishes: 0 };
  const checkDay = () => {
    const next = Math.floor(now / 86400000);
    if (next !== day) { day = next; stats.requests = stats.generations = stats.attempts = stats.pending = stats.tokens = stats.reservedTokens = 0; }
  };
  const validLease = (user, owner) => active.get(owner)?.user === user && active.get(owner).expires > now;
  const store = {
    async admit(user, ip, owner) {
      checkDay();
      for (const [key, value] of active) if (value.expires <= now) active.delete(key);
      if ([...active.values()].some(value => value.user === user) || active.size >= 2) throw new settings.AskBackendError("busy", 409, 3);
      const state = users.get(user) ?? { day, requests: 0, times: [] };
      if (state.day !== day) { state.day = day; state.requests = 0; }
      state.times = state.times.filter(time => time > now - 60000);
      const ipTimes = (ips.get(ip) ?? []).filter(time => time > now - 60000);
      if (state.requests >= 10 || state.times.length >= 3 || ipTimes.length >= 5) throw new settings.AskBackendError("request-limit", 429, 60);
      state.requests++; state.times.push(now); users.set(user, state); ips.set(ip, [...ipTimes, now]); stats.requests++;
      active.set(owner, { user, expires: now + 45000 });
    },
    async getCached(key) { return cache.get(key) ?? null; },
    async reserve(user, owner, limits) {
      checkDay();
      if (!validLease(user, owner) || reservations.has(owner)) throw new settings.AskBackendError("lease-expired", 409, 3);
      const budgets = [settings.ASK_INPUT_RESERVATION + limits.selectionTokens, settings.ASK_INPUT_RESERVATION + limits.answerTokens];
      const total = budgets[0] + budgets[1];
      if (stats.generations >= settings.ASK_DAILY_GENERATIONS || stats.attempts + stats.pending + 2 > limits.dailyAttempts
        || stats.tokens + stats.reservedTokens + total > limits.dailyTokens) throw new settings.AskBackendError("generation-budget", 429, 60);
      stats.generations++; stats.pending += 2; stats.reservedTokens += total; stats.reserves++;
      reservations.set(owner, { day, budgets, next: 0 });
    },
    async start(user, owner) {
      const reservation = reservations.get(owner);
      if (!validLease(user, owner) || !reservation || reservation.day !== Math.floor(now / 86400000) || reservation.next >= 2) throw new settings.AskBackendError("lease-expired", 409, 3);
      const tokens = reservation.budgets[reservation.next++];
      stats.starts++; stats.attempts++; stats.pending--; stats.tokens += tokens; stats.reservedTokens -= tokens;
    },
    async finish(user, owner, key, value) {
      stats.finishes++;
      const reservation = reservations.get(owner);
      if (reservation && reservation.day === day) {
        const unused = reservation.budgets.slice(reservation.next);
        stats.pending -= unused.length; stats.reservedTokens -= unused.reduce((sum, number) => sum + number, 0);
      }
      reservations.delete(owner);
      const owned = validLease(user, owner);
      active.delete(owner);
      if (value !== undefined && !owned) throw new settings.AskBackendError("lease-expired", 409, 3);
      if (value !== undefined) cache.set(key, structuredClone(value));
    },
  };
  return { store, stats, active, cache, reservations, advance: ms => { now += ms; }, now: () => now };
}

export function providerFixture({ selected = "search_articles", args = { query: "Nvidia", mode: "publishers" }, status = "answered", failAt, invalidId } = {}) {
  let calls = 0;
  const provider = async () => {
    calls++;
    if (calls === failAt) throw new Error("PRIVATE credential, question and response");
    const usage = { input_tokens: 100, output_tokens: 30 };
    if (calls % 2 === 1) return { type: "message", role: "assistant", stop_reason: "tool_use", usage,
      content: [{ type: "tool_use", name: selected, input: args, id: "toolu_fixture" }] };
    const found = retrieval.createAskTools(snapshot)[selected](args);
    return { type: "message", role: "assistant", stop_reason: "end_turn", usage, content: [{ type: "text", text: JSON.stringify({
      status, statements: status === "answered" ? [{ text: "Publishers report Nvidia announced an AI chip.", articleIds: [invalidId ?? found.articles[0].id] }] : [],
      clarification: status === "needs_clarification" ? "Which company?" : null,
    }) }] };
  };
  return { provider, calls: () => calls };
}
export function backendInput(memory, provider, overrides = {}) {
  return { userId: "user-1", ip: "192.0.2.1", question: "Nvidia news?", config, store: memory.store,
    load: async () => ({ snapshot }), provider, now: memory.now,
    cleanupSignal: new AbortController().signal, workSignal: new AbortController().signal,
    workEndsAt: Date.now() + 28000, ...overrides };
}
