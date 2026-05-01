import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCanonicalUrl,
  buildSitemapEntries,
  getSiteUrl,
  PUBLIC_SITEMAP_ENTRIES,
} from "../lib/seo.ts";

function restoreEnv(key, value) {
  if (typeof value === "undefined") {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

test("getSiteUrl falls back to production URL when env vars are missing", () => {
  const originalAppBaseUrl = process.env.APP_BASE_URL;
  const originalPublicAppBaseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL;

  delete process.env.APP_BASE_URL;
  delete process.env.NEXT_PUBLIC_APP_BASE_URL;

  assert.equal(getSiteUrl(), "https://kicker.news");

  restoreEnv("APP_BASE_URL", originalAppBaseUrl);
  restoreEnv("NEXT_PUBLIC_APP_BASE_URL", originalPublicAppBaseUrl);
});

test("getSiteUrl trims trailing slashes from configured env vars", () => {
  const originalAppBaseUrl = process.env.APP_BASE_URL;

  process.env.APP_BASE_URL = "https://example.com///";

  assert.equal(getSiteUrl(), "https://example.com");

  restoreEnv("APP_BASE_URL", originalAppBaseUrl);
});

test("buildCanonicalUrl keeps the homepage canonical clean", () => {
  const originalAppBaseUrl = process.env.APP_BASE_URL;

  process.env.APP_BASE_URL = "https://example.com";

  assert.equal(buildCanonicalUrl("/"), "https://example.com/");
  assert.equal(buildCanonicalUrl("/about"), "https://example.com/about");

  restoreEnv("APP_BASE_URL", originalAppBaseUrl);
});

test("public sitemap entries do not include private routes", () => {
  const sitemapPaths = PUBLIC_SITEMAP_ENTRIES.map((entry) => entry.path);

  assert.equal(sitemapPaths.includes("/account"), false);
  assert.equal(sitemapPaths.includes("/email-analytics"), false);
  assert.equal(sitemapPaths.some((path) => path.startsWith("/api/")), false);
});

test("buildSitemapEntries returns canonical URLs for public routes only", () => {
  const originalAppBaseUrl = process.env.APP_BASE_URL;

  process.env.APP_BASE_URL = "https://example.com";

  const sitemapEntries = buildSitemapEntries(new Date("2026-04-30T00:00:00.000Z"));
  const sitemapUrls = sitemapEntries.map((entry) => entry.url);

  assert.equal(sitemapUrls.includes("https://example.com/"), true);
  assert.equal(sitemapUrls.includes("https://example.com/about"), true);
  assert.equal(sitemapUrls.includes("https://example.com/account"), false);
  assert.equal(
    sitemapUrls.some((url) => url.startsWith("https://example.com/api/")),
    false,
  );

  restoreEnv("APP_BASE_URL", originalAppBaseUrl);
});
