// Real DashboardView (News Feed / AI Hub sections) in headless Chrome over the raw
// DevTools Protocol, matching the other validate-*-ui scripts. Every /api/* and
// Supabase request is intercepted in the browser: nothing reaches the dev server's
// AI routes, Anthropic, Redis, Supabase or a publisher. No sign-in, no paid calls.
// Run: node scripts/validate-dashboard-ui.mjs   (set CHROME_PATH if Chrome is elsewhere)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { createAskSnapshot, createAskTools } from "../lib/ai/ask-retrieval.ts";
import { validateAskAnswer } from "../lib/ai/ask-answer.ts";
import { ASK_NOW, askArticles } from "../tests/fixtures/ask-news.mjs";

const root = process.cwd();
const port = 3104;
const origin = `http://127.0.0.1:${port}`;
const route = "/dashboard-ui-validation";
const fixtureDir = path.join(root, "app", "dashboard-ui-validation");
const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
assert.ok(existsSync(chrome), "Set CHROME_PATH to an installed Chrome executable");
assert.ok(!existsSync(fixtureDir), "Refusing to overwrite an existing fixture");

// Answer fixture built by the real retrieval tools + citation validator from synthetic metadata.
const answerResult = (() => {
  const result = createAskTools(createAskSnapshot(askArticles, ASK_NOW)).search_articles({ query: "artificial intelligence", mode: "publishers" });
  const id = (key) => result.articles.find((article) => article.link.endsWith("/" + key)).id;
  const answer = validateAskAnswer({ status: "answered", clarification: null, statements: [
    { text: "Wire Desk and Public Radio both report that Nvidia announced a new chip for artificial intelligence computing.", articleIds: [id("nvidia-wire"), id("nvidia-radio")] },
  ] }, result);
  return { answer, generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300000).toISOString(), cacheHit: false };
})();

mkdirSync(fixtureDir);
// Server wrapper mirrors app/page.tsx (force-dynamic) so direct links render server-side.
writeFileSync(path.join(fixtureDir, "page.tsx"), `import Fixture from "./fixture";
export const dynamic = "force-dynamic";
export default function Page() {
  return <main className="mx-auto flex w-full flex-1 flex-col px-3 py-4 sm:px-6 lg:px-7 lg:py-5 xl:px-7 2xl:px-8"><Fixture /></main>;
}
`);
writeFileSync(path.join(fixtureDir, "fixture.tsx"), `"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardView } from "@/components/DashboardView";
import type { FeedStatus, NewsItem } from "@/lib/types";
const SOURCES = ["BBC News", "NPR", "The Guardian", "CBS News"];
const TOPICS = ["technology", "business", "science", "health"] as const;
// Fixed timestamps so server and client render identical markup.
const articles: NewsItem[] = Array.from({ length: 24 }, (_, i) => ({
  title: "Fixture story " + (i + 1) + " about " + TOPICS[i % 4] + " developments this week",
  link: "https://example.com/story-" + (i + 1), source: SOURCES[i % 4], category: TOPICS[i % 4],
  summary: "A synthetic summary that is long enough to render like a real publisher description for layout checks.",
  publishedAt: new Date(Date.UTC(2026, 10, 14, 12) - i * 600000).toISOString(), imageUrl: null,
}));
const degraded: FeedStatus = { failedFeeds: 3, staleFeeds: 1, issues: [
  { source: "Gone Wire", topic: "headlines", state: "unavailable", lastSuccessAt: null },
  { source: "Gone Wire", topic: "technology", state: "unavailable", lastSuccessAt: null },
  { source: "BBC News", topic: "science", state: "stale", lastSuccessAt: "2026-11-14T11:40:00.000Z" },
] };
export default function Fixture() {
  const ai = useSearchParams().get("fixture-ai") !== "off";
  const [status, setStatus] = useState<FeedStatus>(degraded);
  useEffect(() => { document.documentElement.dataset.dashboardFixtureReady = "true"; }, []);
  return <>
    <button id="healthy-fixture" hidden onClick={() => setStatus({ failedFeeds: 0, staleFeeds: 0, issues: [] })}>Healthy</button>
    <DashboardView aiBriefingEnabled={ai} askKickerEnabled={ai} articles={articles} feedStatus={status}
      initialAlertKeywords={[]} initialPreferences={null} initialSavedArticles={[]} userEmail="reader@example.test" userId="" />
  </>;
}
`);

