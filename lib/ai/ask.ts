import { isNewsCategory, NEWS_CATEGORIES } from "../news-categories.ts";
import type { NewsCategory } from "../types.ts";

export const ASK_LIMITS = Object.freeze({ snapshotArticles: 300, snapshotBytes: 262144,
  resultArticles: 8, resultBytes: 12288, queryCharacters: 160, sourceFilters: 3, hours: 168 });

export class AskRetrievalError extends Error {
  code: "invalid-arguments" | "invalid-snapshot" | "snapshot-unavailable";
  constructor(code: AskRetrievalError["code"]) {
    super(code);
    this.name = "AskRetrievalError";
    this.code = code;
  }
}

export type AskArticle = Readonly<{
  id: string; title: string; link: string; source: string; category: NewsCategory;
  summary: string | null; publishedAt: string;
}>;
export type AskFilters = { category?: NewsCategory; sources: string[]; hours: number; limit: number };
export type AskSearchArguments = AskFilters & { query: string; mode: "stories" | "publishers" };
export type AskCoverage = {
  asOf: string;
  requestedWindow: { from: string; to: string };
  availableWindow: { from: string | null; to: string | null };
  snapshotArticleCount: number; matchingArticleCount: number; returnedArticleCount: number;
  sourceCount: number; categories: NewsCategory[];
  failedFeeds: number | null; staleFeeds: number | null;
  canonicalDuplicatesOmitted: number; invalidArticlesOmitted: number;
  duplicateReportsOmitted: number; snapshotTruncated: boolean; resultsTruncated: boolean;
  byteLimitReached: boolean; exhaustive: false;
};
export type AskResult = {
  status: "ok" | "no_results" | "not_found" | "unavailable";
  articles: AskArticle[]; coverage: AskCoverage; limitations: string[];
};

