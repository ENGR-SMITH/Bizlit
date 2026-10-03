-- -----------------------------------------------------------------------------
-- 0028 — Google Business Profile connection, for sending review replies
-- -----------------------------------------------------------------------------
--
-- Reading reviews and replying to them are separate permissions. The readers
-- (SerpApi, Apify) hand back a *scraped* review id, which Google refuses: it
-- only honours ids it minted itself, against a location it told us about. So a
-- reply can only go out over a profile the workspace connected directly, and
-- the id has to come from Google's own list of reviews for that location.
--
--   * `google_profile_connections` — one row per workspace holding the OAuth
--     refresh token plus every account and location that token can see, so a
--     reply can walk the locations until it finds the review. Access tokens are
--     minted from the refresh token per call and never stored: nothing that
--     expires sits in the database, and nothing at all sits in the browser.
--
--   * `my_reviews.google_review_name` — the Google resource name
--     (`accounts/…/locations/…/reviews/…`) once a row has been matched, so the
--     next reply to the same review skips the search and cannot mismatch.
--
-- The refresh token is server-side material. The browser reads this table for
-- status only — `loadWorkspace` selects the columns by name and leaves
-- `refresh_token` out — but the table is still tenant-scoped like every other,
-- so a leaked query never crosses workspaces.
-- -----------------------------------------------------------------------------

create table if not exists public.google_profile_connections (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  -- `accounts/1234567890`, the account the token was issued for.
  account_name   text not null default '',
  -- Every location on that account: `["accounts/1/locations/2", …]`. A reply
  -- tries them in order, which is what makes a multi-location business work
  -- without a picker.
  location_names jsonb not null default '[]'::jsonb,
  display_name   text not null default '',
  refresh_token  text not null,
  status         text not null default 'connected',
  last_error     text not null default '',
  connected_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One connection per workspace: connecting again replaces the grant rather
-- than stacking a second one.
create unique index if not exists google_profile_connections_business_idx
  on public.google_profile_connections (business_id);

comment on table public.google_profile_connections is
  'Google Business Profile OAuth grant per workspace — the only compliant path for posting review replies.';

-- The Google resource name of the review a row was matched to, cached on first
-- successful reply so the search is never repeated (and never mismatches).
alter table public.my_reviews
  add column if not exists google_review_name text;

comment on column public.my_reviews.google_review_name is
  'Google''s own review resource name once matched against the connected location (accounts/…/reviews/…). Null until resolved.';

drop trigger if exists google_profile_connections_set_updated_at on public.google_profile_connections;
create trigger google_profile_connections_set_updated_at
  before update on public.google_profile_connections
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row level security — same four tenant policies as every other table.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['google_profile_connections'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    execute format(
      'create policy %I on public.%I for select using (business_id in (select public.current_business_ids()))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert with check (business_id in (select public.current_business_ids()))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update using (business_id in (select public.current_business_ids())) with check (business_id in (select public.current_business_ids()))',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete using (business_id in (select public.current_business_ids()))',
      t || '_delete', t);
  end loop;
end $$;
