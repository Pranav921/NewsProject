// KN-UI-005 regression check. Renders every component that contains form controls
// (plus static pages) in headless Chrome and compares each button/input/select/
// textarea's computed typography in two states:
//   current = the stylesheet as built from app/globals.css
//   legacy  = the same page with the removed unlayered `font: inherit` rule re-injected
// Any difference means a control's classes disagree with what production rendered.
// Always fails if an unlayered rule overrides utilities on form controls, if a probe
// button/input ignores its utilities, or if layout overflows. With --expect-unchanged
// (used for the KN-UI-005 fix) it also fails if ANY existing control renders
// differently from the legacy cascade, i.e. the fix must preserve the visual design.
// All /api/* and Supabase requests are blocked in the browser; nothing is written.
//   node scripts/validate-form-typography.mjs [--expect-unchanged]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const port = 3104;
const origin = `http://127.0.0.1:${port}`;
const fixtureDir = path.join(root, "app", "typography-validation");
const fixturePath = path.join(fixtureDir, "page.tsx");
const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
assert.ok(existsSync(chrome), "Set CHROME_PATH to an installed Chrome executable");
assert.ok(!existsSync(fixtureDir), "Refusing to overwrite an existing fixture");
const LEGACY = "button, input, select, textarea { font: inherit; }";

mkdirSync(fixtureDir);
writeFileSync(fixturePath, `"use client";
import { useEffect, useState } from "react";
import { AppShell, type ShellTab } from "@/components/AppShell";
import { NewsFeed } from "@/components/NewsFeed";
import { PublicNewsView } from "@/components/PublicNewsView";
import { AccountSettings } from "@/components/AccountSettings";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import { AdvertiseContactForm } from "@/components/AdvertiseContactForm";
import { AiNewsBriefing } from "@/components/AiNewsBriefing";
import { AskKicker } from "@/components/AskKicker";
const preferences = { defaultSourceFilter: "All Sources", defaultTimeFilter: "all", defaultViewMode: "standard" as const };
const articles = [
  { title: "Technology fixture story about a new research chip", category: "technology" as const, link: "https://example.com/tech", source: "BBC News", summary: "A fixture summary for layout checks.", publishedAt: "2026-11-14T10:00:00.000Z" },
  { title: "Business fixture story", category: "business" as const, link: "https://example.com/business", source: "CBS News", summary: null, publishedAt: "2026-11-14T09:00:00.000Z" },
  { title: "General fixture story", link: "https://example.com/general", source: "BBC News", summary: null, publishedAt: "2026-11-14T08:00:00.000Z" },
];
export default function Page() {
  const [tab, setTab] = useState<ShellTab>("feed");
  useEffect(() => { document.documentElement.dataset.typoReady = "true"; }, []);
  return <main className="mx-auto flex w-full flex-col px-3 py-4 sm:px-6 lg:px-7">
    <section data-typo="PublicNewsView"><PublicNewsView articles={articles} /></section>
    <section data-typo="AuthenticatedDashboard">
      <AppShell activeTab={tab} onTabChange={setTab} viewerMode="authenticated" userEmail="fixture@example.com" pendingUpdateCount={3} />
      <NewsFeed articles={articles} activeShellTab={tab} onShellTabChange={setTab} initialSavedArticles={[articles[1]]} viewerMode="authenticated" />
    </section>
    <section data-typo="AiNewsBriefing"><AiNewsBriefing /></section>
    <section data-typo="AskKicker"><AskKicker /></section>
    <section data-typo="AccountSettings"><AccountSettings email="fixture@example.com" userId="fixture" initialAlertKeywords={["chips"]} initialEmailSendLogs={[]} initialNewsletterClickedArticleCount={0} initialNewsletterArticleMode="all_missed" initialNewsletterCustomFrequency={null} initialNewsletterEmailFormat="standard" initialNewsletterFrequency="daily" initialNewsletterSortOrder="category" initialNewsletterPersonalizationReady={false} initialPreferences={preferences} /></section>
    <section data-typo="NewsletterSignup"><NewsletterSignup /></section>
    <section data-typo="AdvertiseContactForm"><AdvertiseContactForm /></section>
    {/* Probes: utilities on form controls must apply now that no unlayered rule overrides them. */}
    <div data-typo-probe hidden={false} className="text-base font-normal leading-6">
      <button type="button" id="typo-probe-button" className="text-xs font-semibold leading-4">Probe</button>
      <input id="typo-probe-input" aria-label="Probe" className="font-mono text-lg leading-7" />
    </div>
  </main>;
}
`);

