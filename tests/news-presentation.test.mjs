import assert from "node:assert/strict";
import test from "node:test";

import { isNewYorkTimesSource } from "../lib/news-presentation.ts";

test("recognizes New York Times source naming variants for paywall badges", () => {
  assert.equal(isNewYorkTimesSource("The New York Times"), true);
  assert.equal(isNewYorkTimesSource("New York Times"), true);
  assert.equal(isNewYorkTimesSource("NYTimes"), true);
  assert.equal(isNewYorkTimesSource("NYT"), true);
  assert.equal(isNewYorkTimesSource("BBC News"), false);
});
