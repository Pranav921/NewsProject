// Local browser regression checks using installed Chrome and its DevTools protocol.
// A temporary fixture exercises real components without signing in or saving user data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const fixtureDir = path.join(root, "app", "news-ui-validation");
const fixturePath = path.join(fixtureDir, "page.tsx");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
assert.ok(existsSync(chromePath), "Set CHROME_PATH to an installed Chrome executable");
assert.ok(!existsSync(fixtureDir), "Validation route already exists; refusing to overwrite it");
mkdirSync(fixtureDir);
writeFileSync(fixturePath, `"use client";
import { NewsFeed } from "@/components/NewsFeed";
import { AppShell, type ShellTab } from "@/components/AppShell";
import { useState } from "react";
import { AccountSettings } from "@/components/AccountSettings";
import { NewsletterSignup } from "@/components/NewsletterSignup";
const preferences = { defaultSourceFilter: "All Sources", defaultTimeFilter: "all", defaultViewMode: "standard" as const };
const articles = [
  { title: "Technology fixture story", category: "technology" as const, link: "https://example.com/tech", source: "BBC News", summary: null, publishedAt: "2026-10-30T12:00:00.000Z" },
  { title: "Business fixture story", category: "business" as const, link: "https://example.com/business", source: "CBS News", summary: null, publishedAt: "2026-10-30T12:00:00.000Z" },
  { title: "General fixture story", link: "https://example.com/general", source: "BBC News", summary: null, publishedAt: "2026-10-30T12:00:00.000Z" },
];
export default function Page() {
  const [authenticated, setAuthenticated] = useState(false);
  const [tab, setTab] = useState<ShellTab>("feed");
  return <main className="mx-auto flex min-h-screen w-full flex-col px-3 py-4 sm:px-6 lg:px-7 2xl:px-8">
  <button id="qa-toggle-viewer" hidden onClick={() => { setAuthenticated(value => !value); setTab("feed"); }}>Toggle fixture viewer</button>
  <AppShell activeTab={tab} onTabChange={setTab} viewerMode={authenticated ? "authenticated" : "public"} userEmail={authenticated ? "fixture@example.com" : null} pendingUpdateCount={99} />
  <NewsFeed key={String(authenticated)} articles={articles} activeShellTab={tab} onShellTabChange={setTab} initialSavedArticles={[articles[1]]} viewerMode={authenticated ? "authenticated" : "public"} />
  <AccountSettings email="fixture@example.com" userId="fixture" initialAlertKeywords={[]} initialEmailSendLogs={[]} initialNewsletterClickedArticleCount={0} initialNewsletterArticleMode="all_missed" initialNewsletterCustomFrequency={null} initialNewsletterEmailFormat="standard" initialNewsletterFrequency="daily" initialNewsletterSortOrder="category" initialNewsletterPersonalizationReady={false} initialPreferences={preferences} />
  <NewsletterSignup />
</main>; }
`);

