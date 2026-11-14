// Read-only browser profile, plus mocked auth failures. Never submits credentials
// to Supabase, calls AI, or sends newsletters. Chrome uses a fresh temporary profile.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const origin = process.env.PROFILE_ORIGIN ?? "http://localhost:3000";
const label = process.argv[2] ?? "profile";
if (!/^[a-z-]+$/.test(label)) throw new Error("Use a simple profile label");
const directory = path.join(process.cwd(), ".next", "performance");
mkdirSync(directory, { recursive: true });
const browser = spawn(process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=9315", `--user-data-dir=${path.join(directory, label + "-" + Date.now())}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });
let socket; let nextId = 0;
const pending = new Map(); const requests = []; const failures = []; const consoleCounts = { error: 0, warning: 0, lockWarnings: 0, fastRefresh: 0 };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, name, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const value = await fn(); if (value) return value; } catch {} await wait(250); }
  throw new Error(`Timed out: ${name}`);
}
function cdp(method, params = {}) {
  const id = ++nextId;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP timeout: " + method)); }, 45000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
  });
  socket.send(JSON.stringify({ id, method, params })); return promise;
}
async function evaluate(expression) {
  const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error("Browser evaluation failed");
  return result.result.value;
}
try {
  const target = await until(async () => (await (await fetch("http://127.0.0.1:9315/json/list")).json()).find((item) => item.type === "page"), "Chrome");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) { const request = pending.get(message.id); pending.delete(message.id); if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result); }
    if (message.method === "Network.requestWillBeSent") {
      const url = new URL(message.params.request.url);
      requests.push({ id: message.params.requestId, kind: url.origin === origin ? url.pathname : url.hostname.includes("supabase") ? "supabase" : "external", start: message.params.timestamp });
    }
    if (message.method === "Network.responseReceived") {
      const item = requests.findLast((request) => request.id === message.params.requestId);
      if (item) { item.status = message.params.response.status; item.ttfbMs = Math.round((message.params.timestamp - item.start) * 1000); }
    }
    if (message.method === "Network.loadingFailed") failures.push({ canceled: message.params.canceled ?? false, reason: message.params.errorText });
    if (message.method === "Runtime.consoleAPICalled") {
      const text = message.params.args.map((arg) => arg.value ?? "").join(" ");
      if (message.params.type === "error") consoleCounts.error++;
      if (message.params.type === "warning") consoleCounts.warning++;
      if (/Lock.*not released/.test(text)) consoleCounts.lockWarnings++;
      if (/Fast Refresh/.test(text)) consoleCounts.fastRefresh++;
    }
  };
  await cdp("Runtime.enable"); await cdp("Page.enable"); await cdp("Network.enable");
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__longTasks = []; new PerformanceObserver(list => window.__longTasks.push(...list.getEntries().map(x => x.duration))).observe({type:'longtask',buffered:true});
    const originalFetch = window.fetch; window.fetch = async (input, init) => {
      const url = String(input);
      if(url.includes('/api/news') && window.__mockEmptyNews) return Response.json({articles:[]});
      if(url.includes('/api/ai/briefing') || url.includes('/api/send-newsletter')) throw new Error('Blocked during profiling');
      if(url.includes('/api/auth/login') || url.includes('/api/auth/signup')) return new Response('<html>Synthetic 404</html>',{status:404,headers:{'Content-Type':'text/html'}});
      return originalFetch(input, init);
    };
  ` });
  const started = performance.now();
  await cdp("Page.navigate", { url: origin });
  await until(() => evaluate("Boolean(document.getElementById('category-filter')) && document.readyState === 'complete'"), "homepage");
  await wait(4000);
  const metrics = await evaluate(`(() => { const n = performance.getEntriesByType('navigation')[0]; return {
    ttfbMs:Math.round(n.responseStart), responseEndMs:Math.round(n.responseEnd), domContentLoadedMs:Math.round(n.domContentLoadedEventEnd), loadMs:Math.round(n.loadEventEnd),
    nodes:document.querySelectorAll('*').length, articleElements:document.querySelectorAll('article').length,
    longTaskCount:window.__longTasks.length, longTaskMs:Math.round(window.__longTasks.reduce((a,b)=>a+b,0)), longestTaskMs:Math.round(Math.max(0,...window.__longTasks)),
    aiPanelVisible:Boolean(document.querySelector('[aria-label="AI news briefing"]'))
  }; })()`);
  metrics.profileElapsedMs = Math.round(performance.now() - started);
  const heap = await cdp("Runtime.getHeapUsage"); metrics.heapUsedMB = Math.round(heap.usedSize / 1024 / 1024);
  const latency = performance.now(); await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))"); metrics.twoFramesMs = Math.round(performance.now() - latency);
  metrics.initialNewsRequests = requests.filter(item => item.kind === '/api/news').length;
  const idleRefreshStart = consoleCounts.fastRefresh;
  await wait(5000);
  metrics.idleFastRefreshEvents = consoleCounts.fastRefresh - idleRefreshStart;
  if (label !== "baseline") {
    await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Show more')).click()");
    await until(() => evaluate("document.querySelectorAll('article').length === 120"), "show more adds the next 30 stories in both layouts");
    await evaluate("(() => { const el=document.getElementById('category-filter'); el.value='technology'; el.dispatchEvent(new Event('change',{bubbles:true})); })()");
    await until(() => evaluate("document.querySelectorAll('article').length > 0 && document.querySelectorAll('article').length <= 60"), "category filtering resets pagination");
    metrics.paginationAndFilterPassed = true;
    await evaluate("document.querySelector('[aria-label=\"Refresh headlines\"]').click()");
    await until(() => evaluate("!document.querySelector('[aria-label=\"Refresh headlines\"]').disabled"), "manual refresh completes");
    const articleCount = await evaluate("document.querySelectorAll('article').length");
    await evaluate("window.__mockEmptyNews=true; document.querySelector('[aria-label=\"Refresh headlines\"]').click()");
    await until(() => evaluate("document.body.textContent.includes('Keeping the current stories')"), "empty refresh reports failure");
    assert.equal(await evaluate("document.querySelectorAll('article').length"), articleCount);
    metrics.manualRefreshAndFailureRecoveryPassed = true;
  }
  await evaluate("location.hash = '#public-auth-panel-login'");
  await until(() => evaluate("Boolean(document.getElementById('auth-email'))"), "auth panel");
  await evaluate(`(() => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; for (const [id,value] of [['auth-email','fixture@example.com'],['auth-password','not-a-real-password']]) { const el = document.getElementById(id); setter.call(el,value); el.dispatchEvent(new Event('input',{bubbles:true})); } })()`);
  await wait(200);
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Log in' && b.className.includes('w-full')).click()");
  await wait(1200);
  metrics.mockedHtml404LeavesWorking = await evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Working') && b.disabled)");
  if (label !== "baseline") {
    assert.equal(metrics.mockedHtml404LeavesWorking, false);
    assert.ok(await evaluate("document.body.textContent.includes('The sign-in service was not found')"));
  }
  const report = { label, metrics, requests: requests.map(({ kind, status, ttfbMs }) => ({ kind, status, ttfbMs })), failures, consoleCounts };
  writeFileSync(path.join(directory, label + ".json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ label, ...metrics, consoleCounts, newsRequests: requests.filter((item) => item.kind === '/api/news').length, requestCount: requests.length }));
} finally { socket?.close(); browser.kill(); }
