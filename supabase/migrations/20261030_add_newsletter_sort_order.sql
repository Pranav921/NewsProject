-- Existing subscribers retain their current article order.
alter table public.newsletter_subscriptions
  add column if not exists sort_order text not null default 'default'
  check (sort_order in ('default', 'category'));

-- Keep saved-story topics when the article no longer appears in the live feeds.
alter table public.saved_articles
  add column if not exists category text
  check (category is null or category in ('general', 'technology', 'business', 'politics', 'science', 'health', 'environment', 'sports', 'entertainment', 'education'));
