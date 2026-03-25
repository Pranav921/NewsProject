import { NewArticlesPrompt } from "@/components/NewArticlesPrompt";
import { NewsFeed } from "@/components/NewsFeed";
import { RefreshButton } from "@/components/RefreshButton";
import { getAllNewsItems } from "@/lib/rss";

export const revalidate = 3600;

export default async function Home() {
  const articles = await getAllNewsItems();
  const articleLinks = articles.map((article) => article.link);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-10 sm:px-6 lg:px-8">
      <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">
              Breaking News Dashboard
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
              Latest headlines from trusted RSS feeds
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              This homepage fetches official RSS feeds, turns the XML into typed
              article data, removes duplicate links, and sorts everything by
              newest first.
            </p>
          </div>

          <RefreshButton currentLinks={articleLinks} />
        </div>
      </section>

      <NewArticlesPrompt
        key={articleLinks.join("|")}
        initialLinks={articleLinks}
      />

      <section className="mt-8">
        <NewsFeed articles={articles} />
      </section>
    </main>
  );
}
