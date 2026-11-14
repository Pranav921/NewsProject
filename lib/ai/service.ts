import { createHash, randomUUID } from "node:crypto";
import { BRIEFING_NOTICE, BRIEFING_VERSION, selectBriefingArticles, validateBriefingOutput } from "./briefing.ts";
import type { Briefing, BriefingArticle } from "./briefing.ts";
import { BriefingError } from "./settings.ts";
import type { BriefingConfig } from "./settings.ts";
import type { NewsItem } from "../types.ts";
import type { ModelResult } from "./provider.ts";

export type StoredBriefing = {
  articles: BriefingArticle[];
  output: unknown;
  generatedAt: string;
  expiresAt: string;
  fingerprint: string;
};

export interface BriefingStore {
  getCached(scope: string): Promise<unknown>;
  acquire(owner: string): Promise<boolean>;
  reserve(owner: string, config: BriefingConfig): Promise<void>;
  complete(owner: string, scope: string, value: StoredBriefing, seconds: number): Promise<void>;
  fail(owner: string, retrySeconds: number): Promise<void>;
  release(owner: string): Promise<void>;
}

export function briefingScope(config: BriefingConfig) {
  return createHash("sha256").update(JSON.stringify({ provider: "anthropic", version: BRIEFING_VERSION, model: config.model, limits: config.limits, cacheSeconds: config.cacheSeconds, maxOutputTokens: config.maxOutputTokens })).digest("hex").slice(0, 24);
}

function cachedBriefing(value: unknown, config: BriefingConfig, now: Date): Briefing | null {
  try {
    if (!value || typeof value !== "object") return null;
    const cached = value as StoredBriefing;
    const generated = Date.parse(cached.generatedAt);
    const expires = Date.parse(cached.expiresAt);
    if (!Number.isFinite(generated) || !Number.isFinite(expires) || generated > now.getTime() || expires <= now.getTime() || expires - generated > config.cacheSeconds * 1000) return null;
    if (!Array.isArray(cached.articles) || !cached.articles.length || cached.articles.some((article) => !article || typeof article.link !== "string" || typeof article.title !== "string" || typeof article.source !== "string" || (article.summary !== null && typeof article.summary !== "string"))) return null;
    // Revalidate stored evidence without applying today's editorial ordering.
    const articles = selectBriefingArticles(cached.articles, now, config.limits, "stored");
    if (JSON.stringify(articles) !== JSON.stringify(cached.articles)) return null;
    return { generatedAt: cached.generatedAt, expiresAt: cached.expiresAt, notice: BRIEFING_NOTICE, items: validateBriefingOutput(cached.output, articles, config.limits) };
  } catch { return null; }
}

export async function getOrGenerateBriefing(deps: {
  config: BriefingConfig;
  store: BriefingStore;
  fetchArticles: () => Promise<NewsItem[]>;
  generate: (articles: BriefingArticle[]) => Promise<ModelResult>;
  now?: () => Date;
}) {
  const { config, store } = deps;
  const now = deps.now ?? (() => new Date());
  const scope = briefingScope(config);
  const cached = cachedBriefing(await store.getCached(scope), config, now());
  if (cached) return { briefing: cached, cacheHit: true };
  const owner = randomUUID();
  if (!await store.acquire(owner)) {
    // The other worker may have just published between our read and lock attempt.
    const completed = cachedBriefing(await store.getCached(scope), config, now());
    if (completed) return { briefing: completed, cacheHit: true };
    throw new BriefingError("generation-in-progress", 503, 3);
  }
  let attempted = false;
  try {
    const secondRead = cachedBriefing(await store.getCached(scope), config, now());
    if (secondRead) return { briefing: secondRead, cacheHit: true };
    const articles = selectBriefingArticles(await deps.fetchArticles(), now(), config.limits);
    if (!articles.length) throw new BriefingError("no-recent-articles", 503, config.retrySeconds);
    // Reserve atomically before invoking the provider; never refund failed calls.
    await store.reserve(owner, config);
    attempted = true;
    const result = await deps.generate(articles);
    const items = validateBriefingOutput(result.output, articles, config.limits);
    const generatedAt = now();
    // Keep the persisted order compatible with deployed metadata-v2 readers.
    // Claude still receives editorial order; references use canonical links.
    const storedArticles = [...articles].sort((a, b) => b.publishedAt!.localeCompare(a.publishedAt!) || a.link.localeCompare(b.link));
    const stored: StoredBriefing = {
      articles: storedArticles, output: result.output, generatedAt: generatedAt.toISOString(),
      expiresAt: new Date(generatedAt.getTime() + config.cacheSeconds * 1000).toISOString(),
      fingerprint: createHash("sha256").update(JSON.stringify(storedArticles)).digest("hex"),
    };
    await store.complete(owner, scope, stored, config.cacheSeconds);
    return { briefing: { generatedAt: stored.generatedAt, expiresAt: stored.expiresAt, notice: BRIEFING_NOTICE, items }, cacheHit: false, usage: result.usage, articleCount: articles.length };
  } catch (error) {
    if (attempted || error instanceof BriefingError && error.code === "no-recent-articles") await store.fail(owner, config.retrySeconds);
    throw error;
  } finally {
    await store.release(owner);
  }
}
