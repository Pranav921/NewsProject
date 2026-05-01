import type { MetadataRoute } from "next";
import { buildCanonicalUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    host: buildCanonicalUrl("/"),
    rules: [
      {
        allow: "/",
        disallow: ["/account", "/email-analytics", "/api/"],
        userAgent: "*",
      },
    ],
    sitemap: buildCanonicalUrl("/sitemap.xml"),
  };
}
