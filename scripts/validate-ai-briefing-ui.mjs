// Real component in Chrome; all briefing responses are intercepted before network.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import path from "node:path";
import { editorialArticles } from "../tests/fixtures/briefing-editorial.mjs";

const root = process.cwd();
const origin = process.env.AI_UI_ORIGIN ?? "http://127.0.0.1:3102";
const localUrl = new URL(origin);
assert.ok(localUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(localUrl.hostname) && origin === localUrl.origin, "Validation origin must be a local HTTP origin");
const fixtureDir = path.join(root, "app", "ai-ui-validation");
const fixturePath = path.join(fixtureDir, "page.tsx");
const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
assert.ok(existsSync(chrome), "Set CHROME_PATH to an installed Chrome executable");
assert.ok(!existsSync(fixtureDir), "Refusing to overwrite an existing fixture");
mkdirSync(fixtureDir);
writeFileSync(fixturePath, `"use client";
import { useEffect, useState } from "react";
import { AiNewsBriefing } from "@/components/AiNewsBriefing";
export default function Page() { useEffect(() => { document.documentElement.dataset.aiFixtureReady = "true"; }, []); const [key, setKey] = useState(0); return <main className="mx-auto max-w-5xl p-3"><button id="reset-fixture" hidden onClick={() => setKey(key + 1)}>Reset</button><AiNewsBriefing key={key} /></main>; }
`);

