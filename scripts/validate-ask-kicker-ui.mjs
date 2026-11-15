// Real AskKicker + AiNewsBriefing components in headless Chrome (raw DevTools Protocol,
// matching scripts/validate-ai-briefing-ui.mjs). Every /api/ai/* request is paused at
// the NETWORK layer and fulfilled by this script, so nothing reaches the dev server,
// Anthropic, Redis or Supabase. Answer fixtures are built with the real backend
// validator from synthetic metadata. No paid calls. Run: node scripts/validate-ask-kicker-ui.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import path from "node:path";
import { createAskSnapshot, createAskTools } from "../lib/ai/ask-retrieval.ts";
import { validateAskAnswer } from "../lib/ai/ask-answer.ts";
import { ASK_NOW, askArticles } from "../tests/fixtures/ask-news.mjs";
import { editorialArticles } from "../tests/fixtures/briefing-editorial.mjs";

const root = process.cwd();
const port = 3103;
const origin = `http://127.0.0.1:${port}`;
const fixtureDir = path.join(root, "app", "ask-ui-validation");
const fixturePath = path.join(fixtureDir, "page.tsx");
const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
assert.ok(existsSync(chrome), "Set CHROME_PATH to an installed Chrome executable");
assert.ok(!existsSync(fixtureDir), "Refusing to overwrite an existing fixture");

// ---- Fixtures produced by the real Stage A tools + Stage B citation validator ----
const snapshot = createAskSnapshot(askArticles, ASK_NOW);
const degraded = createAskSnapshot(askArticles, ASK_NOW, { failedFeeds: 2, staleFeeds: 1 });
function answered(source = snapshot) {
  const result = createAskTools(source).search_articles({ query: "artificial intelligence", mode: "publishers" });
  const id = (key) => result.articles.find((article) => article.link.endsWith("/" + key)).id;
  return validateAskAnswer({ status: "answered", clarification: null, statements: [
    { text: "Wire Desk and Public Radio both report that Nvidia announced a new chip for artificial intelligence computing.", articleIds: [id("nvidia-wire"), id("nvidia-radio")] },
    { text: "Public Radio's summary adds that deliveries of the chip are planned for December.", articleIds: [id("nvidia-radio")] },
    { text: "Separately, schools have published guidance on using artificial intelligence in classrooms.", articleIds: [id("ai-schools")] },
  ] }, result);
}
const empty = createAskTools(snapshot).search_articles({ query: "volcanic eruption" });
const recent = createAskTools(snapshot).recent_news({});
const ANSWERS = {
  answered: answered(),
  no_results: validateAskAnswer({ status: "no_results", statements: [], clarification: null }, empty),
  needs_clarification: validateAskAnswer({ status: "needs_clarification", statements: [], clarification: "Which company do you mean?" }, recent),
  unsupported: validateAskAnswer({ status: "unsupported", statements: [], clarification: null }, recent),
  degraded: (() => { const a = answered(degraded); return { ...a, coverage: { ...a.coverage, resultsTruncated: true } }; })(),
};
// Bypasses backend validation on purpose to prove the UI escapes hostile text itself.
const hostile = structuredClone(ANSWERS.answered);
hostile.statements[0].text = `<img src=x onerror="window.__xss=1">Injected <b>markup</b>`;
hostile.statements[0].citations[0].title = `<script>window.__xss=2</script>Hostile title`;
hostile.statements[1].citations[0].url = "javascript:window.__xss=3";
ANSWERS.hostile = hostile;
const fixtureLinks = new Set(askArticles.map((article) => article.link));
const success = (answer, cacheHit = false) => {
  const generatedAt = new Date().toISOString();
  return { answer, generatedAt, expiresAt: new Date(Date.now() + 300000).toISOString(), cacheHit,
    modelRequests: cacheHit ? 0 : 2, toolExecutions: cacheHit ? 0 : 1, usage: cacheHit ? null : { inputTokens: 900, outputTokens: 120, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } };
};
const briefing = { briefing: { generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(),
  notice: "AI-generated summaries based on available publisher metadata, not full-article analysis.",
  items: editorialArticles.slice(0, 5).map((article, index) => ({ headline: article.title, explanation: article.summary,
    references: [{ source: article.source, title: article.title, url: `https://example.com/brief-${index}` }] })) }, cacheHit: true };