let server, browser, socket, nextId = 0, serverLog = "";
const pending = new Map();
const errors = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { try { const value = await fn(); if (value) return value; } catch {} await delay(150); }
  throw new Error(`Timed out: ${label}`);
}
function cdp(method, params = {}) {
  const id = ++nextId;
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
  });
  socket.send(JSON.stringify({ id, method, params })); return result;
}
async function js(expression) {
  const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
// Stable per-control key: section + tag + accessible text + occurrence index.
const MEASURE = `(() => {
  const label = (el) => (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.textContent || el.getAttribute('placeholder') || el.getAttribute('name') || el.type || '').replace(/\\s+/g, ' ').trim().slice(0, 48);
  const seen = new Map();
  return [...document.querySelectorAll('button, input:not([type=hidden]), select, textarea')].filter((el) => !el.closest('[data-typo-probe]')).map((el) => {
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    const base = (el.closest('[data-typo]')?.dataset.typo || location.pathname) + ' ' + el.tagName.toLowerCase() + ' "' + label(el) + '"';
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    return { key: base + ' #' + n, visible: r.width > 0 && r.height > 0, fontSize: s.fontSize, fontWeight: s.fontWeight,
      lineHeight: s.lineHeight, fontFamily: s.fontFamily.split(',')[0].replace(/["']/g, ''), width: Math.round(r.width), height: Math.round(r.height) };
  });
})()`;
const injectLegacy = `(() => { const s = document.createElement('style'); s.id = 'legacy-font-inherit'; s.textContent = ${JSON.stringify(LEGACY)}; document.head.appendChild(s); })()`;
const removeLegacy = "document.getElementById('legacy-font-inherit')?.remove()";
const overflow = "document.documentElement.scrollWidth - window.innerWidth";
// Hypothetical: what fixing the separate unlayered `a {}` rule (KN-UI-006) would change.
const ANCHOR_AUDIT = `(() => {
  const read = () => [...document.querySelectorAll('a')].map(a => { const s = getComputedStyle(a); return s.color + '|' + s.textDecorationLine; });
  const before = read();
  const sheet = [...document.styleSheets].find(sh => { try { return [...sh.cssRules].some(r => r.selectorText === 'a' && !r.parentRule); } catch { return false; } });
  if (!sheet) return null;
  const index = [...sheet.cssRules].findIndex(r => r.selectorText === 'a' && !r.parentRule);
  const text = sheet.cssRules[index].cssText; sheet.deleteRule(index);
  const after = read(); sheet.insertRule(text, index);
  return { anchors: before.length, wouldChange: before.filter((v, i) => v !== after[i]).length };
})()`;

const targets = [
  { url: "/typography-validation", ready: "document.documentElement.dataset.typoReady === 'true'" },
  ...["/about", "/contact", "/advertise", "/privacy", "/terms", "/unsubscribe/success"].map((url) => ({ url, ready: "document.readyState === 'complete'" })),
];
const report = { generatedAt: new Date().toISOString(), widths: {}, anchorAudit: {} };
try {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, AI_BRIEFING_ENABLED: "false" } /* shared AI switch off: no real AI route can run */ });
  server.stdout.on("data", (d) => { serverLog += d; }); server.stderr.on("data", (d) => { serverLog += d; });
  await until(async () => (await fetch(origin + "/typography-validation", { signal: AbortSignal.timeout(20000) })).ok, "fixture server", 180000)
    .catch((error) => { throw new Error(`${error.message}\n${serverLog.slice(-3000)}`); });
  browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=9315",
    `--user-data-dir=${path.join(root, ".next", "typo-browser-" + Date.now())}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  const target = await until(async () => (await (await fetch("http://127.0.0.1:9315/json/list")).json()).find((t) => t.type === "page"), "Chrome");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result); }
    if (message.method === "Fetch.requestPaused") void cdp("Fetch.failRequest", { requestId: message.params.requestId, errorReason: "BlockedByClient" });
    if (message.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(message.params.exceptionDetails).slice(0, 400));
  };
  await cdp("Runtime.enable"); await cdp("Page.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }, { urlPattern: "*supabase.co*" }] });

  // 1. The built stylesheet must contain no unlayered form-control font rule.
  await cdp("Page.navigate", { url: origin + targets[0].url });
  await until(() => js(targets[0].ready), "fixture hydration");
  const unlayered = await js(`[...document.styleSheets].flatMap(sh => { try { return [...sh.cssRules]; } catch { return []; } })
    .filter(r => r.type === 1 && !r.parentRule && /(^|,)\\s*(button|input|select|textarea|optgroup)\\b/.test(r.selectorText) && /font|line-height/.test(r.style.cssText))
    .map(r => r.cssText)`);
  assert.deepEqual(unlayered, [], "no unlayered form-control font rule may override Tailwind utilities");

  const probe = await js("(() => { const b = getComputedStyle(document.getElementById('typo-probe-button')), i = getComputedStyle(document.getElementById('typo-probe-input')); return [b.fontSize, b.fontWeight, b.lineHeight, i.fontSize, i.lineHeight, i.fontFamily.includes('Mono') || i.fontFamily.includes('mono')]; })()");
  assert.deepEqual(probe, ["12px", "600", "16px", "18px", "28px", true], "Tailwind font utilities on button/input apply");
  for (const width of [390, 768, 1024, 1280, 1600]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
    const rows = [];
    for (const { url, ready } of targets) {
      await cdp("Page.navigate", { url: origin + url });
      await until(() => js(ready), `${url} ready`); await delay(400);
      const current = await js(MEASURE); const currentOverflow = await js(overflow);
      if (width === 1280) report.anchorAudit[url] = await js(ANCHOR_AUDIT);
      await js(injectLegacy); await delay(50);
      const legacy = await js(MEASURE); await js(removeLegacy);
      assert.ok(currentOverflow <= 0, `${url} overflows horizontally by ${currentOverflow}px at ${width}px`);
      const byKey = new Map(legacy.map((row) => [row.key, row]));
      for (const row of current) {
        const old = byKey.get(row.key);
        if (!old || !(row.visible || old.visible)) continue;
        const changed = ["fontSize", "fontWeight", "lineHeight", "fontFamily"].filter((k) => row[k] !== old[k]);
        rows.push({ key: row.key, changed, legacy: old, current: row });
      }
    }
    report.widths[width] = { controls: rows.length, changed: rows.filter((r) => r.changed.length) };
  }
  mkdirSync(path.join(root, ".next"), { recursive: true });
  writeFileSync(path.join(root, ".next", "typography-report.json"), JSON.stringify(report, null, 2));
  for (const [width, { controls, changed }] of Object.entries(report.widths)) {
    console.log(`\n${width}px: ${controls} visible form controls measured; ${changed.length} render differently than under the legacy rule`);
    for (const row of changed) console.log(`  ${row.key}: ${row.changed.map((k) => `${k} ${row.legacy[k]} -> ${row.current[k]}`).join(", ")}; box ${row.legacy.width}x${row.legacy.height} -> ${row.current.width}x${row.current.height}`);
  }
  console.log("\nAnchor audit (KN-UI-006, not changed):", JSON.stringify(report.anchorAudit));
  assert.deepEqual(errors, [], "no runtime errors");
  if (process.argv.includes("--expect-unchanged")) {
    for (const [width, { changed }] of Object.entries(report.widths)) assert.equal(changed.length, 0, `${changed.length} controls changed at ${width}px`);
    console.log("PASS every existing form control renders exactly as under the legacy cascade (font size, weight, line height, family)");
  }
  console.log("PASS no unlayered form-control font rule; probe utilities apply; no horizontal overflow at 390/768/1024/1280/1600px on 7 surfaces; report in .next/typography-report.json");
} finally {
  socket?.close(); browser?.kill(); server?.kill();
  if (existsSync(fixturePath)) unlinkSync(fixturePath);
  if (existsSync(fixtureDir)) rmdirSync(fixtureDir);
  for (const filename of ["validator.ts", "routes.d.ts"]) {
    const generated = path.join(root, ".next", "dev", "types", filename);
    if (existsSync(generated) && readFileSync(generated, "utf8").includes("typography-validation")) unlinkSync(generated);
  }
}