let server, browser, socket, nextId = 0, serverLog = "";
const pending = new Map();
const errors = [];
const askQueue = [];
const intercepted = { ask: 0, briefing: 0, news: 0, supabase: 0, other: 0 };
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
function fulfill(requestId, status, body) {
  return cdp("Fetch.fulfillRequest", { requestId, responseCode: status, body: Buffer.from(JSON.stringify(body)).toString("base64"),
    responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Cache-Control", value: "private, no-store" }] });
}
async function key(keyName, vk) {
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: keyName, code: keyName, windowsVirtualKeyCode: vk });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code: keyName, windowsVirtualKeyCode: vk });
}
async function mouseClick(selectorExpression) {
  const point = await js(`(() => { const el = ${selectorExpression}; el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
}
const selected = () => js("document.querySelector('[role=tab][aria-selected=true]')?.id.replace('dashboard-tab-', '')");
async function expectSection(section) {
  await until(async () => (await selected()) === section && await js(`__visible(__panel('${section}')) && !__visible(__panel('${section === "ai" ? "news" : "ai"}'))`), `section ${section}`);
}
const openTag = (html, id) => html.match(new RegExp(`<[a-z]+[^>]*id="${id}"[^>]*>`))?.[0] ?? "";
const pass = (message) => console.log(`PASS ${message}`);

try {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, AI_BRIEFING_ENABLED: "false" } /* shared AI switch off: no real AI route can run */,
  });
  server.stdout.on("data", (data) => { serverLog += data; });
  server.stderr.on("data", (data) => { serverLog += data; });
  await until(async () => (await fetch(origin + route, { signal: AbortSignal.timeout(20000) })).ok, "fixture server", 180000)
    .catch((error) => { throw new Error(`${error.message}\n${serverLog.slice(-3000)}`); });

  // A. Server-rendered HTML already reflects the requested section (no flash, works before JS).
  const newsHtml = await (await fetch(origin + route)).text();
  assert.match(openTag(newsHtml, "dashboard-tab-news"), /aria-selected="true"/);
  assert.match(openTag(newsHtml, "dashboard-panel-ai"), /hidden=""/);
  assert.doesNotMatch(openTag(newsHtml, "dashboard-panel-news"), /hidden=""/);
  const aiHtml = await (await fetch(origin + route + "?view=ai")).text();
  assert.match(openTag(aiHtml, "dashboard-tab-ai"), /aria-selected="true"/);
  assert.match(openTag(aiHtml, "dashboard-panel-news"), /hidden=""/);
  assert.doesNotMatch(openTag(aiHtml, "dashboard-panel-ai"), /hidden=""/);
  pass("server HTML renders the News Feed by default and the AI Hub for ?view=ai");

  browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=9315",
    `--user-data-dir=${path.join(root, ".next", "dashboard-browser-" + Date.now())}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  const target = await until(async () => (await (await fetch("http://127.0.0.1:9315/json/list")).json()).find((item) => item.type === "page"), "Chrome");
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
      if (request.url.includes("/api/ai/ask")) { intercepted.ask++; askQueue.push({ requestId, request }); return; }
      intercepted[request.url.includes("/api/ai/briefing") ? "briefing" : request.url.includes("/api/news") ? "news" : request.url.startsWith(origin) ? "other" : "supabase"]++;
      void cdp("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(message.params.exceptionDetails));
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      errors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    }
  };
  await cdp("Runtime.enable"); await cdp("Page.enable");
  // Narrow patterns: app chunks can contain "supabase"/"api" in their file names.
  await cdp("Fetch.enable", { patterns: [`${origin}/api/*`, "https://*.supabase.co/*", "https://*.supabase.in/*"].map((urlPattern) => ({ urlPattern, requestStage: "Request" })) });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__tab = (id) => document.getElementById('dashboard-tab-' + id);
    window.__panel = (id) => document.getElementById('dashboard-panel-' + id);
    window.__visible = (el) => !!el && !el.hidden && el.getBoundingClientRect().height > 0;
    window.__notice = () => document.querySelector('[data-feed-health]');
    window.__askInput = () => __panel('ai')?.querySelector('input[name=question]');
    window.__setValue = (input, text) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); };` });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: origin + route });
  await until(() => js("document.documentElement.dataset.dashboardFixtureReady === 'true' && Boolean(__tab('news'))"), "hydrated dashboard", 60000)
    .catch(async (error) => { throw new Error(`${error.message}; ready=${await js("document.documentElement.dataset.dashboardFixtureReady")}; errors=${errors.join(" | ").slice(0, 3000)}; body=${(await js("document.body.innerText")).slice(0, 500)}`); });

  // B. Structure and ARIA tabs semantics
  assert.equal(await js("document.querySelector('h1').textContent"), "Kicker News");
  assert.equal(await js("document.querySelector('[role=tablist]').getAttribute('aria-label')"), "Dashboard sections");
  assert.deepEqual(await js("[...document.querySelectorAll('[role=tab]')].map(t => [t.textContent.trim(), t.getAttribute('aria-selected'), t.tabIndex])"), [["News Feed", "true", 0], ["AI Hub", "false", -1]]);
  assert.ok(await js("[...document.querySelectorAll('[role=tab]')].every(t => document.getElementById(t.getAttribute('aria-controls'))?.getAttribute('aria-labelledby') === t.id)"), "tabs and panels reference each other");
  await expectSection("news");
  assert.equal(await js("location.search"), "");
  assert.ok(await js("Boolean(__panel('ai').querySelector('input[name=question]'))"), "AI Hub is mounted (hidden) so switching is instant");
  assert.equal(intercepted.ask + intercepted.briefing, 0, "no AI request on load");
  pass("one h1, labelled tablist with roving tabindex, tabs ↔ panels linked; News Feed is the default; AI Hub mounted but hidden; no AI calls on load");

  // C. Feed health notice: below the filters, above the stories, collapsed by default, publishers on demand
  assert.equal(await js("__notice().dataset.feedHealth"), "mixed");
  assert.match(await js("__notice().textContent"), /Some updates from 2 sources are delayed\. Showing the latest available news\./);
  assert.ok(await js("Boolean(document.querySelector('[role=search]').compareDocumentPosition(__notice()) & Node.DOCUMENT_POSITION_FOLLOWING)"), "after the filter bar");
  assert.ok(await js("Boolean(__notice().compareDocumentPosition(document.querySelector('a[href=\"https://example.com/story-1\"]')) & Node.DOCUMENT_POSITION_FOLLOWING)"), "before the first story");
  assert.ok(await js("__notice().getBoundingClientRect().height <= 64"), "collapsed notice stays one compact line");
  assert.equal(await js("__notice().querySelector('details').open"), false);
  await js("__notice().querySelector('summary').click()");
  const rows = await js("[...__notice().querySelectorAll('[aria-label=\"Affected sources\"] li')].map(li => li.textContent)");
  assert.equal(rows.length, 2);
  assert.match(rows[0], /^Gone Wire.*Top stories: not available right now.*Technology: not available right now/);
  assert.match(rows[1], /^BBC News.*Science & Space: showing cached stories from \d/);
  assert.equal(await js("__notice().querySelector('time').getAttribute('datetime')"), "2026-11-14T11:40:00.000Z");
  await js("__notice().querySelector('summary').click()");
  pass("feed-health notice: one compact line below the filters, distinguishes unavailable vs cached, lists affected publishers and last-good time on demand");

  // D. Mouse selection updates the URL without a server round-trip
  await mouseClick("__tab('ai')");
  await expectSection("ai");
  assert.equal(await js("location.search"), "?view=ai");
  assert.equal(await js("document.activeElement.id"), "dashboard-tab-ai");
  assert.deepEqual(await js("[__tab('news').tabIndex, __tab('ai').tabIndex]"), [-1, 0]);
  assert.equal(intercepted.ask + intercepted.briefing, 0, "opening the AI Hub never starts an AI request");
  pass("clicking AI Hub shows it, sets ?view=ai, keeps focus on the tab and starts no AI request");

  // E. Keyboard: arrows, Home/End (automatic activation), Tab into the visible panel
  await key("ArrowLeft", 37); await expectSection("news"); assert.equal(await js("document.activeElement.id"), "dashboard-tab-news"); assert.equal(await js("location.search"), "");
  await key("ArrowRight", 39); await expectSection("ai"); assert.equal(await js("document.activeElement.id"), "dashboard-tab-ai");
  await key("Home", 36); await expectSection("news");
  await key("End", 35); await expectSection("ai");
  await key("Tab", 9);
  assert.ok(await js("__panel('ai').contains(document.activeElement)"), "Tab moves into the visible panel");
  pass("ArrowLeft/ArrowRight/Home/End switch sections and move focus; Tab enters the visible panel");

  // F. Back / Forward follow the section history
  await js("history.back()"); await expectSection("news"); assert.equal(await js("location.search"), "");
  await js("history.forward()"); await expectSection("ai"); assert.equal(await js("location.search"), "?view=ai");
  pass("browser Back/Forward move between sections");

  // G. State is preserved across switches (both panels stay mounted)
  await js("__tab('news').click()"); await expectSection("news");
  await js("__setValue(document.getElementById('article-search'), 'Fixture story 12')");
  await js("__tab('ai').click()"); await expectSection("ai");
  await js("__setValue(__askInput(), 'Preserved question')");
  await js("__tab('news').click()"); await expectSection("news");
  assert.equal(await js("document.getElementById('article-search').value"), "Fixture story 12");
  await js("__tab('ai').click()"); await expectSection("ai");
  assert.equal(await js("__askInput().value"), "Preserved question");
  await js("__tab('news').click()"); await expectSection("news");
  await js("__setValue(document.getElementById('article-search'), '')");
  pass("feed search text and the Ask draft survive switching sections");

  // H. Scroll position: returning to the feed restores it; a first visit keeps the tabs in view
  await js("window.scrollTo(0, 900)"); await delay(250);
  const feedScroll = await js("scrollY");
  assert.ok(feedScroll > 600, `fixture page is long enough to scroll (${feedScroll})`);
  await js("__tab('ai').click()"); await expectSection("ai"); await delay(150);
  const tabsTop = await js("document.querySelector('[role=tablist]').getBoundingClientRect().top + scrollY");
  assert.ok(await js("scrollY") <= tabsTop + 1, "AI Hub opens with the tabs in view");
  await js("__tab('news').click()"); await expectSection("news"); await delay(150);
  const restored = await js("scrollY");
  assert.ok(Math.abs(restored - feedScroll) <= 2, `News Feed scroll position restored (left at ${feedScroll}, now ${restored}, page ${await js("document.documentElement.scrollHeight")})`);
  await js("window.scrollTo(0, 0)");
  pass("switching back to the News Feed restores its scroll position; the AI Hub opens at the tabs");

  // I. An Ask request in flight keeps running while the reader browses the feed
  await js("__tab('ai').click()"); await expectSection("ai");
  await js("__setValue(__askInput(), 'What are publishers reporting about Nvidia?')");
  await js("__panel('ai').querySelector('button[type=submit]').click()");
  await until(() => askQueue.length > 0, "intercepted Ask request");
  const askRequest = askQueue.shift();
  assert.equal(askRequest.request.postData, JSON.stringify({ question: "What are publishers reporting about Nvidia?" }));
  await js("__tab('news').click()"); await expectSection("news");
  await fulfill(askRequest.requestId, 200, answerResult);
  await delay(300);
  await js("__tab('ai').click()"); await expectSection("ai");
  await until(() => js("__panel('ai').querySelector('[data-ask-state]').dataset.askState === 'answered'"), "answer rendered after switching back");
  assert.equal(intercepted.ask, 1);
  pass("an in-flight Ask request completes while the News Feed is shown and the answer is waiting in the AI Hub");

  // J. Responsive layout and screenshots (feed notice still showing; card entrance
  // animations disabled via reduced motion so screenshots show settled layout)
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  for (const width of [390, 768, 1280]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    for (const section of ["news", "ai"]) {
      await js(`__tab('${section}').click()`); await expectSection(section); await js("window.scrollTo(0, 0)"); await delay(400);
      assert.ok(await js("document.documentElement.scrollWidth <= window.innerWidth"), `horizontal overflow: ${section} at ${width}px`);
      assert.ok(await js("[...document.querySelectorAll('[role=tab]')].every(t => { const r = t.getBoundingClientRect(); return r.height >= 44 && r.left >= 0 && r.right <= innerWidth; })"), `tab targets at ${width}px`);
      if (section === "ai") assert.ok(await js("__panel('ai').firstElementChild.getBoundingClientRect().width <= 768"), `AI Hub reading width at ${width}px`);
      const height = Math.min(2600, await js("document.documentElement.scrollHeight"));
      const shot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
      writeFileSync(path.join(root, ".next", `dashboard-review-${section}-${width}.png`), Buffer.from(shot.data, "base64"));
    }
  }
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp("Emulation.setEmulatedMedia", { features: [] });
  pass("390/768/1280px: no horizontal overflow, ≥44px tabs inside the viewport, AI Hub column ≤768px; screenshots in .next/dashboard-review-*.png");

  // K. Healthy feeds remove the notice entirely
  await js("__tab('news').click()"); await expectSection("news");
  await js("document.getElementById('healthy-fixture').click()");
  await until(() => js("!__notice()"), "notice removed when all feeds are healthy");
  pass("no feed notice when every feed is healthy");

  // L. Without AI the dashboard is the feed alone; ?view=ai is ignored safely
  await cdp("Page.navigate", { url: origin + route + "?fixture-ai=off&view=ai" });
  await until(() => js("document.documentElement.dataset.dashboardFixtureReady === 'true' && Boolean(document.getElementById('article-search'))"), "AI-disabled dashboard", 60000);
  assert.equal(await js("document.querySelectorAll('[role=tablist], [role=tabpanel], input[name=question]').length"), 0);
  assert.ok(await js("document.getElementById('article-search').getBoundingClientRect().height > 0"));
  pass("AI disabled: no tabs or AI components; ?view=ai falls back to the News Feed");

  await delay(500);
  assert.deepEqual(errors, [], "no hydration/runtime errors");
  assert.doesNotMatch(serverLog, /\/api\/ai\//, "no AI request reached the dev server");
  console.log(`PASS no hydration/runtime errors; intercepted in the browser: ${JSON.stringify(intercepted)}; zero AI requests reached the server or a provider`);
} finally {
  socket?.close(); browser?.kill(); server?.kill();
  if (existsSync(fixtureDir)) rmSync(fixtureDir, { recursive: true, force: true });
  for (const filename of ["validator.ts", "routes.d.ts"]) {
    const generated = path.join(root, ".next", "dev", "types", filename);
    if (existsSync(generated) && readFileSync(generated, "utf8").includes("dashboard-ui-validation")) unlinkSync(generated);
  }
}