mkdirSync(fixtureDir);
writeFileSync(fixturePath, `"use client";
import { useEffect, useState } from "react";
import { AiHub } from "@/components/AiHub";
// The real AI Hub composition (Ask Kicker first, then the briefing) inside the
// dashboard's page wrapper; the News Feed lives in its own tab panel.
export default function Page() {
  useEffect(() => { document.documentElement.dataset.askFixtureReady = "true"; }, []);
  const [key, setKey] = useState(0);
  return <main className="mx-auto flex w-full flex-1 flex-col px-3 py-4 sm:px-6 lg:px-7 lg:py-5">
    <button id="reset-fixture" hidden onClick={() => setKey(key + 1)}>Reset</button>
    <AiHub key={key} askKickerEnabled briefingEnabled />
  </main>;
}
`);

let server, browser, socket, nextId = 0, serverLog = "";
const pending = new Map();
const errors = [];
const askQueue = [];
const askLog = [];
const created = [];
let briefingCalls = 0;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch {}
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
function cdp(method, params = {}) {
  const id = ++nextId;
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
  });
  socket.send(JSON.stringify({ id, method, params })); return result;
}
async function js(expression) {
  const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
function fulfill(requestId, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const responseHeaders = Object.entries({ "Content-Type": typeof body === "string" ? "text/html" : "application/json",
    "Cache-Control": "private, no-store", ...headers }).map(([name, value]) => ({ name, value: String(value) }));
  return cdp("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders, body: Buffer.from(text).toString("base64") });
}
async function nextAsk() { await until(() => askQueue.length > 0, "an intercepted Ask request"); return askQueue.shift(); }
async function key(keyName, { code = keyName, vk, text, modifiers = 0 } = {}) {
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: keyName, code, windowsVirtualKeyCode: vk, text, modifiers });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code, windowsVirtualKeyCode: vk, modifiers });
}
const enter = () => key("Enter", { vk: 13, text: "\r" });
const tab = (shift = false) => key("Tab", { vk: 9, modifiers: shift ? 8 : 0 });
const state = () => js("__askState()");
const active = () => js("__describe(document.activeElement)");
async function ask(question) { await js(`__setQuestion(${JSON.stringify(question)})`); await js("__askSubmit().click()"); return nextAsk(); }
async function expectState(expected) { await until(async () => (await state()) === expected, `state ${expected}`); }
const pass = (message) => console.log(`PASS ${message}`);

