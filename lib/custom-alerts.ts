import { getFeedCoverage } from "./feeds.ts";
import type { NewsItem } from "./types";

export const CUSTOM_ALERT_KEYWORDS_STORAGE_KEY =
  "breaking-news-custom-alert-keywords";

type AlertKeywordRow = {
  keyword: string;
};

export function normalizeAlertKeyword(keyword: string): string {
  return keyword.trim().toLowerCase();
}

export function parseAlertKeywords(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsedValue = JSON.parse(value) as unknown;

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return [
      ...new Set(parsedValue.filter(isAlertKeyword).map(normalizeAlertKeyword)),
    ].filter(Boolean);
  } catch {
    return [];
  }
}

export function fromAlertKeywordRows(rows: AlertKeywordRow[] | null): string[] {
  if (!rows) {
    return [];
  }

  return [...new Set(rows.map((row) => normalizeAlertKeyword(row.keyword)))].filter(
    Boolean,
  );
}

export function addAlertKeyword(
  alertKeywords: string[],
  keyword: string,
): string[] {
  const normalizedKeyword = normalizeAlertKeyword(keyword);

  if (!normalizedKeyword || alertKeywords.includes(normalizedKeyword)) {
    return alertKeywords;
  }

  return [...alertKeywords, normalizedKeyword];
}

export function removeAlertKeyword(
  alertKeywords: string[],
  keywordToRemove: string,
): string[] {
  const normalizedKeywordToRemove = normalizeAlertKeyword(keywordToRemove);

  return alertKeywords.filter((keyword) => keyword !== normalizedKeywordToRemove);
}

export function articleMatchesAlertKeywords(
  article: NewsItem,
  alertKeywords: string[],
): boolean {
  if (alertKeywords.length === 0) {
    return false;
  }

  const searchableText = [article.title, article.summary ?? ""]
    .join(" ")
    .toLowerCase();

  return alertKeywords.some((keyword) => searchableText.includes(keyword));
}

const ALERT_TOPIC_SUGGESTIONS: Array<{ keyword: string; pattern: RegExp }> = [
  {
    keyword: "culture",
    pattern:
      /\b(met gala|fashion|celebrity|hollywood|film|movie|music|album|festival|art show|museum|broadway)\b/i,
  },
  {
    keyword: "entertainment",
    pattern:
      /\b(rapper|rap|tour|concert|music|album|artist|singer|actor|actress|comedian|kid cudi)\b/i,
  },
  {
    keyword: "shipping",
    pattern:
      /\b(shipping|ship|ships|tanker|tankers|cargo|freight|container ship|port|trade route|strait of hormuz)\b/i,
  },
  {
    keyword: "middle east",
    pattern:
      /\b(iran|israel|gaza|hamas|hezbollah|tehran|jerusalem|middle east|hormuz)\b/i,
  },
  {
    keyword: "politics",
    pattern:
      /\b(election|president|white house|senate|house|congress|court|judge|ruling|bill|campaign|minister|parliament|vote|trump|biden|prime minister|pm)\b/i,
  },
  {
    keyword: "business",
    pattern:
      /\b(company|companies|ceo|earnings|merger|acquisition|industry|startup|corporate|retail|factory|manufacturing)\b/i,
  },
  {
    keyword: "housing",
    pattern:
      /\b(housing|home prices|homebuyer|home buyers|mortgage|rent|rents|affordable housing|real estate|property market|house prices)\b/i,
  },
  {
    keyword: "markets",
    pattern:
      /\b(stock|stocks|market|markets|oil|inflation|tariff|trade|economy|bank|fed|interest rate|futures|nasdaq|dow|s&p)\b/i,
  },
  {
    keyword: "tech",
    pattern:
      /\b(ai|artificial intelligence|tech|apple|google|microsoft|meta|tesla|chip|chips|software|cyber|startup)\b/i,
  },
  {
    keyword: "health",
    pattern:
      /\b(health|hospital|disease|virus|covid|flu|vaccine|medical|medicare|doctor|patient)\b/i,
  },
  {
    keyword: "sports",
    pattern:
      /\b(nba|nfl|mlb|nhl|soccer|football|baseball|basketball|tennis|golf|formula 1|f1|olympic|playoff|final)\b/i,
  },
  {
    keyword: "climate",
    pattern:
      /\b(climate|wildfire|storm|hurricane|flood|heat wave|drought|emissions|environment)\b/i,
  },
  {
    keyword: "aviation",
    pattern:
      /\b(airline|airport|air travel|aviation|plane|jet|flight|runway|boeing|airbus|united|delta|american airlines|newark)\b/i,
  },
  {
    keyword: "crime",
    pattern:
      /\b(police|shooting|murder|terror|attack|investigation|arrest|victim|suspect|crime|abuse)\b/i,
  },
];

export function suggestAlertKeywordForArticle(article: NewsItem): string {
  const titleText = article.title;
  const fullText = [article.title, article.summary ?? "", article.source].join(" ");

  const titleTopicSuggestion = ALERT_TOPIC_SUGGESTIONS.find(({ pattern }) =>
    pattern.test(titleText),
  );

  if (titleTopicSuggestion) {
    return titleTopicSuggestion.keyword;
  }

  const broaderTopicSuggestion = ALERT_TOPIC_SUGGESTIONS.find(({ pattern }) =>
    pattern.test(fullText),
  );

  if (broaderTopicSuggestion) {
    return broaderTopicSuggestion.keyword;
  }

  const coverage = getFeedCoverage(article.source);

  if (coverage === "national") {
    return "u.s. news";
  }

  if (coverage === "international") {
    return "world news";
  }

  return "top stories";
}

function isAlertKeyword(value: unknown): value is string {
  return typeof value === "string";
}
