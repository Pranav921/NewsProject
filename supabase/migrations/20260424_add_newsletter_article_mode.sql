alter table public.newsletter_subscriptions
add column if not exists article_mode text not null default 'personalized';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'newsletter_subscriptions_article_mode_check'
  ) then
    alter table public.newsletter_subscriptions
    add constraint newsletter_subscriptions_article_mode_check
    check (article_mode in ('personalized', 'all_missed'));
  end if;
end
$$;