try {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    // Process env wins over .env.local: the real AI routes stay disabled even if reached.
    env: { ...process.env, AI_BRIEFING_ENABLED: "false" } /* shared AI switch off: no real AI route can run */,
  });
  server.stdout.on("data", (data) => { serverLog += data; });
  server.stderr.on("data", (data) => { serverLog += data; });
  await until(async () => (await fetch(origin + "/ask-ui-validation", { signal: AbortSignal.timeout(20000) })).ok, "fixture server", 180000)
    .catch((error) => { throw new Error(`${error.message}\n${serverLog.slice(-3000)}`); });
  browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=9314",
    `--user-data-dir=${path.join(root, ".next", "ask-browser-" + Date.now())}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  const target = await until(async () => (await (await fetch("http://127.0.0.1:9314/json/list")).json()).find((item) => item.type === "page"), "Chrome");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id); pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    }
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      if (request.url.includes("/api/ai/ask")) { askQueue.push({ requestId, request }); askLog.push(request); }
      else if (request.url.includes("/api/ai/briefing")) { briefingCalls++; void fulfill(requestId, 200, briefing); }
      else void cdp("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
    }
    if (["Target.targetCreated", "Target.targetInfoChanged"].includes(message.method) && message.params.targetInfo.type === "page") created.push(message.params.targetInfo);
    if (message.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(message.params.exceptionDetails));
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      const text = message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ");
      errors.push(text); // any console.error fails the run
    }
  };
  await cdp("Runtime.enable"); await cdp("Page.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/ai/*", requestStage: "Request" }] });
  await cdp("Target.setDiscoverTargets", { discover: true });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__askRoot = () => [...document.querySelectorAll('h2')].find(h => h.textContent === 'Ask Kicker AI')?.closest('section');
    window.__askInput = () => __askRoot().querySelector('input[name=question]');
    window.__askSubmit = () => __askRoot().querySelector('button[type=submit]');
    window.__askState = () => __askRoot()?.querySelector('[data-ask-state]')?.dataset.askState;
    window.__live = () => __askRoot().querySelector('[role=status][aria-live=polite]').textContent;
    window.__text = () => __askRoot().textContent;
    window.__button = (label) => [...__askRoot().querySelectorAll('button')].find(b => b.textContent.trim() === label);
    window.__setQuestion = (text) => { const input = __askInput();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true })); };
    window.__describe = (el) => el ? (el.tagName + ':' + (el.getAttribute('name') || el.textContent.trim().slice(0, 40))) : 'none';` });
  await cdp("Page.navigate", { url: origin + "/ask-ui-validation" });
  await until(() => js("document.documentElement.dataset.askFixtureReady === 'true' && Boolean(__askRoot())"), "hydrated components", 60000);

  // A. Initial render, labels and description
  assert.equal(await js("__askRoot().querySelector('h2').textContent"), "Ask Kicker AI");
  assert.ok(await js("__text().includes('news article metadata') && __text().includes('read full articles')"), "metadata description");
  assert.equal(await js("__askInput().labels[0].textContent"), "Your question for Ask Kicker AI");
  assert.ok(await js("__askInput().getAttribute('aria-describedby').split(' ').every(id => document.getElementById(id))"));
  assert.equal(await js("__askRoot().querySelector('form').getAttribute('aria-label')"), "Ask Kicker AI a question");
  assert.equal(await js("__askSubmit().getAttribute('aria-disabled')"), "true", "empty question cannot submit");
  assert.equal(await js("__askRoot().querySelectorAll('ul[aria-labelledby] button').length"), 3);
  assert.equal(await state(), "idle");
  assert.ok(await js("__askRoot().compareDocumentPosition(document.querySelector('[aria-label=\"AI news briefing\"]')) & Node.DOCUMENT_POSITION_FOLLOWING"), "Ask Kicker comes before the briefing");
  await js("__askSubmit().click()"); await enter(); await delay(300);
  assert.equal(askLog.length, 0, "empty submit never sends a request");
  assert.ok(await js("__text().includes('Type a question first.')"));
  pass("heading, metadata description, accessible label/description, three examples, Ask first in the AI Hub, empty-input guard; no request on load");

  // B. Example questions populate (never submit)
  await js("__askRoot().querySelectorAll('ul[aria-labelledby] button')[1].click()");
  assert.equal(await js("__askInput().value"), "How are publishers covering Nvidia?");
  assert.equal(await active(), "INPUT:question"); await delay(200); assert.equal(askLog.length, 0);
  pass("example question populates and focuses the input without sending");

  // C. Keyboard submission, loading state, duplicate prevention, success rendering
  await js("__setQuestion('')"); await js("__askInput().focus()");
  const QUESTION = "What are publishers reporting about artificial intelligence?";
  await cdp("Input.insertText", { text: QUESTION });
  assert.equal(await js("__askSubmit().getAttribute('aria-disabled')"), "false");
  await enter();
  const first = await nextAsk();
  assert.equal(first.request.method, "POST");
  assert.equal(new URL(first.request.url).pathname, "/api/ai/ask"); assert.equal(new URL(first.request.url).search, "");
  assert.equal(first.request.postData, JSON.stringify({ question: QUESTION }), "body contains only the question");
  assert.match(Object.entries(first.request.headers).find(([name]) => name.toLowerCase() === "content-type")[1], /^application\/json$/);
  await expectState("loading");
  assert.equal(await js("__askSubmit().getAttribute('aria-disabled')"), "true");
  assert.match(await js("__askSubmit().textContent"), /Asking/);
  assert.ok(await js("__askRoot().querySelector('[aria-busy=true]') !== null"));
  assert.match(await js("__live()"), /Asking Kicker/);
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await js("getComputedStyle(__askSubmit().querySelector('span[aria-hidden]')).animationName"), "none", "spinner respects reduced motion");
  await cdp("Emulation.setEmulatedMedia", { features: [] });
  await enter(); await enter(); await js("__askSubmit().click(); __askSubmit().click()"); await delay(400);
  assert.equal(askLog.length, 1, "duplicate submissions are blocked while loading");
  const fresh = success(ANSWERS.answered);
  await fulfill(first.requestId, 200, fresh);
  await expectState("answered");
  assert.equal(await js("__askRoot().querySelectorAll('article ul[aria-label=\"Answer\"] > li').length"), 3);
  assert.equal(await js("__askRoot().querySelector('article h3').textContent"), QUESTION, "the question heads the answer");
  const links = await js("[...__askRoot().querySelectorAll('article a')].map(a => ({ href: a.href, target: a.target, rel: a.rel, text: a.textContent }))");
  assert.equal(links.length, 7, "4 inline source markers + 3 distinct sources");
  for (const link of links) {
    assert.ok(fixtureLinks.has(link.href), link.href); assert.equal(link.target, "_blank");
    assert.ok(link.rel.includes("noopener") && link.rel.includes("noreferrer")); assert.ok(link.text.includes("(opens in a new tab)"));
  }
  assert.ok(await js("[...__askRoot().querySelectorAll('article [role=group][aria-label^=\"Sources for statement\"]')].every((group, i) => group.getAttribute('aria-label') === 'Sources for statement ' + (i + 1))"));
  assert.deepEqual(await js("[...__askRoot().querySelectorAll('article [role=group] a')].map(a => a.textContent.match(/^Source (\\d+)/)[1])"), ["1", "2", "2", "3"], "statement markers reuse source numbers");
  const sourceList = await js("[...__askRoot().querySelectorAll('article section ol > li')].map(li => li.textContent)");
  assert.equal(sourceList.length, 3, "each cited article is listed once");
  const listed = await js("[...__askRoot().querySelectorAll('article section ol > li a')].map(a => a.href)");
  assert.equal(new Set(listed).size, 3);
  assert.equal(await js(`__askRoot().querySelector('article p time').getAttribute('datetime')`), fresh.generatedAt);
  assert.equal(await js("__askRoot().querySelector('[data-ask-cache]').textContent"), "Fresh answer");
  assert.ok(await js(`__text().includes(${JSON.stringify(QUESTION)}) && __text().includes('RSS coverage is incomplete') && __text().includes('Citations are not factual verification')`));
  assert.ok(await js("[...__askRoot().querySelectorAll('article p')].some(p => p.textContent.includes('not full-article analysis') && !p.closest('details') && p.getBoundingClientRect().height > 0)"), "metadata-only disclaimer is visible");
  assert.ok(await js("__askRoot().querySelector('[aria-label=\"Coverage used for this answer\"]').querySelectorAll('time').length === 3"), "available window + checked time");
  assert.ok(await js(`__text().includes('Past 24 hours') && __text().includes('Articles available${snapshot.articles.length}')`));
  assert.equal(await js("__askRoot().querySelector('article details').open"), false, "technical details start collapsed");
  assert.equal(await js("__askRoot().querySelector('article details summary').textContent.trim()"), "About this answer");
  assert.equal(await js("Boolean(__askRoot().querySelector('[aria-label=\"Coverage warnings\"]'))"), false, "no warnings when coverage is complete");
  await js("__askRoot().querySelector('article details summary').click()");
  assert.ok(await js("__askRoot().querySelector('[aria-label=\"Coverage used for this answer\"]').getBoundingClientRect().height > 0"), "About this answer expands");
  await js("__askRoot().querySelector('article details summary').click()");
  assert.match(await js("__live()"), /Answer ready with 3 statements and 4 citations\./);
  pass("Enter submits; POST body is only {question}; loading/aria-busy/disabled state; reduced-motion spinner; duplicate clicks/Enter blocked");
  pass("answer: question heading, 3 prose statements with numbered source links, 3 deduplicated sources (new tab, noopener), visible disclaimer, collapsed 'About this answer' with coverage dates");

  // D. Citation link opens a new tab and keeps the dashboard in place
  const before = created.length;
  // A real mouse click (user gesture), so popup blocking cannot mask a broken link.
  const point = await js("(() => { const a = __askRoot().querySelector('article a'); a.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = a.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
  for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
  const opened = await until(() => created.slice(before).find((info) => fixtureLinks.has(info.url)), "citation tab", 10000)
    .catch((error) => { throw new Error(`${error.message}; clicked ${JSON.stringify(point)}; targets ${JSON.stringify(created.slice(before).map((info) => info.url))}`); });
  assert.equal(await js("location.pathname"), "/ask-ui-validation");
  await cdp("Target.closeTarget", { targetId: opened.targetId });
  pass("clicking a citation opens the publisher URL in a new tab; dashboard stays put");

  // E. Re-asking the same question reuses the private answer locally
  await js("__askSubmit().click()"); await delay(400);
  assert.equal(askLog.length, 1, "no request spent on an identical, unexpired question");
  assert.equal(await js("__askRoot().querySelector('[data-ask-cache]').textContent"), "Saved answer (no new AI request)");
  assert.match(await js("__live()"), /No new request was needed/);
  pass("identical unexpired question reuses the answer without spending a rate-limited request");

  // F-K. Server cache label, other statuses, degraded coverage, hostile text
  let request = await ask("Summarize today's economy news");
  await fulfill(request.requestId, 200, success(ANSWERS.answered, true)); await expectState("answered");
  assert.equal(await js("__askRoot().querySelector('[data-ask-cache]').textContent"), "Saved answer (no new AI request)");
  assert.match(await js("__live()"), /saved answer; no new AI request/);
  request = await ask("Any volcanic eruption news?");
  await fulfill(request.requestId, 200, success(ANSWERS.no_results)); await expectState("no_results");
  assert.ok(await js("__text().includes('No matching coverage found') && __text().includes('matches keywords, not meanings')"));
  assert.ok(await js("Boolean(__askRoot().querySelector('[aria-label=\"Coverage used for this answer\"]')) && !__askRoot().querySelector('article [aria-label=\"Answer\"]') && !__askRoot().querySelector('article ol')"));
  const CLARIFY = "What did the company announce?";
  request = await ask(CLARIFY);
  await fulfill(request.requestId, 200, success(ANSWERS.needs_clarification)); await expectState("needs_clarification");
  assert.ok(await js("__text().includes('Which company do you mean?')"));
  await js("__button('Edit your question').click()");
  assert.equal(await active(), "INPUT:question");
  assert.deepEqual(await js("[__askInput().value, __askInput().selectionStart, __askInput().selectionEnd]"), [CLARIFY, 0, CLARIFY.length]);
  request = await ask("Write my investment plan");
  await fulfill(request.requestId, 200, success(ANSWERS.unsupported)); await expectState("unsupported");
  assert.ok(await js("__text().includes('outside what Ask Kicker can answer') && !__askRoot().querySelector('[aria-label=\"Coverage used for this answer\"]')"));
  request = await ask("AI coverage with feed problems?");
  await fulfill(request.requestId, 200, success(ANSWERS.degraded)); await expectState("answered");
  const warnings = await js("[...__askRoot().querySelectorAll('[aria-label=\"Coverage warnings\"] li')].map(li => li.textContent)");
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /2 news feeds could not be loaded/); assert.match(warnings[1], /1 feed used a recently cached copy/); assert.match(warnings[2], /More articles matched/);
  assert.ok(await js("(() => { const list = __askRoot().querySelector('[aria-label=\"Coverage warnings\"]'); return !list.closest('details') && list.getBoundingClientRect().height > 0; })()"), "incomplete-coverage warnings stay visible outside 'About this answer'");
  request = await ask("Hostile metadata test");
  await fulfill(request.requestId, 200, success(ANSWERS.hostile)); await expectState("answered");
  assert.equal(await js("__askRoot().querySelectorAll('article img, article b, article script').length"), 0);
  assert.ok(await js("__text().includes('<img src=x') && __text().includes('<script>window.__xss=2</script>Hostile title')"));
  // The tampered citation (same article, javascript: URL) becomes its own unlinked source: 3 linked markers + 3 linked list entries.
  assert.equal(await js("__askRoot().querySelectorAll('article a').length"), 6, "javascript: citation is not rendered as a link");
  assert.ok(await js("[...__askRoot().querySelectorAll('article a')].every(a => a.protocol === 'https:')"));
  assert.equal(await js("typeof window.__xss"), "undefined");
  pass("server cache label, no-results tips + coverage, clarification with edit focus/selection, unsupported scope, degraded-coverage warnings");
  pass("hostile statement/title text renders inert; javascript: citation URL is not linked");

  // L. Rate limits, busy, provider and other failures
  async function failure(question, status, body, headers, kind, titlePart) {
    const req = await ask(question);
    if (status === 0) await cdp("Fetch.failRequest", { requestId: req.requestId, errorReason: "InternetDisconnected" });
    else await fulfill(req.requestId, status, body, headers);
    await expectState("error");
    assert.equal(await js("__askRoot().querySelector('[role=alert]').dataset.askFailure"), kind, `${status} ${JSON.stringify(body)}`);
    assert.ok(await js(`__askRoot().querySelector('[role=alert]').textContent.includes(${JSON.stringify(titlePart)})`), titlePart);
    assert.doesNotMatch(await js("__text()"), /redis|lease|provider-|invalid-citation|tool-unavailable|generation-budget|undefined|NaN/i);
    assert.match(await js("__live()"), new RegExp(titlePart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const err = (code) => ({ error: "Ask Kicker is unavailable right now. Please try again later.", ...(code ? { code } : {}) });
  await failure("Rate limit test", 429, err("request-limit"), { "Retry-After": 2 }, "rate-limited", "You're asking quickly");
  assert.ok(await js("__text().includes('in 2 seconds')"));
  assert.equal(await js("__askSubmit().getAttribute('aria-disabled')"), "true"); assert.match(await js("__askSubmit().textContent"), /Wait \ds/);
  const sent = askLog.length; await js("__askInput().focus()"); await enter(); await js("__button('Try again').click()"); await delay(300);
  assert.equal(askLog.length, sent, "blocked during Retry-After");
  await until(async () => (await js("__askSubmit().getAttribute('aria-disabled')")) === "false", "rate-limit countdown ends", 6000);
  assert.match(await js("__live()"), /You can ask Ask Kicker a question again/);
  await failure("Daily limit test", 429, err("request-limit"), { "Retry-After": 40000 }, "daily-limit", "Daily question limit reached");
  assert.equal(await js("__askSubmit().getAttribute('aria-disabled')"), "false"); assert.equal(await js("Boolean(__button('Try again'))"), false);
  await failure("Budget test", 429, err("generation-budget"), { "Retry-After": 40000 }, "budget", "Today's AI capacity is used up");
  await failure("Busy test", 409, err("busy"), { "Retry-After": 1 }, "busy", "Ask Kicker is busy");
  await until(async () => (await js("__askSubmit().getAttribute('aria-disabled')")) === "false", "busy countdown ends", 5000);
  await js("__button('Try again').click()");
  request = await nextAsk();
  assert.equal(request.request.postData, JSON.stringify({ question: "Busy test" }), "retry resends the same question");
  await fulfill(request.requestId, 200, success(ANSWERS.answered)); await expectState("answered");
  await failure("Provider failure test", 503, err("provider-error"), { "Retry-After": 10 }, "provider", "AI service unavailable");
  await failure("Feed failure test", 503, err("tool-unavailable"), { "Retry-After": 10 }, "feeds", "News feeds are unavailable");
  await failure("Citation failure test", 503, err("invalid-citation"), { "Retry-After": 10 }, "unverified", "No verified answer this time");
  await failure("Deadline test", 504, err("deadline"), { "Retry-After": 10 }, "timeout", "Ask Kicker took too long");
  await failure("Session test", 401, { error: "Sign in to use Ask Kicker." }, {}, "session", "Your session has expired");
  assert.equal(await js("Boolean(__button('Try again'))"), false);
  await failure("Origin test", 403, { error: "Request origin is not allowed." }, {}, "blocked", "Request blocked");
  await failure("Invalid test", 400, err("invalid-request"), {}, "invalid", "We couldn't read that question");
  assert.ok(await js("Boolean(__button('Edit your question'))"));
  await failure("Disabled test", 503, { error: "Ask Kicker is unavailable." }, {}, "unavailable", "Ask Kicker is unavailable");
  await failure("Offline test", 0, null, {}, "network", "Connection problem");
  await failure("HTML error test", 502, "<html><body>Bad gateway</body></html>", {}, "unavailable", "Ask Kicker is unavailable");
  await failure("Malformed test", 200, { answer: {} }, {}, "unavailable", "unexpected response");
  pass("rate limit (countdown blocks submit + Try again, announces re-enable), daily limit, AI budget, busy with working retry");
  pass("provider, feed, citation-validation, deadline, session, origin, invalid, disabled, offline, HTML and malformed responses; no raw codes shown");

  // M. Keyboard navigation through the whole panel
  request = await ask(QUESTION + " (keyboard)");
  await fulfill(request.requestId, 200, success(ANSWERS.answered)); await expectState("answered");
  await js("__askInput().focus()");
  const order = [];
  for (let i = 0; i < 4; i++) { await tab(); order.push(await active()); }
  assert.deepEqual(order.slice(0, 2), ["BUTTON:Ask", "BUTTON:New question"], "examples are hidden once an answer is shown");
  assert.match(order[2], /^A:Source 1/, "keyboard reaches the first inline source");
  assert.match(order[3], /^A:Source 2/);
  await tab(true); await tab(true); assert.equal(await active(), "BUTTON:New question");
  await enter();
  await expectState("idle"); assert.equal(await js("__askInput().value"), ""); assert.equal(await active(), "INPUT:question");
  const idleOrder = [];
  for (let i = 0; i < 4; i++) { await tab(); idleOrder.push(await active()); }
  assert.deepEqual(idleOrder, ["BUTTON:Ask", "BUTTON:What's the latest on AI?", "BUTTON:How are publishers covering Nvidia?", "BUTTON:Summarize today's economy news"]);
  await js("__askRoot().querySelectorAll('ul[aria-labelledby] button')[0].focus()"); await key(" ", { code: "Space", vk: 32 });
  assert.equal(await js("__askInput().value"), "What's the latest on AI?"); assert.equal(await active(), "INPUT:question");
  pass("Tab order input → Ask → New question → inline sources; Enter on New question resets and refocuses; idle order input → Ask → examples; Space selects example");

  // N. Responsive layout at phone, tablet and desktop widths (with screenshots for review)
  request = await ask("How are publishers covering artificial intelligence developments across technology and education this week?");
  await fulfill(request.requestId, 200, success(ANSWERS.degraded)); await expectState("answered");
  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
    await delay(150);
    assert.ok(await js("document.documentElement.scrollWidth <= window.innerWidth"), `horizontal overflow at ${width}px`);
    assert.ok(await js("__askInput().getBoundingClientRect().height >= 44 && __askSubmit().getBoundingClientRect().height >= 44"), `input/submit target at ${width}`);
    assert.ok(await js("[...__askRoot().querySelectorAll('article section ol a')].every(a => a.getBoundingClientRect().height >= 44)"), `source list targets at ${width}`);
    // Inline markers sit inside prose: WCAG 2.2 target size (minimum) 24×24 CSS px; the list above offers 44px targets.
    assert.ok(await js("[...__askRoot().querySelectorAll('article [role=group] a')].every(a => { const r = a.getBoundingClientRect(); return r.height >= 24 && r.width >= 24; })"), `inline source targets at ${width}`);
    assert.ok(await js("__askRoot().querySelector('article details summary').getBoundingClientRect().height >= 44"), `details summary target at ${width}`);
    assert.ok(await js("__askRoot().getBoundingClientRect().width <= 768"), `reading width at ${width}`);
    assert.ok(await js("__askSubmit().getBoundingClientRect().right <= __askRoot().getBoundingClientRect().right"), `submit fits at ${width}`);
    const box = await js("(() => { const r = __askRoot().getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height }; })()");
    const shot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...box, scale: 1 } });
    writeFileSync(path.join(root, ".next", `ask-review-${width}.png`), Buffer.from(shot.data, "base64"));
  }
  for (const width of [390, 1440]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
    request = await ask(`Loading screenshot ${width}`); await expectState("loading"); await delay(150);
    let box = await js("(() => { const r = __askRoot().getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height }; })()");
    writeFileSync(path.join(root, ".next", `ask-review-loading-${width}.png`), Buffer.from((await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...box, scale: 1 } })).data, "base64"));
    await fulfill(request.requestId, 429, err("request-limit"), { "Retry-After": 1 }); await expectState("error"); await delay(150);
    box = await js("(() => { const r = __askRoot().getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height }; })()");
    writeFileSync(path.join(root, ".next", `ask-review-error-${width}.png`), Buffer.from((await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...box, scale: 1 } })).data, "base64"));
    await delay(1300);
  }
  await cdp("Emulation.clearDeviceMetricsOverride");
  pass("320/375/390/768/1024/1440px: no horizontal overflow, ≥44px input/submit/source list/details, ≥24px inline source markers, ≤768px reading width; screenshots saved");

  // O. The AI Briefing on the same dashboard still works independently
  const askBefore = askLog.length;
  const briefingButton = "document.querySelector('button[aria-controls=\"ai-briefing-content\"]')";
  await js(`${briefingButton}.click()`);
  await until(() => js("document.querySelectorAll('#ai-briefing-content h3').length === 5"), "briefing items");
  assert.equal(briefingCalls, 1); assert.equal(askLog.length, askBefore, "briefing does not trigger Ask");
  request = await ask("Briefing coexistence question");
  await fulfill(request.requestId, 200, success(ANSWERS.answered)); await expectState("answered");
  assert.equal(await js("document.querySelectorAll('#ai-briefing-content h3').length"), 5); assert.equal(briefingCalls, 1);
  assert.equal(await js(`${briefingButton}.textContent`), "Hide AI Briefing");
  pass("AI Briefing opens, loads and stays intact alongside Ask Kicker; neither triggers the other's request");

  assert.deepEqual(errors, [], "no hydration/runtime errors");
  assert.doesNotMatch(serverLog, /\/api\/ai\//, "no AI request reached the dev server");
  console.log(`PASS no hydration/runtime errors; ${askLog.length} Ask and ${briefingCalls} briefing requests were all intercepted in the browser; zero reached the server or a provider`);
} finally {
  socket?.close(); browser?.kill(); server?.kill();
  if (existsSync(fixturePath)) unlinkSync(fixturePath);
  if (existsSync(fixtureDir)) rmdirSync(fixtureDir);
  for (const filename of ["validator.ts", "routes.d.ts"]) {
    const generated = path.join(root, ".next", "dev", "types", filename);
    if (existsSync(generated) && readFileSync(generated, "utf8").includes("ask-ui-validation")) unlinkSync(generated);
  }
}
