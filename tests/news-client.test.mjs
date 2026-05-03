import assert from "node:assert/strict";
import test from "node:test";

import { buildNewsRequestUrl } from "../lib/news-client.ts";

test("refresh requests use the cache-busting refresh query shape", () => {
  assert.equal(
    buildNewsRequestUrl("refresh", 123456),
    "/api/news?fresh=1&t=123456&refresh=1",
  );
});

test("update checks use the cache-busting polling query shape", () => {
  assert.equal(
    buildNewsRequestUrl("checkForUpdates", 654321),
    "/api/news?fresh=1&t=654321&checkForUpdates=1",
  );
});
