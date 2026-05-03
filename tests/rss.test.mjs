import assert from "node:assert/strict";
import test from "node:test";

import { stripHtml } from "../lib/rss-format.ts";

test("stripHtml decodes numeric apostrophe entities used in RSS titles", () => {
  assert.equal(
    stripHtml("Watch a Spirit pilot&amp;#039;s impromptu retirement celebration"),
    "Watch a Spirit pilot's impromptu retirement celebration",
  );
});