let server, browser, socket;
const pending = new Map();
let nextId = 0;
const errors = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const result = await fn(); if (result) return result; } catch {}
    await delay(250);
  }
  throw new Error(`Timed out: ${label}`);
}
async function cdp(method, params = {}) {
  const id = ++nextId;
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject });
  });
  socket.send(JSON.stringify({ id, method, params }));
  return result;
}
async function evaluate(expression) {
  const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function select(id, value) {
  await evaluate(`(() => { const el = document.getElementById(${JSON.stringify(id)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await delay(200);
}
try {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3100"], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let serverLog = "";
  server.stdout.on("data", (data) => { serverLog += data; });
  server.stderr.on("data", (data) => { serverLog += data; });
  await until(async () => (await fetch("http://127.0.0.1:3100/news-ui-validation")).ok, "fixture server", 120000).catch((error) => { throw new Error(`${error.message}\n${serverLog.slice(-5000)}`); });
  console.log("PASS validation page serves successfully");
  const profile = path.join(root, ".next", `browser-validation-${Date.now()}`);
  browser = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=9311", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  const targets = await until(async () => { const response = await fetch("http://127.0.0.1:9311/json/list"); const list = await response.json(); return list.find((item) => item.type === "page"); }, "Chrome DevTools");
  socket = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id);
      if (request) { pending.delete(message.id); if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result); }
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(message.params.exceptionDetails));
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
  };
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `window.__savedNewsletter = null; const originalFetch = window.fetch; window.fetch = async (input, init) => { if (String(input).includes('/api/newsletter-subscriptions') || String(input).includes('/api/newsletter/subscribe')) { window.__savedNewsletter = JSON.parse(init.body); return new Response(JSON.stringify({ message: 'Settings saved' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } return originalFetch(input, init); };` });
  await cdp("Page.navigate", { url: "http://127.0.0.1:3100/news-ui-validation" });
  await until(() => evaluate("Boolean(document.getElementById('category-filter'))"), "hydrated feed");
  await delay(1500);
  assert.equal(await evaluate("document.querySelectorAll('#category-filter option').length"), 11);
  assert.equal(await evaluate("document.getElementById('newsletter-sort-order').value"), "category");
  assert.ok(await evaluate("document.querySelectorAll('#default-source-filter option').length > 1"), "Source options exist");
  assert.equal(await evaluate("document.querySelectorAll('#default-source-filter option').length === new Set(Array.from(document.querySelectorAll('#default-source-filter option')).map(o => o.value)).size"), true);
  console.log("PASS category menu, persisted newsletter order, and unique source options");
  await select("category-filter", "technology");
  assert.equal(await evaluate("document.querySelectorAll('a[href=\"https://example.com/tech\"]').length > 0"), true);
  assert.equal(await evaluate("document.querySelectorAll('a[href=\"https://example.com/business\"]').length"), 0);
  await select("category-filter", "business");
  assert.equal(await evaluate("document.querySelectorAll('a[href=\"https://example.com/business\"]').length > 0"), true);
  await select("coverage-filter", "international");
  assert.equal(await evaluate("document.querySelectorAll('a[href=\"https://example.com/business\"]').length"), 0);
  await evaluate("Array.from(document.querySelectorAll('button')).find(b => /reset filters|clear filters/i.test(b.textContent))?.click()");
  await delay(200);
  assert.equal(await evaluate("document.getElementById('category-filter').value"), "all");
  assert.equal(await evaluate("document.getElementById('coverage-filter').value"), "all");
  console.log("PASS category filtering, combined coverage filters, empty state, and reset");
  for (const mode of ["List", "Grid"]) {
    await evaluate(`Array.from(document.querySelector('[aria-label="Article view mode"]').querySelectorAll('button')).find(b => b.textContent.trim() === '${mode}').click()`);
    await select("category-filter", "technology");
    assert.equal(await evaluate("document.querySelectorAll('a[href=\"https://example.com/business\"]').length"), 0);
    await select("category-filter", "all");
  }
  console.log("PASS category filtering in both grid and list views");
  await select("newsletter-sort-order", "default");
  await evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Save newsletter settings')).click()");
  await until(() => evaluate("window.__savedNewsletter"), "newsletter save");
  assert.equal(await evaluate("window.__savedNewsletter.sortOrder"), "default");
  assert.equal(await evaluate("window.__savedNewsletter.articleMode"), "all_missed");
  await select("newsletter-sort-order", "category");
  await evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Save newsletter settings')).click()");
  await until(() => evaluate("window.__savedNewsletter.sortOrder === 'category'"), "category save");
  console.log("PASS both newsletter sort values submit with existing settings preserved");
  await evaluate("document.querySelector('#newsletter input[type=checkbox]').click()");
  assert.equal(await evaluate("document.getElementById('newsletter-sort-order').disabled"), true);
  await evaluate("document.querySelector('#newsletter input[type=checkbox]').click()");
  await evaluate(`(() => {
    const form = Array.from(document.querySelectorAll('form')).find(form => form.querySelector('input[type=email]'));
    const email = form.querySelector('input[type=email]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(email, 'fixture@example.com');
    email.dispatchEvent(new Event('input', { bubbles: true }));
    const order = form.querySelector('label select');
    order.value = 'category'; order.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await delay(200);
  await evaluate("window.__savedNewsletter = null; Array.from(document.querySelectorAll('form')).find(form => form.querySelector('input[type=email]')).requestSubmit()");
  await until(() => evaluate("window.__savedNewsletter"), "newsletter signup");
  assert.equal(await evaluate("window.__savedNewsletter.sortOrder"), "category");
  console.log("PASS disabled subscription controls and category order at signup");
  await evaluate("document.getElementById('qa-toggle-viewer').click()");
  await delay(200);
  await evaluate("Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Saved').click()");
  await select("category-filter", "business");
  assert.ok(await evaluate("document.querySelectorAll('a[href=\"https://example.com/business\"]').length > 0"));
  assert.equal(await evaluate("document.querySelectorAll('a[href=\"https://example.com/tech\"]').length"), 0);
  await select("category-filter", "technology");
  assert.equal(await evaluate("document.querySelectorAll('article').length"), 0);
  await select("category-filter", "all");
  await evaluate("Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'All articles').click()");
  console.log("PASS category filtering and empty states in saved stories");
  for (const width of [1920, 1440, 1280, 1024, 768, 390, 320]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    await delay(200);
    assert.ok(await evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), `page overflow at ${width}px`);
    assert.ok(await evaluate("Array.from(document.querySelectorAll('select')).every(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= document.documentElement.clientWidth + 1; })"), `select overflow at ${width}px`);
    const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(root, ".next", `news-validation-${width}.png`), Buffer.from(screenshot.data, "base64"));
    if (width === 1440 || width === 390) {
      await evaluate("document.getElementById('newsletter').scrollIntoView({ behavior: 'instant' })");
      await delay(100);
      const settingsScreenshot = await cdp("Page.captureScreenshot", { format: "png" });
      writeFileSync(path.join(root, ".next", `newsletter-validation-${width}.png`), Buffer.from(settingsScreenshot.data, "base64"));
      await evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
    }
    await evaluate("document.getElementById('qa-toggle-viewer').click()");
    await delay(100);
    assert.ok(await evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), `alternate header overflow at ${width}px`);
    await evaluate("document.getElementById('qa-toggle-viewer').click()");
    await delay(100);
    console.log(`PASS responsive layout and both headers with 99 pending updates at ${width}px`);
  }
  if (process.argv.includes("--live-homepage")) {
    await cdp("Page.navigate", { url: "http://127.0.0.1:3100/" });
    await until(() => evaluate("location.pathname === '/' && Boolean(document.querySelector('header')) && Boolean(document.getElementById('category-filter'))"), "actual homepage", 120000);
    await delay(1500);
    assert.ok(await evaluate("document.querySelectorAll('article').length > 0"), "Live homepage has articles");
    await select("category-filter", "technology");
    await until(() => evaluate("document.getElementById('category-filter').value === 'technology' && document.querySelectorAll('article').length > 0"), "live technology articles", 10000).catch(async (error) => {
      console.log(await evaluate("JSON.stringify({ path: location.pathname, category: document.getElementById('category-filter')?.value, titles: Array.from(document.querySelectorAll('article')).slice(0, 3).map(el => el.textContent), page: document.body.innerText.slice(-1500) })"));
      throw error;
    });
    await select("category-filter", "all");
    for (const width of [1920, 1440, 1280, 1024, 768, 390, 320]) {
      await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
      await delay(200);
      const overflow = await evaluate("({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth, elements: Array.from(document.querySelectorAll('body *')).filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.right > document.documentElement.clientWidth + 1 || r.left < -1); }).slice(0, 8).map(el => ({ tag: el.tagName, classes: el.className, text: el.textContent.slice(0, 80) })) })");
      assert.ok(overflow.scroll <= overflow.width, `live homepage overflow at ${width}px: ${JSON.stringify(overflow)}`);
      assert.ok(await evaluate("Array.from(document.querySelectorAll('select')).every(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= document.documentElement.clientWidth + 1; })"), `live filter overflow at ${width}px`);
      const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
      writeFileSync(path.join(root, ".next", `homepage-validation-${width}.png`), Buffer.from(screenshot.data, "base64"));
      console.log(`PASS actual homepage layout at ${width}px`);
    }
  }
  assert.deepEqual(errors, [], "Browser errors");
  console.log("PASS no browser runtime or hydration errors");
} finally {
  if (socket) socket.close();
  if (browser) browser.kill();
  if (server) server.kill();
  // Fixed fixture path is checked above and only this generated file is removed.
  if (existsSync(fixturePath)) unlinkSync(fixturePath);
  if (existsSync(fixtureDir)) rmdirSync(fixtureDir);
  // Next includes dev-generated types in production type checks. Remove the
  // generated route references after deleting the fixture; Next regenerates them.
  for (const filename of ["validator.ts", "routes.d.ts"]) {
    const generatedPath = path.join(root, ".next", "dev", "types", filename);
    if (existsSync(generatedPath) && readFileSync(generatedPath, "utf8").includes("news-ui-validation")) unlinkSync(generatedPath);
  }
}
