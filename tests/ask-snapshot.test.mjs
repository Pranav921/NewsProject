import assert from "node:assert/strict";
import test from "node:test";
import { loadAiModule } from "./helpers/load-ai-module.mjs";
import * as retrieval from "../lib/ai/ask-retrieval.ts";
import * as contract from "../lib/ai/ask.ts";
import { ASK_NOW, askArticles } from "./fixtures/ask-news.mjs";

test("internal Ask loader reads the cached RSS interface once; all tools share the snapshot without further I/O", async () => {
  let reads = 0;
  const { loadAskTools } = loadAiModule("../../lib/ai/ask-snapshot.ts", {
    "../rss.ts": { async getNewsSnapshot(...args) {
      assert.deepEqual(args, [], "never force RSS refresh"); reads++;
      return { articles: askArticles, feedStatus: { failedFeeds: 1, staleFeeds: 0 } };
    } },
    "./ask-retrieval.ts": retrieval, "./ask.ts": contract,
  }, { fetch: () => assert.fail("unexpected external request") });
  const { snapshot, tools } = await loadAskTools(ASK_NOW);
  tools.search_articles({ query: "Nvidia" });
  tools.recent_news({});
  tools.article_details({ articleId: snapshot.articles[0].id });
  assert.equal(reads, 1);
  assert.equal(tools.recent_news({}).coverage.failedFeeds, 1);
});

test("RSS loader exceptions become sanitized errors, while partial/failed-feed metadata remains visible", async () => {
  const { loadAskTools } = loadAiModule("../../lib/ai/ask-snapshot.ts", {
    "../rss.ts": { async getNewsSnapshot() { throw new Error("private provider credential detail"); } },
    "./ask-retrieval.ts": retrieval, "./ask.ts": contract,
  });
  await assert.rejects(loadAskTools(ASK_NOW), error => error instanceof contract.AskRetrievalError
    && error.code === "snapshot-unavailable" && !error.message.includes("private"));
});