const idPattern = "^article_[a-f0-9]{64}$";
const categorySchema = { type: "string", enum: NEWS_CATEGORIES.map(category => category.value) };
const articleSchema = {
  type: "object", additionalProperties: false,
  required: ["id", "title", "link", "source", "category", "summary", "publishedAt"],
  properties: {
    id: { type: "string", pattern: idPattern, minLength: 72, maxLength: 72 }, title: { type: "string", minLength: 1, maxLength: 200 },
    link: { type: "string", maxLength: 1200, pattern: "^https?://" },
    source: { type: "string", minLength: 1, maxLength: 80 }, category: categorySchema,
    summary: { type: ["string", "null"], maxLength: 220 }, publishedAt: { type: "string", format: "date-time" },
  },
};
const countSchema = { type: "integer", minimum: 0 };
const nullableDate = { type: ["string", "null"], format: "date-time" };
const windowSchema = { type: "object", additionalProperties: false, required: ["from", "to"],
  properties: { from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" } } };
const coverageProperties = {
  asOf: { type: "string", format: "date-time" }, requestedWindow: windowSchema,
  availableWindow: { ...windowSchema, properties: { from: nullableDate, to: nullableDate } },
  snapshotArticleCount: countSchema, matchingArticleCount: countSchema, returnedArticleCount: countSchema,
  sourceCount: countSchema, categories: { type: "array", uniqueItems: true, items: categorySchema },
  failedFeeds: { type: ["integer", "null"], minimum: 0 }, staleFeeds: { type: ["integer", "null"], minimum: 0 },
  canonicalDuplicatesOmitted: countSchema, invalidArticlesOmitted: countSchema, duplicateReportsOmitted: countSchema,
  snapshotTruncated: { type: "boolean" }, resultsTruncated: { type: "boolean" }, byteLimitReached: { type: "boolean" },
  exhaustive: { const: false },
};
// Output is constructed by the tools, never accepted from an untrusted model.
export const ASK_RESULT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["status", "articles", "coverage", "limitations"],
  properties: {
    status: { type: "string", enum: ["ok", "no_results", "not_found", "unavailable"] },
    articles: { type: "array", maxItems: ASK_LIMITS.resultArticles, items: articleSchema },
    coverage: { type: "object", additionalProperties: false, required: Object.keys(coverageProperties), properties: coverageProperties },
    limitations: { type: "array", items: { type: "string" } },
  },
};

// JSON schemas for the future Messages tool boundary; runtime parsing below is
// authoritative and also checks that source labels belong to this snapshot.
export function askToolDefinitions(sources: readonly string[]) {
  const filters = {
    category: categorySchema,
    sources: { type: "array", minItems: 1, maxItems: ASK_LIMITS.sourceFilters, uniqueItems: true,
      items: { type: "string", enum: [...sources] } },
    hours: { type: "integer", minimum: 1, maximum: ASK_LIMITS.hours, description: "Rolling hours back from snapshot time; default 24." },
    limit: { type: "integer", minimum: 1, maximum: ASK_LIMITS.resultArticles, description: "Maximum returned articles; default 8." },
  };
  return [
    { name: "search_articles", description: "Keyword search of available titles and summaries, not semantic or exhaustive search. Use publishers mode to compare distinct publisher reports.", input_schema: {
      type: "object", additionalProperties: false, required: ["query"], properties: { ...filters,
        query: { type: "string", minLength: 1, maxLength: ASK_LIMITS.queryCharacters },
        mode: { type: "string", enum: ["stories", "publishers"], description: "Default stories deduplicates events; publishers retains distinct source coverage." },
      },
    } },
    { name: "recent_news", description: "Recent available RSS stories with soft source/topic diversity. Coverage is incomplete.", input_schema: {
      type: "object", additionalProperties: false, required: [], properties: filters,
    } },
    { name: "article_details", description: "Existing snapshot metadata only. No URL fetching or full article text; unknown IDs return not_found.", input_schema: {
      type: "object", additionalProperties: false, required: ["articleId"],
      properties: { articleId: { type: "string", pattern: idPattern, minLength: 72, maxLength: 72 } },
    } },
  ];
}

function argumentObject(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new AskRetrievalError("invalid-arguments");
  }
  return value as Record<string, unknown>;
}
function invalid(): never { throw new AskRetrievalError("invalid-arguments"); }
function filters(value: Record<string, unknown>, knownSources: readonly string[]): AskFilters {
  const integer = (key: string, fallback: number, max: number) => {
    if (!Object.hasOwn(value, key)) return fallback;
    const number = value[key];
    return typeof number === "number" && Number.isInteger(number) && number >= 1 && number <= max ? number : invalid();
  };
  let category: NewsCategory | undefined;
  if (Object.hasOwn(value, "category")) {
    if (!isNewsCategory(value.category)) return invalid();
    category = value.category;
  }
  let sources: string[] = [];
  if (Object.hasOwn(value, "sources")) {
    if (!Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > ASK_LIMITS.sourceFilters
      || value.sources.some(source => typeof source !== "string" || !knownSources.includes(source))
      || new Set(value.sources).size !== value.sources.length) return invalid();
    sources = [...value.sources];
  }
  return { category, sources, hours: integer("hours", 24, ASK_LIMITS.hours), limit: integer("limit", 8, ASK_LIMITS.resultArticles) };
}
export function parseAskSearch(value: unknown, sources: readonly string[]): AskSearchArguments {
  const args = argumentObject(value, ["query", "category", "sources", "hours", "limit", "mode"]);
  if (!Object.hasOwn(args, "query") || typeof args.query !== "string" || !args.query.trim() || args.query.length > ASK_LIMITS.queryCharacters
    || /[\u0000-\u001f\u007f]/.test(args.query)) return invalid();
  if (Object.hasOwn(args, "mode") && args.mode !== "stories" && args.mode !== "publishers") return invalid();
  return { ...filters(args, sources), query: args.query.trim(), mode: args.mode === "publishers" ? "publishers" : "stories" };
}
export function parseAskRecent(value: unknown, sources: readonly string[]): AskFilters {
  return filters(argumentObject(value, ["category", "sources", "hours", "limit"]), sources);
}
export function parseAskDetails(value: unknown): string {
  const args = argumentObject(value, ["articleId"]);
  return Object.hasOwn(args, "articleId") && typeof args.articleId === "string" && args.articleId.length === 72
    && new RegExp(idPattern).test(args.articleId) ? args.articleId : invalid();
}
