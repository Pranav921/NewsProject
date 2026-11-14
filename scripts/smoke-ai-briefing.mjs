// Explicitly paid opt-in check. Never imported by tests or called by CI.
import { loadAiModule } from "../tests/helpers/load-ai-module.mjs";
import * as briefing from "../lib/ai/briefing.ts";
import * as settings from "../lib/ai/settings.ts";

if (!process.argv.includes("--allow-paid-call") || process.env.AI_BRIEFING_LIVE_SMOKE_APPROVED !== "true") {
  console.log("No API call made. After approval, set AI_BRIEFING_LIVE_SMOKE_APPROVED=true and pass --allow-paid-call.");
} else {
  try {
    const config = settings.readBriefingConfig(process.env);
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new settings.BriefingError("missing-api-key");
    // Node does not implement Next's server-only marker. This uses the same VM
    // boundary loader as the mocked tests, but passes the real fetch explicitly.
    const { generateBriefing } = loadAiModule("../../lib/ai/provider.ts", {
      "./briefing.ts": briefing, "./settings.ts": settings,
      "@anthropic-ai/sdk": { __esModule: true, default: (await import("@anthropic-ai/sdk")).default },
      "@anthropic-ai/sdk/lib/transform-json-schema": await import("@anthropic-ai/sdk/lib/transform-json-schema"),
    });
    const articles = briefing.selectBriefingArticles([{
      title: "Synthetic test: Example Observatory announces an open evening",
      source: "Example Publisher (synthetic fixture)", link: "https://example.com/synthetic-observatory",
      summary: "This synthetic test fixture says Example Observatory announced a public open evening. No date or attendance figure is supplied.",
      publishedAt: new Date().toISOString(),
    }], new Date(), config.limits);
    const result = await generateBriefing(articles, config, apiKey, fetch);
    const items = briefing.validateBriefingOutput(result.output, articles, config.limits);
    console.log(JSON.stringify({ success: true, model: config.model, itemCount: items.length, usage: result.usage }));
  } catch (error) {
    console.error(error instanceof settings.BriefingError ? error.code : "smoke-test-failed");
    process.exitCode = 1;
  }
}
