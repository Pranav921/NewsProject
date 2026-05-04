import assert from "node:assert/strict";
import test from "node:test";

import { extractLeadImageFromArticleHtml } from "../lib/article-images.ts";
import { parseRssXml } from "../lib/rss.ts";
import { stripHtml } from "../lib/rss-format.ts";

test("stripHtml decodes numeric apostrophe entities used in RSS titles", () => {
  assert.equal(
    stripHtml("Watch a Spirit pilot&amp;#039;s impromptu retirement celebration"),
    "Watch a Spirit pilot's impromptu retirement celebration",
  );
});

test("parseRssXml extracts article images from RSS media tags and HTML summaries", () => {
  const feed = {
    coverage: "both",
    name: "Example Feed",
    url: "https://example.com/rss",
  };

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
      <channel>
        <item>
          <title>Lead story with media image</title>
          <link>https://example.com/story-1</link>
          <description><![CDATA[<p>Summary.</p><img src="https://cdn.example.com/story-1.jpg" />]]></description>
          <media:content url="https://cdn.example.com/story-1-media.jpg" medium="image" />
          <pubDate>Mon, 04 May 2026 12:00:00 GMT</pubDate>
        </item>
        <item>
          <title>Story with inline image only</title>
          <link>https://example.com/story-2</link>
          <description><![CDATA[<p>Summary.</p><img src="//cdn.example.com/story-2.jpg" />]]></description>
          <pubDate>Mon, 04 May 2026 11:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>`;

  const items = parseRssXml(xml, feed);

  assert.equal(items[0]?.imageUrl, "https://cdn.example.com/story-1-media.jpg");
  assert.equal(items[1]?.imageUrl, "https://cdn.example.com/story-2.jpg");
});

test("parseRssXml prefers larger srcset and upgraded image variants", () => {
  const feed = {
    coverage: "both",
    name: "Example Feed",
    url: "https://example.com/rss",
  };

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>Story with resized inline image</title>
          <link>https://example.com/story-3</link>
          <description><![CDATA[
            <p>Summary with image.</p>
            <img
              src="https://cdn.example.com/story-3-300x200.jpg?w=300&h=200&q=60"
              srcset="https://cdn.example.com/story-3-300x200.jpg 300w, https://cdn.example.com/story-3-1200x800.jpg 1200w"
            />
          ]]></description>
          <pubDate>Mon, 04 May 2026 10:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>`;

  const items = parseRssXml(xml, feed);

  assert.equal(items[0]?.imageUrl, "https://cdn.example.com/story-3.jpg");
});

test("extractLeadImageFromArticleHtml prefers og:image from the article page", () => {
  const html = `
    <html>
      <head>
        <meta property="og:image" content="/images/lead-hero.jpg" />
        <meta name="twitter:image" content="https://cdn.example.com/fallback.jpg" />
      </head>
      <body>
        <img src="/images/inline.jpg" />
      </body>
    </html>
  `;

  assert.equal(
    extractLeadImageFromArticleHtml(html, "https://example.com/story"),
    "https://example.com/images/lead-hero.jpg",
  );
});

test("extractLeadImageFromArticleHtml can use json-ld and lazy image attributes", () => {
  const html = `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "NewsArticle",
            "image": [
              "https://cdn.example.com/lead-1600.jpg"
            ]
          }
        </script>
      </head>
      <body>
        <img data-src="/images/lazy.jpg" />
      </body>
    </html>
  `;

  assert.equal(
    extractLeadImageFromArticleHtml(html, "https://example.com/story"),
    "https://cdn.example.com/lead-1600.jpg",
  );
});
