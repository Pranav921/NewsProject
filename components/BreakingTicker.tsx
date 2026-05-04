import type { NewsItem } from "@/lib/types";
import { isBreakingStory } from "@/lib/news-presentation";

type BreakingTickerProps = {
  articles: NewsItem[];
};

function getBreakingTitles(articles: NewsItem[]): string[] {
  const sortedArticles = [...articles].sort((left, right) => {
    const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
    const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;

    return rightTime - leftTime;
  });
  const breakingArticles = sortedArticles.filter((article) => isBreakingStory(article));
  const tickerArticles = (breakingArticles.length > 0 ? breakingArticles : sortedArticles).slice(
    0,
    8,
  );

  return tickerArticles.map((article) => article.title);
}

export function BreakingTicker({ articles }: BreakingTickerProps) {
  const breakingTitles = getBreakingTitles(articles);

  if (breakingTitles.length === 0) {
    return null;
  }

  return (
    <div className="w-screen relative left-1/2 right-1/2 -mx-[50vw] bg-[var(--breaking)] text-white">
      <div className="mx-auto flex h-7 w-full items-center overflow-hidden pl-0 pr-3 sm:pr-6 md:pr-[28px]">
        <div className="mono-meta ml-0 inline-flex h-full shrink-0 items-center gap-[7px] bg-[rgba(0,0,0,0.2)] px-[14px] text-[9px] font-medium uppercase tracking-[0.12em] text-white">
          <span className="ticker-flash-dot inline-flex h-[5px] w-[5px] rounded-full bg-white" />
          <span>Breaking</span>
        </div>

        <div className="ticker-marquee min-w-0 flex-1 -ml-px">
          <div className="ticker-track">
            {[0, 1].map((loopIndex) => (
              <div key={loopIndex} className="ticker-segment" aria-hidden={loopIndex === 1}>
                {breakingTitles.map((title, index) => (
                  <div key={`${loopIndex}-${title}-${index}`} className="ticker-item">
                    <span className="text-[11px] font-medium text-white/95">
                      {title}
                    </span>
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 shrink-0 rotate-45 bg-white/65"
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
