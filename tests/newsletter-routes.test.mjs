import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { getValidatedNewsletterSettings } from "../lib/newsletter-subscription-settings.ts";

// Compile the real route with boundary mocks so no database or emails are touched.
function loadRoute(routePath, { existing = null, user = { id: "user-1", email: "USER@example.com" }, writeError = null } = {}) {
  const writes = [];
  const scopes = [];
  const builder = {
    select() { return this; },
    eq(key, value) { scopes.push([key, value]); return this; },
    async maybeSingle() { return { data: existing, error: null }; },
    update(data) { writes.push({ action: "update", data }); return this; },
    async insert(data) { writes.push({ action: "insert", data }); return { error: writeError }; },
    then(resolve, reject) { return Promise.resolve({ error: writeError }).then(resolve, reject); },
  };
  const supabase = { auth: { async getUser() { return { data: { user } }; } }, from(table) { assert.equal(table, "newsletter_subscriptions"); return builder; } };
  const imports = {
    "@/lib/newsletter-subscription-settings": { getValidatedNewsletterSettings },
    "@/lib/api-logging": { logApiError() {}, logApiInfo() {} },
    "@/lib/ratelimit": { async enforceRateLimit() { return null; } },
    "@/lib/supabase/server": { async createSupabaseServerClient() { return supabase; } },
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
  };
  const code = ts.transpileModule(readFileSync(new URL(routePath, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  runInNewContext(code, { exports, require(name) { assert.ok(imports[name], `Unexpected dependency ${name}`); return imports[name]; }, Date });
  return { handlers: exports, writes, scopes };
}
function request(body) { return new Request("https://example.com/api/newsletter-subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }

for (const [routePath, methods] of [["../app/api/newsletter-subscriptions/route.ts", ["POST", "PUT"]], ["../app/api/newsletter/subscribe/route.ts", ["POST"]]]) {
  for (const method of methods) {
    for (const existing of [null, { id: 17, is_active: false }, ...(method === "PUT" ? [{ id: 17, is_active: true }] : [])]) {
      test(`${routePath} ${method} persists category order on ${existing ? existing.is_active ? "update" : "reactivation" : "insert"}`, async () => {
        const { handlers, writes, scopes } = loadRoute(routePath, { existing });
        const response = await handlers[method](request({ preferredFrequency: "weekly", sortOrder: "category", emailFormat: "compact", articleMode: "all_missed" }));
        assert.equal(response.status, 200);
        assert.equal(writes.length, 1);
        assert.equal(writes[0].data.sort_order, "category");
        assert.equal(writes[0].data.frequency, "weekly");
        assert.equal(writes[0].data.email_format, "compact");
        assert.equal(writes[0].data.user_id, "user-1");
        assert.ok(scopes.some(([key, value]) => key === "email" && value === "user@example.com"));
        if (existing) assert.ok(scopes.some(([key, value]) => key === "id" && value === 17));
      });
    }
    test(`${routePath} ${method} rejects invalid ordering without writes`, async () => {
      const { handlers, writes } = loadRoute(routePath);
      const response = await handlers[method](request({ preferredFrequency: "daily", sortOrder: "unsafe" }));
      assert.equal(response.status, 400);
      assert.equal(writes.length, 0);
    });
    test(`${routePath} ${method} requires authentication`, async () => {
      const { handlers, writes } = loadRoute(routePath, { user: null });
      assert.equal((await handlers[method](request({ preferredFrequency: "daily", sortOrder: "category" }))).status, 401);
      assert.equal(writes.length, 0);
    });
    test(`${routePath} ${method} reports a database write failure`, async () => {
      const { handlers } = loadRoute(routePath, { writeError: { message: "Write failed" } });
      assert.equal((await handlers[method](request({ preferredFrequency: "daily", sortOrder: "category" }))).status, 500);
    });
  }
}
