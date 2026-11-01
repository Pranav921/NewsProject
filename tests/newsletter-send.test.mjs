import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import * as newsletter from "../lib/newsletter.ts";
import { deduplicateNewsletterArticles } from "../lib/newsletter-deduplication.ts";
import { selectNewsletterArticlesForUser } from "../lib/personalization.ts";

function loadSender({ migrated = false, providerStatus = 200, lastSent = null } = {}) {
  const deliveries = [], writes = [], sorts = [], reads = [];
  const subscriptions = ["reader@example.com", "other@example.com"].map((email, index) => ({
    id: index + 1, user_id: null, email, is_active: true, frequency: "daily",
    custom_frequency: null, article_mode: "all_missed", email_format: "standard",
    last_sent_at: lastSent, unsubscribe_token: "fixture-token",
    ...(migrated ? { sort_order: "category" } : {}),
  }));
  subscriptions.push({ ...subscriptions[0], id: 3, email: "paused@example.com", is_active: false });
  const supabase = { from(table) {
    let columns = "*", payload = null, action = null;
    const filters = [];
    const result = () => {
      if (action) {
        writes.push({ table, action, payload, filters });
        return { data: { id: "send-log" }, error: null };
      }
      reads.push({ table, columns, filters });
      if (table === "newsletter_subscriptions") {
        if (!migrated && columns.includes("sort_order")) return { data: null, error: { code: "42703", message: "column newsletter_subscriptions.sort_order does not exist" } };
        return { data: subscriptions.filter(row => filters.every(([key, value]) => row[key] === value)), error: null };
      }
      return { data: [], error: null };
    };
    const builder = {
      select(value) { columns = value; return this; },
      eq(key, value) { filters.push([key, value]); return this; },
      in() { return this; }, order() { return this; }, limit() { return this; },
      update(value) { action = "update"; payload = value; return this; },
      insert(value) { action = "insert"; payload = value; return this; },
      async single() { return result(); },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    };
    return builder;
  } };
  const article = { title: "Astronauts prepare next space station mission", link: "https://example.com/story", source: "NASA", category: "science", summary: null, publishedAt: new Date().toISOString() };
  const imports = {
    "@/lib/rss": { async getAllNewsItems() { return [article]; } },
    "@/lib/api-logging": { logApiError() {}, logApiInfo() {} },
    "@/lib/newsletter": { ...newsletter,
      buildNewsletterUnsubscribeUrl: () => "https://example.com/unsubscribe",
      buildNewsletterEmailHtml(...args) { sorts.push(args[5]); return "<p>Newsletter</p>"; },
      buildNewsletterEmailText: () => "Newsletter",
    },
    "@/lib/newsletter-deduplication": { deduplicateNewsletterArticles },
    "@/lib/personalization": { selectNewsletterArticlesForUser },
    "@/lib/supabase/admin": { createSupabaseAdminClient: () => supabase },
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("../app/api/send-newsletter/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, require(name) { assert.ok(imports[name], name); return imports[name]; },
    process: { env: { NODE_ENV: "production", CRON_SECRET: "fixture-secret", RESEND_API_KEY: "fixture-key" } },
    URL, Date, crypto: webcrypto,
    async fetch(url, init) {
      assert.equal(url, "https://api.resend.com/emails");
      deliveries.push(JSON.parse(init.body));
      return Response.json(providerStatus === 200 ? { id: "provider-id" } : { message: "Provider unavailable" }, { status: providerStatus });
    },
  });
  return { handler: exports.GET, deliveries, writes, sorts, reads };
}
function request(query = "", authorized = true) { return new Request(`https://example.com/api/send-newsletter${query}`, { headers: authorized ? { authorization: "Bearer fixture-secret" } : {} }); }

for (const migrated of [false, true]) {
  test(`scheduled delivery works ${migrated ? "with category preferences" : "before the optional category migration"}`, async () => {
    const { handler, deliveries, writes, sorts } = loadSender({ migrated });
    const response = await handler(request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sent, 2);
    assert.equal(deliveries.length, 2);
    assert.deepEqual(sorts, [migrated ? "category" : "default", migrated ? "category" : "default"]);
    assert.equal(writes.filter(row => row.table === "newsletter_sent_articles").length, 2);
    assert.equal(writes.filter(row => row.table === "newsletter_subscriptions" && row.payload.last_status === "sent").length, 2);
  });
}
test("authenticated targeted delivery sends only to the requested active subscription", async () => {
  const { handler, deliveries, reads } = loadSender();
  const response = await handler(request("?email=READER%40example.com"));
  assert.equal((await response.json()).sent, 1);
  assert.deepEqual(deliveries.map(delivery => delivery.to), [["reader@example.com"]]);
  assert.ok(reads.find(row => row.table === "newsletter_subscriptions").filters.some(([key, value]) => key === "email" && value === "reader@example.com"));
});
test("targeted delivery still requires cron authorization", async () => {
  const { handler, deliveries, reads } = loadSender();
  assert.equal((await handler(request("?email=reader@example.com", false))).status, 401);
  assert.equal(deliveries.length, 0);
  assert.equal(reads.length, 0);
});
test("targeted delivery preserves the normal duplicate-send and active-subscription checks", async () => {
  const { handler, deliveries } = loadSender({ lastSent: new Date().toISOString() });
  assert.equal((await (await handler(request("?email=reader@example.com"))).json()).sent, 0);
  assert.equal(deliveries.length, 0);
  assert.equal((await (await handler(request("?email=not-subscribed@example.com"))).json()).sent, 0);
  assert.equal((await (await handler(request("?email=paused@example.com"))).json()).sent, 0);
});
test("provider failure is recorded without marking the subscription as sent", async () => {
  const { handler, writes } = loadSender({ providerStatus: 503 });
  const response = await handler(request("?email=reader@example.com"));
  assert.equal((await response.json()).failed, 1);
  assert.ok(writes.some(row => row.table === "newsletter_subscriptions" && row.payload.last_status === "failed"));
  assert.ok(!writes.some(row => row.table === "newsletter_subscriptions" && row.payload.last_sent_at));
});