let server, browser, socket, nextId = 0;
const pending = new Map();
const errors = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch {}
    await delay(250);
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
async function evaluate(expression) {
  const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function finishMockRequest() {
  await until(() => evaluate("typeof window.__aiResolve === 'function'"), "pending mocked response");
  await evaluate("window.__aiResolve(); window.__aiResolve = null");
}
const button = "document.querySelector('button[aria-controls=\"ai-briefing-content\"]')";
try {
  if (!process.env.AI_UI_ORIGIN) server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3102"], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let serverLog = "";
  server?.stdout.on("data", (data) => { serverLog += data; });
  server?.stderr.on("data", (data) => { serverLog += data; });
  await until(async () => (await fetch(origin + "/ai-ui-validation", { signal: AbortSignal.timeout(10000) })).ok, "fixture server", 120000).catch((error) => { throw new Error(`${error.message}\n${serverLog.slice(-3000)}`); });
  browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=9313", `--user-data-dir=${path.join(root, ".next", "ai-browser-" + Date.now())}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  const target = await until(async () => (await (await fetch("http://127.0.0.1:9313/json/list")).json()).find((item) => item.type === "page"), "Chrome");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id); pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(message.params.exceptionDetails));
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      const text = message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ");
      if (/hydration|uncaught|react error/i.test(text)) errors.push(text);
    }
  };
  await cdp("Runtime.enable"); await cdp("Page.enable");
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__aiCalls = 0; window.__aiMode = 200; const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      if (String(input).includes('/api/ai/briefing')) {
        window.__aiCalls++; window.__aiBody = init.body ?? null;
        await new Promise(resolve => { window.__aiResolve = resolve; });
        if (window.__aiMode === 0) throw new TypeError('Synthetic network failure');
        return new Response(JSON.stringify({ briefing: {
          generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + (window.__aiTtl ?? 60000)).toISOString(),
          notice: 'AI-generated summaries based on available publisher metadata, not full-article analysis.',
          items: window.__aiEmpty ? [] : ${JSON.stringify(editorialArticles.slice(0, 5).map((article, index) => ({ headline: article.title, explanation: article.summary, references: [{ source: article.source, title: article.title, url: index ? `https://example.com/fixture-${index}` : "https://example.com/fixture" }] })))}
        }, cacheHit: window.__aiCacheHit ?? true }), { status: window.__aiMode, headers: { 'Content-Type': 'application/json', 'Retry-After': '3' } });
      }
      return originalFetch(input, init);
    };` });
  await cdp("Page.navigate", { url: origin + "/ai-ui-validation" });
  await until(() => evaluate(`Boolean(${button}) && document.documentElement.dataset.aiFixtureReady === "true"`), "hydrated component");
  assert.equal(await evaluate("window.__aiCalls"), 0);
  await evaluate(`${button}.click()`);
  await until(() => evaluate(`${button}.disabled`), "loading state");
  assert.equal(await evaluate(`${button}.disabled`), true);
  await finishMockRequest();
  await until(() => evaluate("Boolean(document.querySelector('time'))"), "briefing result");
  assert.equal(await evaluate("window.__aiCalls"), 1);
  assert.equal(await evaluate("window.__aiBody"), null);
  assert.ok(await evaluate("document.getElementById('ai-briefing-content').textContent.includes('not full-article analysis')"));
  assert.equal(await evaluate("document.querySelector('h2').textContent"), "Your News Briefing");
  assert.ok(await evaluate("document.querySelector('section').textContent.includes('AI-generated')"));
  assert.ok(await evaluate("document.querySelector('section').textContent.includes('Shared cached briefing')"));
  assert.equal(await evaluate("document.querySelectorAll('time').length"), 2);
  assert.equal(await evaluate("document.querySelector('a').href"), "https://example.com/fixture");
  await evaluate(`${button}.click()`); await delay(100); await evaluate(`${button}.click()`); await delay(100);
  assert.equal(await evaluate("window.__aiCalls"), 1);
  for (const width of [320, 390, 768, 1440, 1920]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await delay(100);
    assert.ok(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), `Overflow at ${width}px`);
    assert.ok(await evaluate("Array.from(document.querySelectorAll('a')).every(a => a.getBoundingClientRect().height >= 44)"), 'Citation touch targets');
    assert.ok(await evaluate("document.querySelector('ol').getBoundingClientRect().width <= 768"), "Constrained reading width");
    assert.ok(await evaluate("Array.from(document.querySelectorAll('ul[aria-label]')).every(list => list.getAttribute('aria-label').startsWith('Source articles for '))"), "Story-specific citation labels");
    const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(root, ".next", `ai-review-${width}.png`), Buffer.from(screenshot.data, "base64"));
  }
  assert.equal(await evaluate("document.querySelectorAll('#ai-briefing-content h3').length"), 5);
  assert.ok(await evaluate("Array.from(document.querySelectorAll('a')).every(a => a.rel.includes('noopener') && a.textContent.includes('opens in a new tab'))"));
  await evaluate(`${button}.focus()`);
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate("document.activeElement.tagName"), "A", "Keyboard reaches source citation");
  await evaluate(`${button}.focus()`);
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await until(() => evaluate("document.getElementById('ai-briefing-content').hidden"), "keyboard collapse");
  assert.equal(await evaluate(`${button}.getAttribute('aria-expanded')`), "false");
  await evaluate(`${button}.click()`);
  assert.equal(await evaluate(`${button}.getAttribute('aria-expanded')`), "true");
  assert.equal(await evaluate("window.__aiCalls"), 1);
  await evaluate("window.__aiTtl=1500; window.__aiCacheHit=false; document.getElementById('reset-fixture').click()"); await delay(100);
  await evaluate(`${button}.click()`); await finishMockRequest();
  await until(() => evaluate("document.querySelector('section').textContent.includes('Generated on request')"), "new generation label");
  const callsBeforeExpiry = await evaluate("window.__aiCalls");
  const refreshButton = "Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Refresh AI Briefing')";
  await until(() => evaluate(`Boolean(${refreshButton})`), "expiry update");
  assert.ok(await evaluate("document.querySelector('section').textContent.includes('Earlier briefing')"));
  assert.equal(await evaluate("window.__aiCalls"), callsBeforeExpiry, "Expiry never generates automatically");
  assert.equal(await evaluate(`${button}.textContent`), "Hide AI Briefing", "Expired results can still be collapsed without generation");
  await evaluate("window.__aiTtl=60000; window.__aiCacheHit=true");
  await evaluate(`${refreshButton}.click()`); await finishMockRequest();
  await until(() => evaluate("document.querySelector('section').textContent.includes('Shared cached briefing')"), "explicit refresh result");
  assert.equal(await evaluate("window.__aiCalls"), callsBeforeExpiry + 1);
  await evaluate("window.__aiEmpty=true; document.getElementById('reset-fixture').click()"); await delay(100);
  await evaluate(`${button}.click()`);
  await finishMockRequest();
  await until(() => evaluate("Boolean(document.querySelector('[role=alert]'))"), "empty result");
  assert.ok(await evaluate("document.querySelector('[role=alert]').textContent.includes('No briefing items')"));
  await evaluate("window.__aiEmpty=false");
  console.log("PASS five-item presentation, citation touch targets, keyboard navigation/collapse, empty response and screenshots");
  console.log("PASS click-only fetch, loading state, timestamps, metadata disclaimer, trusted links, reopen cache, five viewport widths");
  console.log("PASS cached/new labels, expiry notice, explicit refresh without automatic requests, constrained reading width and citation labels");
  for (const status of [401, 429, 503, 0]) {
    await evaluate(`window.__aiMode = ${status}; document.getElementById('reset-fixture').click()`); await delay(100);
    await evaluate(`${button}.click()`);
    await finishMockRequest();
    await until(() => evaluate("Boolean(document.querySelector('[role=alert]'))"), `error ${status}`);
    assert.ok(await evaluate(`${button}.textContent.includes('Try AI Briefing again')`));
  }
  assert.deepEqual(errors, []);
  console.log("PASS session/rate-limit/unavailable/network errors and retry actions; no hydration/runtime errors; no provider calls");
} finally {
  socket?.close(); browser?.kill(); server?.kill();
  if (existsSync(fixturePath)) unlinkSync(fixturePath);
  if (existsSync(fixtureDir)) rmdirSync(fixtureDir);
  for (const filename of ["validator.ts", "routes.d.ts"]) {
    const generated = path.join(root, ".next", "dev", "types", filename);
    if (existsSync(generated) && readFileSync(generated, "utf8").includes("ai-ui-validation")) unlinkSync(generated);
  }
}
