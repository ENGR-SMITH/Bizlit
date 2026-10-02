# BIZLIT — API Integration Build Blueprint

**Document type:** implementation blueprint (phased plan + feature mapping)
**Status:** Phases 0–5 implemented, including the AI enrichment in §5 Phase 5.5 — see the status block
on each phase in §5.
**Owners:** engineering
**Providers:** Apify · Mallary.ai · SerpApi (all AI-assisted). Review monitoring was originally scoped as
its own vendor (Reviewflowz) — see the note on §3.3 for why it is now built from SerpApi and Apify.
**App:** BIZLIT — React 19 + Vite SPA, Clerk auth, Supabase Postgres/Storage, RLS per tenant

> **Superseded — review provider.** Reviewflowz was replaced by **SerpApi** (Google, TripAdvisor) and
> **Apify** (Yelp, G2, Capterra, Trustpilot); the provider slot is now `reviews` and the reader client is
> `supabase/functions/_shared/reviews.ts`. Reviewflowz references below are either marked *superseded* or
> kept only as historical record of the original plan. The live, authoritative state is the status block
> on each phase in §5 plus `supabase/functions/README.md`.

---

## 1. Purpose and scope

This document is the single source of truth for wiring four third-party platforms into BIZLIT and
for building the product features they unlock. It states, for every provider:

- what the provider actually does,
- exactly which app feature it powers and where that feature lives in the UI,
- the server (Edge Function) surface we must add,
- the database changes required,
- the environment/secrets needed,
- what the feature must do in **demo mode** (no keys) so the UI never breaks,
- acceptance criteria and verification.

The plan is split into **six phases (Phase 0–5)**. Phase 0 is shared plumbing that every later phase
depends on; Phases 1–4 each ship one provider end-to-end; Phase 5 hardens and rolls out.

**Non-negotiable guardrails already in the product (must be preserved):**

1. **Competitor content is a signal, never artwork.** Apify-scraped competitor posts are shown as
   evidence and inspiration only; every "build our own" action produces an original brief. (See
   README §9 and `CompetitionPage` ad cards.)
2. **All provider secrets stay server-side.** The app today ships only `VITE_`-prefixed values to the
   browser (`src/lib/env.ts`). Provider keys must live in **Supabase Edge Function secrets** and never
   in `VITE_*` or client code.
3. **Tenant isolation.** Every new table carries `business_id` and the same four RLS policies as the
   rest of the schema (`supabase/migrations/0001_init.sql` `public.current_business_ids()`).
4. **Demo-mode parity.** Every new page/section renders with sample data when Clerk/Supabase keys are
   absent, exactly like `src/data/sample.ts` does today.

---

## 2. Target architecture

The current app is a browser SPA that talks straight to Supabase with a Clerk session token. Provider
keys cannot live in the browser, and provider calls must not be made from the client. We therefore add a
thin **provider gateway** made of Supabase Edge Functions. The browser calls the gateway (with the
Clerk JWT); the gateway calls the provider with the secret key and writes results to Supabase.

```
┌──────────────────────────┐        Clerk JWT        ┌───────────────────────────────┐
│  Browser SPA (Vite)      │ ──────────────────────► │  Supabase Edge Functions       │
│  src/lib/repo.ts         │ ◄────────────────────── │  (provider gateway, Deno)      │
│  src/lib/workspace.tsx   │        JSON / jobs      │  secrets: provider API keys    │
└───────────┬──────────────┘                         └───────────┬───────────────────┘
            │ supabase-js (RLS)                                   │ HTTPS
            ▼                                                     ▼
┌──────────────────────────┐                         ┌───────────────────────────────┐
│  Postgres + Storage      │◄─── writes results ─────│  SerpApi  · Apify             │
│  (tenant-scoped, RLS)    │                         │  Mallary.ai                   │
└──────────────────────────┘                         └───────────────────────────────┘
            ▲                                                     │
            │  pg_cron / Scheduled Function (cadence)              │ webhooks
            └───────────────────── scan + sync jobs ◄──────────────┘
```

### 2.1 Functions to add (Supabase Edge Functions, `supabase/functions/`)

| Function | Provider | Trigger | Writes |
| --- | --- | --- | --- |
| `serp-scan` | SerpApi | cron + the shared pull-to-refresh | `serp_rankings`, `local_pack_rankings`, `local_profile_health`, and the workspace's **search visibility** back onto `businesses` (`seo_score`, `top10_count`, `ranked_count`, `avg_position`, each with its `previous_*` twin, plus `rankings_checked_at`) — derived from the standings it just stored, by `_shared/seo.ts`, so the My Business health card cannot show an onboarding figure as a scan result |
| `serp-competitors` | SerpApi | cron + "Run benchmark" (Competition → Local) | `competitor_share_of_voice`, `competitor_review_gap`, `competitor_keywords`, `competitor_metrics` (one review-trend point per competitor per month), and the competitor's own `rating` / `previous_rating` / `review_count` / `reviews_this_month` / `last_scan_at` — the Maps lookup already returns those figures, and the Competition panels read them off the competitor row rather than the gap table |
| `keyword-ideas` | SerpApi | on demand (My Business) | `keyword_ideas` |
| `social-scan` | Apify | cron + "Scan now" | `social_posts`, `social_post_metrics` |
| `site-scan` | Apify — `APIFY_SITE_ACTOR_ID`, a **product-catalogue** actor, run with `discoverProducts` so the start URL is read as a storefront. Required in practice, not optional: the contacts crawler returns no product rows and no JSON-LD, so a catalogue read through it starts, bills and reports `succeeded` while writing **0** rows | the shared pull-to-refresh on Competition (+ cron) | `competitor_items` (one row per **change**, tagged `kind` — a product, a service or a price plan), `scan_runs`; advances `site_scan_at` / `site_run_id` / `last_scan_at` on the competitor |
| `traffic-scan` | Apify — `APIFY_TRAFFIC_ACTOR_ID` (SimilarWeb through Apify; verified: `curious_coder/similarweb-scraper`). **Required in practice**: nothing else writes these tables, so without it every traffic tile reads 0 and every traffic chart draws nothing | every pull, for the whole workspace in one run (`{ domains: [...] }` — our domain plus every rival's) | `businesses.monthly_visits` / `visits_change`, `my_metrics` (`traffic`, `channel`), `competitors.monthly_visits` / `visits_change`, `competitor_metrics` (`traffic`, `traffic_source`), `scan_runs` (`traffic`). The series is **restated**, one `kind` at a time |
| `ads-scan` | Apify — `APIFY_ADS_ACTOR_ID` (Meta Ad Library; verified: `apify/facebook-ads-scraper`). Read only for a competitor whose **Facebook page is saved**, because the library resolves a page exactly and a name not at all | every pull, one run covering every addressable competitor | `competitor_ads` (restated per competitor), `competitor_social.ads_running`, `scan_runs` (`ads`) |
| `web-contacts-scan` | Apify (the `contacts` slot, `APIFY_CONTACTS_ACTOR_ID`) | onboarding "Find them automatically" + Competition → Social presence | `competitors.contacts_*` and its own run ledger — **never** `competitor_social`, which it only proposes rows for. See [`docs/SOURCE_MANAGEMENT_BLUEPRINT.md`](SOURCE_MANAGEMENT_BLUEPRINT.md) Phases 3–4 |
| `reviews-sync` | SerpApi + Apify (the `reviews` slot) | "Scan reviews now" | `my_reviews`, `my_review_sources`, `review_connections` |
| `review-reply` | Google Business Profile (not connected yet) | user action | `review_replies`, updates `my_reviews.replied` |
| `publish-ad` | Mallary.ai | "Post ad" button | `social_publish_jobs` |
| `provider-webhook` | Mallary (reviews are pull-only) | inbound webhook | event rows + job status |

### 2.2 Shared gateway utilities (`supabase/functions/_shared/`)

- `supabaseAdmin.ts` — service-role client (bypasses RLS; only used server-side).
- `http.ts` — `fetchJson` with timeout, exponential backoff, and error classification.
- `auth.ts` — verifies the caller's Clerk JWT and resolves `business_id` (rejects mismatches).
- `idempotency.ts` — writes/checks idempotency keys for write operations.
- `usage.ts` — records every provider call in `api_usage_log` for cost tracking.
- `budget.ts` — reads month-to-date usage back, trims a planned run to what fits the tenant's
  monthly allowance and refuses the run once nothing does.
- `webhookVerify.ts` — provider-specific signature verification.

### 2.3 Scheduling

Use **Supabase Cron (`pg_cron` + `pg_net`)** or a **Scheduled Edge Function** to invoke the gateway on
the cadence already stored per source:

- `competitors.cadence` (`daily|weekly|monthly`) drives `social-scan`, `site-scan` and `serp-scan`.
- Review sync runs on the `my_review_sources` cadence (default weekly). The readers are pull-only, so
  there are no review webhooks (Reviewflowz's were removed).
- Each run writes a `scan_runs` row, so the UI's last-scan/next-scan behaviour stays truthful.
  `site-scan` is what writes one for a watched competitor: it holds the Apify run id on
  the source row while the crawl works, then records `succeeded`/`failed` with the number of changes
  it found. Nothing consumes a `queued` row — a scan that has not run is not a scan.
- The trigger today is the pull-to-refresh gesture the three monitoring pages share (capped at one
  sweep per window — `PULL_REFRESH_INTERVAL_MS`, **10 minutes** — which is what rations the spend).
  The cap gates *starting* work, not finishing it: a
  source whose run id is still on the row — a crawl already billed and not yet read back — is
  collected by the next pull even inside the window, and only those sources are touched.
- A cron caller invokes the same function per
  source with `{ businessId, target, sourceId }`; no extra code is needed for it.

---

## 3. Feature → provider → app-surface map

This is the master mapping. Every requested capability from the brief appears here exactly once.

**Panels that have no producer at all.** They are called out here because the pages render an empty
state indistinguishable from a scan that failed, which is the most misleading thing about this app
today. Every row below is a feature that was **never built**, not a read that broke:

| Table / column (empty by design) | Panel it feeds | What a producer would need |
| --- | --- | --- |
| `competitor_reviews` | Competition → Reviews, the individual reviews | a reader aimed at a **competitor's** place id. `_shared/reviews.ts` reads *our* profiles and cannot be repointed at a rival's |
| `competitor_audience` | Competition → Audience | no provider identified — the weakest of the set. Meta publishes an ad's *reach by country* only, which is geography, not the audience segments this panel claims |
| `my_metrics` (`kind: search_surface`), `businesses.conversion_rate` | My Business → "Search surfaces", the conversion-rate line | no provider identified: SimilarWeb reports channels, not search surfaces, and nobody's estimate of another company's conversion rate would be real. The conversion line is therefore **hidden** rather than shown as 0% |
| `weekly_reports` | My Business → SEO & GEO weekly report | a scheduled job that composes one from the scans' own output; nothing generates a week today |

**Rows that *were* on this list and now have a producer** — `competitor_metrics` (traffic) and
`competitors.monthly_visits` are written by `traffic-scan`, and `competitor_ads` by `ads-scan`. Both are
verified against live runs; see `supabase/functions/README.md` and `LIVE_TEST_PLAN.md` §4b for what a
correct run looks like.
| `weekly_reports` | My Business → reports | derived from the tables above, so it can only work once they hold data |
| `inventory_recommendations`, `buy_list_items` | Buy list → restock advice and buy list | derived from `competitor_items`, the rival catalogue reads already on file |

Everything else on those three pages has a producer, and the tables below say which one:

### 3.1 SerpApi — search, local, maps, autocomplete

| # | Requested feature | Provider engine | Where it appears in the app | New page/section |
| --- | --- | --- | --- | --- |
| S1 | Google **Profile Health Score** | `google_maps` (place) + `google_maps_reviews` | My Business → Local SEO; Competition → competitor local card | `LocalVisibilityPanel` |
| S2 | **Review Feed Integration** (Google local) | `google_maps_reviews` (`data_id`) | Social & reviews → Google source; feeds `reviewSources`/`latestReviewScan` | reuses existing |
| S3 | **Google Maps Business Scraper** | `google_maps` (`q`, `ll`, `type`) | Competition → new "Local" tab; My Business profile discovery | `CompetitionPage` local tab |
| S4 | **Map 3-Pack Tracker** (keyword ranking) | `google` local / `google_local` | My Business → Local rankings table; alert when we drop the pack | `LocalVisibilityPanel` |
| S5 | Google **Keyword Rank Position** | `google` (organic) | My Business → SEO tab (existing `topSeoKeywords` gets real data) | replaces sample `topSeoKeywords` |
| S6 | **Rich Snippet Checker** | `google` (`rich_snippet`) | My Business → SEO tab new column + "snippet missing" flag | SEO table column |
| S7 | **Mobile vs Desktop Split** | `google` (`device=desktop\|mobile\|tablet`) | My Business → SEO tab device toggle | SEO device toggle |
| S8 | **Share of Voice Score** | aggregate over `google` + `google_local` | Competition → overview; My Business → "Your SOV" | new stat |
| S9 | **Competitor Review Gap** | `google_maps` local results ratings/counts | Competition → Reviews tab + Reviews page | new gap widget |
| S10 | **Keyword Ideas** / **Suggestion Tool** | `google_autocomplete` | My Business → "Find keywords" → save to tracked terms | new modal → `my_keywords` |

**SerpApi contract:** every call is a single `GET https://serpapi.com/search?engine={engine}&…&api_key={SERPAPI_KEY}`.
Engines used: `google` (organic + local pack + rich snippets, with `device`), `google_local`,
`google_maps` (`q`, `ll=@lat,lng,zoom`, `type=search|place`, `place_id`/`data_id`),
`google_maps_reviews` (`data_id`) and `google_autocomplete` (`q`, `gl`, `hl`, `cp`). Responses carry
`search_metadata`, `organic_results`, `local_results`, `place_results` and `suggestions`. **Their shape
is not stable:** `local_results` is an array on most engines but an object on others — the Google engine
in mobile device mode answers `{ places: [...] }`, and desktop omits the key entirely — so read it
through `localResultsOf()` in `_shared/serpapi.ts` rather than off the response. Assuming an array threw
inside `serp-scan`'s keyword loop, which aborted the whole run before it persisted anything. The free tier
is 250 searches/month; cache hits (`no_cache=false`) are free, which matters because a device × location
matrix multiplies fast. Fallback provider: **Bright Data SERP API** (≈5,000 free requests/mo).

### 3.2 Apify — competitor social monitoring (pull other people's recent posts)

| # | Requested feature | Apify actor | Where it appears |
| --- | --- | --- | --- |
| A1 | Pull a competitor's **recent posts** (Instagram) | `apify/instagram-scraper` (posts/reels) | Competition → Social tab; Social & reviews |
| A2 | Recent posts (TikTok) | TikTok scraper actor | same |
| A3 | Recent posts (Facebook pages / X) | Facebook / X scraper actors | same |
| A4 | **Engagement & cadence** derived from posts | local compute | Competition → "how often they post / what lands" |
| A5 | **Top-performing competitor post → original ad brief** | local | Competition → "Build our own" (existing, now with real data) |

### 3.3 Review monitoring — live reputation, reply, notifications

> **Superseded (provider choice only).** Reviewflowz needed a paid account we could not create, so the
> review reader was rebuilt on providers already wired into the workspace: **SerpApi** for Google
> (`engine=google_maps_reviews`) and TripAdvisor (`engine=tripadvisor_reviews`) reviews, and **an Apify
> actor** for Yelp, G2, Capterra and Trustpilot. The client now lives in
> `supabase/functions/_shared/reviews.ts`; the provider slot is called `reviews`; there is no review key
> of its own and each read is billed to the reader that served it.
>
> **Replies (R2) are not available.** The only compliant way to post a reply is the platform's own
> business API, and Google's `mybusiness.googleapis.com` accepts only review ids it minted itself — a
> review id scraped from Maps is not one of them. Replying therefore requires ingesting the tenant's own
> Google Business Profile directly through OAuth plus Google's API-access allowlisting. Until that exists,
> `review-reply` refuses with an explanation and the composer is for copy-and-paste. **Webhooks (R3) are
> superseded too**: SerpApi and Apify are pull-only, so new reviews arrive on a sync rather than an event.
> R1 and R4 (reading, scoring, sentiment, flagged) are fully delivered.
>
| # | Requested feature | Reader capability | Where it appears |
| --- | --- | --- | --- |
| R1 | Monitor Google, Yelp, G2, Trustpilot, Capterra, TripAdvisor | SerpApi `google_maps_reviews` / `tripadvisor_reviews`, Apify actors for the rest | Social & reviews → My reviews; `reviewSources` |
| R2 | **Reply to reviews** | not available — needs the tenant's own Google Business Profile via OAuth | Social & reviews → "Reply" composer (copy-and-paste until then) |
| R3 | **New-feedback notifications** | not available — the readers are pull-only, so sync on demand | Notifications page (`buildAlerts`) + badge |
| R4 | Live reputation view (score trend, sentiment, flagged) | reader results + local scoring | Social page + Business page review analysis |

> **Superseded — historical provider notes.** The two paragraphs below describe Reviewflowz, the vendor
> originally scoped for this phase. They are kept for context only; the current design is the
> "What was actually chosen" paragraph that follows them.

**Confirmed Reviewflowz contract** (from the reference guide): base `https://reviews.sh`, auth
`Authorization: Bearer {REVIEWFLOWZ_API_KEY}`, `GET /v2/reviews?platform=google&company={handle}`
returning `{ "total": n, "reviews": [{ rating, author, language, text, date }] }`, plus a webhook that
POSTs to your endpoint the moment a new review arrives. Note the key selling point for us: profiles can
be tracked by **public URL/name without the business logging in**, which fits the "watch any handle"
model of this product. Pricing is per tracked profile, not per review.

**Fallbacks if Reviewflowz is not a fit:** `DataForSEO Reviews API` (pay-per-use, high-volume, POST
task + GET result, Google/Trustpilot/TripAdvisor/Play/App Store) and `BrightLocal` (local-agency focus,
Google Maps/Facebook/Yelp). If the business itself is our signed-in user, the free Google Business
Profile API can be used directly and supports programmatic replies.

**What was actually chosen:** the SerpApi + Apify route above, because both are already wired into the
workspace and need no new account. DataForSEO remains the drop-in if broader coverage is wanted later —
it is the closest single-vendor match to what Reviewflowz offered — while BrightLocal is the only one of
the three that also sells reply-posting as a service. The Google Business Profile API is the planned
home for replies; note it is gated on Google's manual API-access approval, so it cannot be switched on
in a single deploy.

### 3.4 Mallary.ai — posting to the user's own social accounts

| # | Requested feature | Mallary capability | Where it appears |
| --- | --- | --- | --- |
| M1 | Connect the user's social accounts | unified OAuth/accounts | Promotions → "Post ad" modal (account picker) |
| M2 | **"Post ads" button on the Promotions page** | publish endpoint | `PromotionPage` Ad frame + Ads history delivered rows |
| M3 | Publish the **finished design** after it is created | media upload + post | `publish-ad` sends the delivered ad file + caption |
| M4 | Schedule / post now | `scheduled_time` + timezone | Publish modal (Now / Schedule) |
| M5 | Delivery status & history | webhooks + status | Ads history timeline gains a "Published" state |

**Why Mallary:** the reference guide ranks it as the white-label / developer-friendly unified posting API
(free tier ≈ 20 actions/mo, paid from ~$10/mo) with payload adaptation across 10 platforms — a good fit
because the app already renders the creative itself and only needs reliable delivery. Alternatives that
can swap in behind the same `publish-ad` function if needed: **Ayrshare** (enterprise-grade webhooks),
**Zernio** (modern, MCP-native for AI agents), **Postiz** (self-hosted, 30+ networks, no vendor bill), and
**Upload-Post / SociaVault** (free tiers for prototypes). The gateway is written against a small
`SocialPublisher` interface so the provider is replaceable (§6.5).

---

## 4. Data model additions

All tables use the existing tenant pattern: `business_id uuid references businesses(id) on delete
cascade`, RLS enabled, four policies via `public.current_business_ids()`, and an `updated_at` trigger
where mutable. New migrations continue the existing numbering.

> **Note:** the SQL snippets in this section are the schema as first written. Migration
> `0015_review_provider_rename.sql` later renamed the `reviewflowz` provider value to `reviews`, so any
> `reviewflowz` label below is the pre-0015 name.

### 4.1 Phase 0 — `0008_integration_foundation.sql`

```sql
-- Which external connections a tenant has set up (Mallary accounts, Reviewflowz
-- profiles, SerpApi place/maps targets, Apify actor config).
create table if not exists public.integration_connections (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  provider      text not null,          -- serpapi | apify | reviewflowz | mallary
  kind          text not null,          -- social_account | review_profile | maps_place | actor
  external_id   text,                   -- provider-side id (account id, profile id, place data_id)
  label         text,
  handle        text,
  status        text not null default 'active',  -- active | needs_reauth | disabled
  meta          jsonb not null default '{}'::jsonb, -- tokens/expiry stored server-side only
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (business_id, provider, kind, external_id)
);

-- One row per provider call, for cost + debugging. service_role writes only.
create table if not exists public.api_usage_log (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid references public.businesses(id) on delete cascade,
  provider      text not null,
  endpoint      text not null,
  units         integer not null default 1,   -- searches / results / posts
  cost_usd      numeric(10,4) not null default 0,
  status        text not null default 'ok',   -- ok | error
  detail        text,
  created_at    timestamptz not null default now()
);
```

Also in `0008`: the **`integration_idempotency`** store (`business_id`, `provider`, `key`, `response`,
unique on `(business_id, provider, key)`, service-role only) that `_shared/idempotency.ts` uses to make
provider writes run-once, and an additive extension of the scan source enum so runs can be labelled:

```sql
alter type scan_source_type add value if not exists 'publishing';   -- Mallary jobs
-- 'seo', 'geo', 'social', 'reviews' already exist and are reused.
```

### 4.2 Phase 1 — `0009_serp_seo_local.sql`

- `serp_rankings(business_id, keyword, device, location, position, url, title, snippet_type, is_rich_result, checked_at)`
- `local_pack_rankings(business_id, keyword, location, in_pack boolean, pack_position, place_id, checked_at)`
- `local_profile_health(business_id, place_id, score, checks jsonb, reviews_count, avg_rating, checked_at)`
- `keyword_ideas(business_id, seed, suggestion, relevance, source, saved_as_keyword boolean, created_at)`

### 4.2b Phase 1b — `0010_serp_competitor_benchmarks.sql`

- `competitor_share_of_voice(business_id, competitor_id, competitor_name, keyword_set, term_count, our_top10, their_top10, our_share numeric, their_share numeric, checked_at)`
  - unique `(business_id, competitor_id)` — one current row per rival.
- `competitor_review_gap(business_id, competitor_id, competitor_name, place_id, our_reviews, their_reviews, review_gap, our_rating, their_rating, rating_gap, checked_at)`
  - unique `(business_id, competitor_id)`.

### 4.3 Phase 2 — `0011_social_monitoring.sql`

- `social_posts(id, business_id, competitor_id, platform, external_id, url, caption, media_url, hashtags text[], mentions text[], likes int, comments int, shares int, views int, posted_at, scraped_at, engagement_rate numeric)`
  - unique `(business_id, platform, external_id)` for idempotent re-scrapes.
- `social_monitor_targets(business_id, competitor_id, platform, handle, actor_id, last_scraped_at, cadence)`

### 4.4 Phase 3 — `0012_review_replies.sql`

```sql
alter table public.my_reviews
  add column if not exists external_id   text,        -- provider review id
  add column if not exists platform      text,        -- google | yelp | g2 | trustpilot | capterra | tripadvisor
  add column if not exists replied       boolean not null default false,
  add column if not exists reply_text    text,
  add column if not exists replied_at    timestamptz,
  add column if not exists language      text;        -- ISO 639-1 from Reviewflowz
create unique index if not exists my_reviews_external_idx on public.my_reviews (business_id, external_id);
```

- `review_connections(business_id, provider, profile_external_id, platform, status, last_synced_at)`

### 4.5 Phase 4 — `0013_social_publishing.sql`

- `social_accounts(business_id, provider_account_id, platform, display_name, handle, avatar_url, status, connected_at)`
- `social_publish_jobs(id, business_id, brief_id, delivered_ad_id, account_ids uuid[], caption, scheduled_for, timezone, status queued|publishing|published|failed, provider_job_id, permalink, error, created_at, updated_at)`
  - `unique (business_id, idempotency_key)` to prevent duplicate posts on retry.

---

## 5. Phased build plan

Each phase lists: objective → deliverables (schema / functions / UI / env) → acceptance criteria →
risks. Phases 1–4 are independent once Phase 0 lands and may run in parallel.

---

### Phase 0 — Provider gateway & foundations

> **Status: implemented.** Ships `supabase/migrations/0008_integration_foundation.sql`,
> `src/lib/integrations.ts`, the repo loaders/`WorkspaceData` plumbing, the Integrations panel in the
> business settings dialog, and `supabase/functions/` (`_shared/*` + `integrations-status`).

**Objective:** give every provider a single, secure, observable path into the app.

**Deliverables**

1. **Schema:** `0008_integration_foundation.sql` (§4.1) — `integration_connections`,
   `api_usage_log`, enum extension.
2. **Functions:** `supabase/functions/_shared/` utilities (§2.2) and a health-check function
   `functions/integrations-status` that reports which providers are configured.
3. **Types & repo:** add to `src/lib/types.ts`:
   `IntegrationConnection`, `ApiUsage`, and a `ProviderStatus` union. Add read-only loaders in
   `src/lib/repo.ts` (`listConnections`, `integrationUsage`) and expose them through
   `WorkspaceData` / `useWorkspace`.
4. **Client helper:** `src/lib/integrations.ts` — thin wrapper that calls Edge Functions with the
   Clerk token (`supabase.functions.invoke`) and normalises errors. **No provider keys here.**
5. **Demo stubs:** every new action returns sample results in demo mode (mirrors
   `DemoWorkspaceProvider`), so previews keep working with no keys.
6. **Env:** add all provider placeholders to `env.example` (§8) with a clear "SERVER ONLY" banner.
7. **Secrets:** document `supabase secrets set ...` and add a `supabase/functions/README.md`.

**Acceptance criteria**

- `npm run typecheck` and `npm test` pass unchanged.
- `integrations-status` returns `{ serpapi: false, apify: false, reviews: false, mallary: false }`
  when secrets are absent, and the UI shows an "Integrations" section with connect prompts.
- Every provider call made through `_shared/http.ts` records a row in `api_usage_log`.
- An unauthenticated or wrong-tenant call is rejected (RLS + JWT check).

**Risks:** Edge Function cold starts (mitigate with lightweight handlers); leaking keys via logs
(never log secrets; redact headers).

---

### Phase 1 — SerpApi: search visibility, local & maps, competitor benchmarking

> **Status: complete.** Ships `supabase/migrations/0009_serp_seo_local.sql` +
> `0010_serp_competitor_benchmarks.sql`, the `serp-scan`, `serp-competitors` and `keyword-ideas`
> gateway functions (all budget-guarded by `_shared/budget.ts`), the repo/type/workspace plumbing,
> the **Local visibility** tab (rankings with rich-snippet flags, device toggle, Business Profile
> health, map 3-pack tracker, your Share of Voice and the keyword finder) and the
> **Competition → Local** tab (Share of Voice comparison, Competitor Review Gap and pack positions),
> plus the local-visibility alerts (pack drop, lost rich snippet, SOV threshold crossing). The SEO
> tab reads its positions live from `serp_rankings`, so `topSeoKeywords` is no longer sample data.
>
> Two items were deliberately carried forward: the **Google Maps review feed (S2)** and the
> **"competitor gained ≥ N reviews" alert**, both to Phase 3 so review history has a single source
> (originally Reviewflowz, now the `reviews` slot) rather than two. One known limitation is left as-is by choice: a map-pack row is only
> rewritten when Google returns a 3-pack for that keyword, so a query Google stops showing a pack for
> keeps its last row rather than being reported as "dropped out" on ambiguous data. Per-tenant budget enforcement landed here, ahead of Phase 5, because
> the SerpApi acceptance criteria below depend on it.

**Objective:** replace all sample SEO/GEO/local data with real Google results, and add the four
requested Search/Maps/Local/Competitor capability sets.

**Deliverables**

1. **Schema:** `0009_serp_seo_local.sql` (§4.2).
2. **Function `serp-scan`** — for each tracked keyword + target location + device:
   - **Organic rank (S5):** `GET https://serpapi.com/search?engine=google&q={kw}&location={loc}&device={desktop|mobile}&num=100&api_key=…`; locate our `primary_domain` in `organic_results`, record `position`.
   - **Rich snippet (S6):** read `organic_results[].rich_snippet` / `rich_snippet_table`; set `is_rich_result` and `snippet_type`.
   - **Device split (S7):** repeat with `device=mobile` and `device=desktop`; store both rows.
   - **Map 3-Pack (S4):** `engine=google` local block or `engine=google_local`; find `local_results` entry matching our place; record `in_pack` + `pack_position`.
   - **Maps business scraper (S3):** `engine=google_maps&type=search&q={brand}&ll=@{lat},{lng},{z}&nearby=true`; capture `place_id`/`data_id`, address, hours, rating, reviews.
   - **Profile health (S1):** score from presence of website, hours, photos, category, description, rating ≥ threshold, review velocity → 0–100 with a `checks` breakdown.
   - **Review feed (S2):** `engine=google_maps_reviews&data_id={id}` → normalise into `my_reviews`/`my_review_sources`. *(Superseded: now served by the `reviews` slot through SerpApi rather than deferred to a review vendor.)*
3. **Function `keyword-ideas`** (S10): `engine=google_autocomplete&q={seed}&gl={country}&hl={lang}`, plus optional prefix expansion (a–z / question words). Returns suggestions with `relevance`; "Save" writes to `my_keywords(kind='seo')`.
4. **Function `serp-competitors`** (S8/S9): run the keyword set for each competitor domain; compute
   **Share of Voice** = our top-10 appearances ÷ total tracked terms (and competitor equivalents), and
   **Competitor Review Gap** = difference in local rating count / average rating from `google_maps` results.
5. **UI:**
   - **My Business** gains a **Local visibility** panel (`src/components/insights` + `BusinessPage`):
     Profile Health Score ring, top-10 Map 3-Pack keywords, device toggle, rich-snippet flags,
     and a **"Find keywords"** button opening the autocomplete modal.
   - **Competition** gains a **Local** tab: their Maps profile, review gap, SOV comparison,
     and "we hold / they hold" pack positions per keyword.
   - Wire the "Scan now" buttons on both pages to `serp-scan` (via `queueScan` + invoke).
6. **Alerts:** rules in `src/lib/alerts.ts` — **dropped out of the map 3-pack**, **lost a rich
   snippet** and **Share of Voice crossed a threshold** are implemented. They compare the current
   scan against the previous one, so `serp_rankings`, `local_pack_rankings` and
   `competitor_share_of_voice` carry `previous_*` columns the gateway fills just before each upsert.
   The "competitor gained ≥ N reviews" rule is deferred to Phase 3 (the `reviews` slot, originally
   Reviewflowz) so review history comes from one source.
7. **Demo:** `src/data/business.ts` gains local/SOV/idea samples so panels render with no keys.

**Acceptance criteria**

- With a SerpApi key, `serp-scan` writes real rows for every keyword × device × location and the
  My Business SEO table shows live positions, not sample ones.
- `keyword-ideas` returns and persists suggestions; saving one adds it to tracked keywords.
- Rich-snippet and device columns populate; toggling device changes the numbers.
- Profile Health Score renders with a per-check breakdown.
- SOV + Competitor Review Gap appear on Competition → Local.
- Cost per run is visible in `api_usage_log`; a run over budget aborts cleanly. **Done:** every
  function plans its spend against the workspace's remaining units for the calendar month (cap from
  `SERPAPI_MONTHLY_CAP`, default 250), trims the run to what fits, and returns HTTP 429 with the
  arithmetic once nothing fits. A trimmed run reports `capped: true`, which the UI surfaces instead of
  a plain success message.

**Risks:** SerpApi credits burn fast at `num=100` × devices × locations (mitigate: cache 1h via
`no_cache=false`, cap keywords per run, per-tenant monthly budget in `api_usage_log`); Maps review
data may need `data_id` discovery first; treat place matching by domain + name carefully.

---

### Phase 2 — Apify: competitor social monitoring (recent posts)

> **Status: implemented.** Ships `supabase/migrations/0011_social_monitoring.sql`, the `social-scan`
> gateway function with its `_shared/apify.ts` client and normaliser, the repo/type/workspace
> plumbing, sample posts, the **Competition → Social** tab (recent posts with engagement and a "New"
> marker, a **Top post this cycle** card that seeds an original brief, measured cadence/engagement and
> recurring hashtags), the **Social & reviews → Competitor social** measured line, and the two social
> alerts (posting burst, new engagement record). It also brings the first **spend** budget
> (`APIFY_MONTHLY_CHARGE_USD`) into `_shared/budget.ts`.
>
> Three decisions worth knowing, all deliberate:
> 1. **One place registers a profile.** The monitoring list is `competitor_social`, edited on
>    **Competition → Social presence** (add a competitor's handle, or take one off), and it holds one
>    row per competitor per platform — which is what the unique index added later in
>    `0016_competitor_social_handles.sql` enforces. `social_monitor_targets` only stores how each one
>    was last scraped, so there is no second place to register a profile. *(Corrected: this originally
>    said the handles were "captured at onboarding". They were not — onboarding captured a
>    competitor's name and website only, and nothing wrote `competitor_social` at all, so a real
>    workspace had no targets and the scan had nothing to do.)*
> 2. **Runs are asynchronous, collection is deferred.** `social-scan` starts each run with
>    `maxItems` + `maxTotalChargeUsd`, waits up to ~90s in total, and stores the run id when a run
>    outlives the wait; the next scan collects it first. Costs are logged exactly once, at collection.
>    The `provider-webhook` in Phase 3/4 replaces this polling with a push.
> 3. **Only the Instagram actor has a known input shape.** Other platforms (TikTok/Facebook/X) run
>    only once their actor id is configured *and* their input fields are confirmed — until then they
>    are reported as skipped rather than sent a guessed payload. Instagram CDN media URLs also
>    expire, so a stale thumbnail is expected and the caption/metrics are the durable part.

**Objective:** pull **other people's recent posts** so competitors' social activity becomes real,
actionable data.

**Deliverables**

1. **Schema:** `0011_social_monitoring.sql` (§4.3).
2. **Function `social-scan`** — for each `social_monitor_targets` row:
   - Start a run: `POST https://api.apify.com/v2/actors/{actorId}/runs?token={APIFY_TOKEN}`
     with an actor-appropriate input (profile URLs, `resultsLimit`, optional `onlyPostsNewerThan`).
     Cap spend with `maxItems` and `maxTotalChargeUsd` query params.
   - Poll the run (`GET /v2/actor-runs/{runId}`) or receive an Apify completion webhook, then
     `GET /v2/datasets/{defaultDatasetId}/items?clean=true`.
   - Actors: `apify/instagram-scraper` (A1), a TikTok posts scraper (A2), Facebook-pages / X
     scrapers (A3). Actor IDs are config, not hard-coded (§8).
3. **Normalisation:** map provider fields → `social_posts`
   (`shortCode`/`id`, `url`, `caption`, `displayUrl`/`videoUrl`, `hashtags`, `mentions`,
   `likesCount`, `commentsCount`, `videoViewCount`/`videoPlayCount`, `timestamp`) and compute
   `engagement_rate` = (likes + comments) ÷ followers.
4. **Derived insights:** posting cadence (posts/week), posting-time heat, best-performing post per
   competitor, hashtag frequency, and "what to beat" hints.
5. **UI:**
   - **Competition → Social** (existing) now lists real recent posts with thumbnails, engagement
     badges and a "new" marker; a "Top post this cycle" card.
   - **Competition → Ads** "Build our own" now seeds an **original brief** from a real post's
     *angle* (never its artwork) — links through to `PromotionPage` prefilled.
   - **Social & reviews → Competitor social** shows cadence + engagement side-by-side with yours.
6. **Alerts:** competitor posted ≥ N times in 24h, or a post beat their 30-day engagement record.
7. **Cost controls:** per-actor `maxItems`, `maxTotalChargeUsd`, cadence from `competitors.cadence`,
   and skip unchanged private-profile errors gracefully.
8. **Demo:** add sample `social_posts` for the sample competitors so the tab renders.

**Acceptance criteria**

- With an Apify token, a competitor's recent Instagram (and TikTok where configured) posts land in
  `social_posts` with correct engagement, and re-running does not duplicate rows (unique key).
- Competition → Social shows live posts, cadence and top post; the numbers update on re-scan.
- A run that would exceed its spend cap stops and logs the cap to `api_usage_log`.
- Demo mode still renders the tab from sample data.

**Risks:** actors are third-party mains and can change schema (pin actor IDs + a schema-assert step);
scraping public data is subject to each platform's ToS (document the guardrail and keep usage to
public competitor content); cost scales with competitors × platforms × cadence.

---

### Phase 3 — Reviews (originally Reviewflowz): live reputation, replies, feedback notifications

> **Superseded (provider choice only).** Reviewflowz was not usable (no paid account we could create), so
> this phase is delivered on **SerpApi** (Google, TripAdvisor) and **Apify** (the rest). The status block
> below is kept as written at the time and its Reviewflowz specifics are historical; §3.3 holds the
> current design.

> **Status: implemented (on SerpApi + Apify, not Reviewflowz).** Ships
> `supabase/migrations/0012_review_replies.sql` (provider value renamed to `reviews` by 0015), the
> `reviews-sync`, `review-reply` and `provider-webhook` gateway functions on a shared
> `_shared/reviews.ts` client, the repo/type/workspace plumbing, the **reply composer** and
> **review-profile connections** on Social & reviews, and the review alerts (a source's score slipping,
> a negative review awaiting a reply past 48h, and a **widening competitor review gap**).
>
> Four decisions worth knowing, all deliberate:
> 1. **The Phase 1 carry-forwards land here.** The "competitor gained ≥ N reviews" alert is the
>    *review gap widened* rule below, and the Google Maps review feed (S2) is served by the `reviews`
>    slot (SerpApi `google_maps_reviews`) rather than a second ingestion path — review history has one
>    source, which is the point of the carry-forward.
> 2. **Connections are public handles, and mirrored once.** A profile is tracked by its public URL or
>    handle (no platform login), stored in `review_connections`, and mirrored into
>    `integration_connections` (kind `review_profile`) so the Integrations panel counts it without a
>    second source of truth for *which* profiles are connected.
> 3. **Replies are user-sent only, and capability is surfaced.** The tenant is referenced by our own
>    connection row (never by a payload), and a platform that only exposes read access returns a 409 the
>    UI explains. *(Superseded: the `REVIEWFLOWZ_REPLY_PATH` setting is gone — no reader exposes a reply
>    API, so sending is gated on connecting the tenant's own Google Business Profile; see §3.3.)
> 4. **A slow actor is deferred, not discarded.** `reviews-sync` keeps an uncollected run on
>    `review_connections.last_run_id` / `last_run_status` (`0017_review_run_state.sql`, mirroring
>    `social_monitor_targets`). The next sync re-reads that run and, if it has finished, collects it
>    instead of starting — and paying for — a second one, which is why the budget is only checked when
>    a run actually has to be started. A run that outlives both syncs comes back as *still running*,
>    not as an error. Provider-side failures (a run that ends FAILED, or one that returns no id) are
>    treated as transient and leave the profile `active`: the only other outcome is `needs_reauth`,
>    which drops the profile out of every later sync — they read `status = 'active'` — and tells the
>    user to reconnect a healthy row.*

**Objective:** make review management real — monitor six platforms, reply from inside the app (gated on
connecting the tenant's own Google Business Profile — see §3.3), and get notified of new feedback.

**Deliverables**

1. **Schema:** `0012_review_replies.sql` (§4.4).
2. **Profile setup:** in **Social & reviews** (or Business settings), let the user add their review
   profiles (Google, Yelp, G2, Trustpilot, Capterra, TripAdvisor). Each becomes a
   `review_connections` row (and the provider-side `review_profile`).
3. **Function `reviews-sync`:** *(historical — the Reviewflowz endpoint below is superseded by the
   SerpApi/Apify readers described in §3.3.)*
   - `GET {REVIEWFLOWZ_BASE_URL}/v2/reviews?platform={p}&company={handle}` (confirm exact base URL,
     auth header and pagination in the provider's OpenAPI/Swagger docs).
   - Upsert into `my_reviews` keyed on `(business_id, external_id)`, and refresh
     `my_review_sources` (score, previous score, counts, new-this-month) plus the series.
   - Compute the existing `latestReviewScan` (new reviews, flagged, average rating) from live rows.
4. **Function `review-reply`:** send the reply for a review; on success set `replied`/`reply_text`/
   `replied_at`, and append to a `review_replies` history. Use an idempotency key so a retry cannot
   double-post a reply.
5. **Function `provider-webhook`** (Reviewflowz events `review.created`, `review.updated`,
   `review.deleted`, `reply.created`): verify signature → upsert/soft-delete the review → mark the
   alert. This is what makes "get notified of new feedback" real-time.
   *(Superseded: the readers are pull-only, so review webhooks were removed. `provider-webhook` is now
   Mallary-only and merely acknowledges a stale `review.created` payload so an old Reviewflowz config
   stops retrying.)*
6. **UI:**
   - **Social & reviews → My reviews:** per-review **Reply** composer (prefilled with the existing
     suggested `action` text), reply state badge, and language tag (ISO 639-1).
   - **Review source panel:** score trend + "connect another platform" affordance.
   - **Notifications:** new alerts for new reviews, negative reviews, and review-edit/deletion.
7. **Alerts (`src/lib/alerts.ts`):** negative review flagged, rating dropped, a review awaiting a
   reply for > 48h, competitor review-gap widened (ties into Phase 1 S9).
8. **Demo:** sample reviews already exist; add a fake "reply sent" state so the composer renders.

**Acceptance criteria**

- Adding a review profile triggers a sync that populates the six-platform list and refresh the
  scan summary with live numbers.
- A reply sent from the UI is reflected on the provider and stored against the review; a duplicate
  submit is blocked by the idempotency key.
- ~~An inbound `review.created` webhook creates a notification and bumps the bell badge without a manual
  scan.~~ **Superseded:** the readers are pull-only, so new reviews arrive on a sync, not an event.
- Deleted/edited reviews are reconciled (`review.deleted` / `review.updated`), not duplicated.

**Risks:** reply support varies by platform (some are read-only) — surface per-platform capability;
webhook signature scheme must be confirmed from docs; **never auto-reply without explicit user send**
(guardrail against fake/AI-generated public replies going out unreviewed).

---

### Phase 4 — Mallary.ai: the "Post ads" button and publishing

> **Status: implemented.** Ships `supabase/migrations/0013_social_publishing.sql`, the `publish-ad`
> and `social-accounts` gateway functions on a shared `_shared/mallary.ts` client, Mallary routing in
> `provider-webhook`, the repo/type/workspace plumbing, and the **`Post ad` button** with its
> **Post-ad modal** on the Promotions page — connected-account picker, editable caption seeded from
> the brief, media preview, Post now / Schedule with an explicit timezone, and `published` entries in
> the Ads history timeline.
>
> Four decisions worth knowing, all deliberate:
> 1. **Accounts are connected in Mallary, not here.** The provider's public API lists connected
>    platforms but does not expose an OAuth start endpoint, so the app mirrors them through
>    `social-accounts` rather than pretending to own a connect flow.
> 2. **Media is re-hosted through Mallary.** The provider rejects external media URLs, so the
>    delivered design (or the in-browser PNG export) is fetched server-side and pushed through
>    Mallary's presigned upload before the post is created.
> 3. **One post, however many retries.** The idempotency key is derived from (design, accounts,
>    schedule), stored in `integration_idempotency` *and* sent as Mallary's `Idempotency-Key`, and
>    `social_publish_jobs` is unique on it.
> 4. **Immediate posts are polled briefly, then left to the webhook.** A post-now is checked for a few
>    seconds to capture its permalink; a scheduled post (which has not been sent yet) and any slower
>    job are settled by the `post.*` webhook.

**Objective:** after a promotion design is created and delivered, let the user publish it straight to
their own social accounts from the Promotions page.

**Deliverables**

1. **Schema:** `0013_social_publishing.sql` (§4.5).
2. **Account connection:** a **"Connect social accounts"** flow in the Post-ad modal (or Business
   settings) backed by Mallary's unified account/OAuth handling; connected accounts land in
   `social_accounts`.
3. **Function `publish-ad`:**
   - Input: `delivered_ad_id` (the finished design) or `brief_id`, `account_ids`, `caption`,
     `scheduled_for` + `timezone`.
   - Media: send the delivered creative (public `delivered-ads` URL, or the browser-exported PNG as a
     data/upload) to Mallary's media upload.
   - Create the post with an **idempotency key** derived from `(business_id, delivered_ad_id,
     account_ids, scheduled_for)`; store `provider_job_id` and status.
   - Poll or accept the webhook to move `queued → publishing → published|failed` and capture the
     `permalink`.
4. **UI — the requested Post ads button (`src/pages/PromotionPage.tsx`):**
   - **In the "Ad frame" CardHead:** add a **`Post ad`** primary button beside the existing
     Export/Download control, shown **only when the design is ready** (`designReady`).
   - **In "Ads history" delivered rows:** add a **`Post ad`** action alongside Export.
   - Opens a **Post-ad modal** (`components/Modal`, matching the page's existing style) with:
     connected-account checkboxes, an editable caption pre-filled from the brief
     (headline + deal + coupon + contact), media preview of the delivered design,
     a **Post now / Schedule** segmented control with a date-time + timezone, and a submit button.
   - If no accounts are connected, the modal shows a **"Connect your accounts"** prompt instead of
     the composer.
   - After posting, the **Ads history** timeline gains a third entry kind: `published`, with a
     "Published" badge, platform icons, the permalink ("View post"), and status. This extends the
     existing `HistoryEntry` union (`brief | ad` → `brief | ad | published`).
5. **Alerts:** post failed (with the provider error), post published.
6. **Demo:** the demo provider returns a fake published post and appends a `published` history entry,
   so the button is fully explorable without keys.

**Acceptance criteria**

- With Mallary configured and an account connected, **Post ad** publishes the delivered design and the
  caption to the chosen platform(s); status reaches `published` and a permalink is stored.
- Scheduling works with an explicit timezone (stored as both local + UTC).
- Retrying a failed submit does not create a duplicate post (idempotency key).
- With no accounts connected, the modal prompts connection and cannot publish.
- The Ads history shows the published entry and the design remains exportable.
- Demo mode exercises the whole flow against the stub.

**Risks:** per-platform media/format rules (square vs story vs landscape must be validated before
queue); token expiry/`needs_reauth` handling; must not publish competitor creative — only the user's
own delivered design, which is enforced by the data model (`delivered_ad_id` belongs to the tenant).

---

### Phase 5 — Hardening, observability, cost controls, rollout

**Objective:** make the integrated system safe, affordable and operable.

> **Status: implemented.** Ships `supabase/migrations/0014_webhook_events.sql`, the generalised
> `_shared/budget.ts` caps enforced in *every* gateway function, per-provider caps reported by
> `integrations-status`, the **Plan usage** and **Monitoring health** panels in business settings, the
> 80%/100% budget alerts, and webhook replay protection in `provider-webhook`.
>
> Four decisions worth knowing, all deliberate:
> 1. **One source of truth for spend.** Caps are read back from `api_usage_log` — the same rows the
>    usage panel renders — so the number a user sees is the number the gateway enforces against. The
>    read fails closed (a retryable 503) rather than granting unverified spend.
> 2. **Two shapes of allowance, because providers bill differently.** Unit caps (SerpApi searches,
>    Mallary posts) and dollar caps (Apify results) are read separately and
>    the panel reports the fuller of the two. An explicit `…_MONTHLY_CAP=0` means *uncapped*, for
>    workspaces on a paid plan.
> 3. **Alerts are derived, never stored.** `buildAlerts` recomputes budget and health state from rows
>    the app already holds, so there is no second store to drift and no provider call to render the
>    settings dialog.
> 4. **Replay protection keys on the event, not the delivery.** `webhook_events` is unique on
>    `(provider, event_id)`, where the id is the provider's own when it sends one and an FNV-1a
>    fingerprint of the raw body otherwise — so a retried delivery is ignored while a genuinely
>    second event still lands.
>
> 5. **All three AI tasks ship behind one function, and none of them writes.** `ai-draft` serves
>    reply drafts, ad angles and keyword clusters through `_shared/llm.ts`, an OpenAI-compatible JSON
>    client (Groq by default; `LLM_BASE_URL` / `LLM_MODEL` swap the provider). The guardrail is
>    structural rather than a promise: each task loads its material from our own tenant-scoped rows,
>    so a request cannot make the gateway draft from arbitrary text, and each returns a draft that a
>    *separate* action has to turn into a send, a brief or a saved keyword. Model output is parsed and
>    validated before it reaches the client — one corrective retry, then a 502 — and a keyword cluster
>    may only contain suggestions we already hold, so an invented keyword is dropped rather than shown.
>    *(Cost decision, taken explicitly: drafting is **uncapped** — user-triggered and a fraction of a
>    cent per call — so it is logged and shown but never refused. `LLM_MONTHLY_CHARGE_USD` switches a
>    ceiling on without a code change. This also widened `api_usage_log.cost_usd` to six decimals;
>    at four, every drafting call would have recorded as $0.0000 and the usage panel would have shown
>    $0.00 forever.)*

**Deliverables**

1. **Budgets & caps:** per-tenant monthly caps per provider enforced in the gateway (aborts + alert at
   80%/100%); a simple **Usage** panel in Business settings reading `api_usage_log`. **Landed:**
   `_shared/budget.ts` holds every provider's allowance (unit caps for SerpApi/Mallary, a dollar cap
   for Apify; `reviews` is deliberately uncapped because each read is billed to its reader), each
   function trims to what fits and refuses with a 429 + the arithmetic;
   `integrations-status` reports the caps and the **Plan usage** panel renders them.
2. **Operations view:** surface `scan_runs` (queued/running/failed), provider webhook health, and
   `needs_reauth` connections on the Notifications page or a small Settings tab. **Landed:** the
   **Monitoring health** panel in business settings (`buildWorkspaceHealth`), plus the failed-scan and
   reconnect alerts.
3. **Resilience:** retry classification (validation = fail fast; rate-limit = backoff; auth = refresh
   once), dead-letter handling, and `provider-webhook` replay protection. **Landed:** replay
   protection via `webhook_events`; each function answers a retryable HTTP status on provider rate
   limits (the caller retries), and a `needs_reauth` row is written rather than the page crashing.
4. **Security review:** confirm RLS on every new table, secrets only in Edge Function env, no provider
   payloads echoed to the browser, webhook signature verification on all inbound routes.
5. **Search & AI enrichment (the "AI" in the brief):** use an LLM to (a) turn scraped competitor posts
   into original brief *angles*, (b) draft review replies for the user to edit, (c) suggest keyword
   clusters from autocomplete output. All AI output is a **draft the user confirms** — never auto-posted.
   **Landed:** `ai-draft` on `_shared/llm.ts`, `0018_keyword_clusters.sql` (a `cluster` label per idea),
   the `draftReviewReply` / `draftAdAngles` / `clusterKeywordIdeas` actions, and the three surfaces:
   **Draft with AI** in the reply composer, the angle picker on **Competition → Social** (which also
   made "Build our own" create a real brief instead of announcing one), and **Group into themes** in
   the keyword finder. Demo mode answers with sample drafts, so all three render with no key.
6. **Tests:** extend `tests/app.test.tsx` and `tests/onboarding.test.tsx`; add unit tests for the
   normalisers and for `buildAlerts`; add a demo-mode test per new page section. **Landed:**
   `tests/rankings`, `tests/social`, `tests/reviews`, `tests/publishing`, and `tests/operations`
   (caps, usage bars, health, budget alerts, webhook event ids and signatures).
7. **Docs:** update `README.md` (env, pages, "Not built yet") and this blueprint's status. **Landed:**
   README §8 now describes the gateway, and the "Not built yet" list is accurate again.

**Acceptance criteria**

- Typecheck + full test suite green; no provider key reachable from the client bundle
  (grep the built `dist/` for key prefixes).
- Caps abort a runaway scan with a clear message and an alert.
- A failed/expired connection shows a "Reconnect" affordance and never crashes a page.
- README accurately describes the new pages and integrations.

---

## 6. Cross-cutting concerns

### 6.1 Idempotency & retries
Every provider write carries a client-supplied idempotency key bound to a normalised request
fingerprint and tenant scope; duplicates return the existing record instead of re-enqueuing. Retries
are classified: validation → fail; rate-limit → backoff + requeue; auth → refresh once then retry.

### 6.2 Cost control
- SerpApi: cache (`no_cache=false`), cap keywords/devices/locations per run, monthly cap per tenant.
- Apify: `maxItems` + `maxTotalChargeUsd` per run; cadence from `competitors.cadence`; skip unchanged.
- Reviews: no vendor of its own — each read is billed to SerpApi (per search) or Apify (per result),
  so it is bounded by those caps; the readers are pull-only, so sync on cadence.
- Mallary: post on user action (button), never in a loop.
All calls logged to `api_usage_log` with units and `cost_usd`.

### 6.3 Security & privacy
- Provider secrets in Supabase Edge Function secrets only.
- Browser ↔ gateway with the Clerk JWT; gateway re-checks tenant ownership of every id it touches.
- RLS on all new tables via `current_business_ids()`.
- Webhooks verify a signature/secret before writing.
- Competitor scraped content is stored as **signal** (text/metrics), never re-published as artwork.
- AI-generated replies/copy are drafts requiring an explicit user send.

### 6.4 Demo mode
Every phase adds sample data + stub actions so all new UI renders with no keys, preserving the
current "preview everything without an account" promise.

### 6.5 Provider abstraction (swap-friendly)
Each provider sits behind a narrow interface so it can be replaced without touching the UI:

- `SearchProvider` → `SerpApiProvider` (fallback: Bright Data SERP API).
- `SocialScraper` → `ApifyProvider` (actors configurable per platform).
- `ReviewProvider` → `ReviewsReader` (SerpApi for Google/TripAdvisor + Apify for the rest; fallbacks:
  DataForSEO, BrightLocal, or Google Business Profile when the tracked business is our own user).
- `SocialPublisher` → `MallaryProvider` (fallbacks: Ayrshare, Zernio, Postiz, Upload-Post).

Actor IDs, base URLs and auth headers live in configuration, never in page code.

---

## 7. New UI surfaces summary

| Page | Existing | Added by this blueprint |
| --- | --- | --- |
| My Business | SEO/GEO rings, traffic, buy list | **Local visibility panel** (Profile Health, Map 3-Pack, rich snippets, device toggle), **Find keywords** modal, SOV stat, live rank data |
| Competition | Overview/inventory/keywords/ads/reviews/social | **Local** tab, real **social posts** with engagement/cadence, competitor review gap, SOV |
| Social & reviews | My reviews, competitor reviews, social scores | **Reply composer**, platform connections, live review sync (pull-based) |
| Notifications | Scan alerts | Review/publish/SOV alerts, connection health, usage warnings |
| Promotions | Brief builder, Ad frame, Ads history | **`Post ad` button**, **Post-ad modal**, `published` history entries, account connection |

---

## 8. Environment & secrets reference

Add to `env.example` as **server-only** placeholders (set them with
`supabase secrets set KEY=VALUE`, or in the Supabase dashboard → Edge Functions → Secrets):

```bash
# SerpApi — search, local, maps, autocomplete (free tier: 250 searches/mo)
SERPAPI_KEY=
# Billable searches per workspace per calendar month. Defaults to 250 when unset;
# enforced by _shared/budget.ts against api_usage_log.
SERPAPI_MONTHLY_CAP=250

# Apify — competitor social scraping (actor IDs are config, pin them)
APIFY_TOKEN=
APIFY_INSTAGRAM_ACTOR_ID=apify/instagram-scraper
APIFY_TIKTOK_ACTOR_ID=
APIFY_FACEBOOK_ACTOR_ID=
APIFY_X_ACTOR_ID=

# Reviews — read through SerpApi (Google, TripAdvisor) and Apify (the rest)
APIFY_TRUSTPILOT_REVIEWS_ACTOR_ID=
APIFY_YELP_REVIEWS_ACTOR_ID=
APIFY_G2_REVIEWS_ACTOR_ID=
APIFY_CAPTERRA_REVIEWS_ACTOR_ID=
# Only needed once Google Business Profile reply-sending is wired up
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Mallary.ai — social publishing
MALLARY_API_KEY=
MALLARY_BASE_URL=
MALLARY_WEBHOOK_SECRET=

# Shared
INTEGRATIONS_WEBHOOK_SECRET=
```

> Confirm the exact base URLs, auth header names and webhook signature schemes from each provider's
> live docs before implementation: SerpApi (`serpapi.com/search-api`), Apify (`docs.apify.com/api/v2`),
> Mallary (mallary.ai developer docs). Reviewflowz is no longer used (superseded — see §3.3).

---

## 9. Phase dependency graph

```
Phase 0 (gateway + schema + secrets)
   ├── Phase 1  SerpApi   ──┐
   ├── Phase 2  Apify      │   independent after Phase 0,
   ├── Phase 3  Reviews    │   may run in parallel
   └── Phase 4  Mallary   ──┘
                 │
                 └── Phase 5 (hardening, budgets, AI drafts, rollout)
```

**Suggested order of value:** Phase 0 → 1 (search/local, highest leverage and lowest risk) → 3
(reviews, user-facing reputation) → 4 (the requested Post-ad button) → 2 (social scraping, highest
cost/ToS care) → 5.

---

## 9b. Appendix — mapping to the source guide

This blueprint is derived from the in-repo reference `Unified_Social_Media_APIs_Guide-1.docx`, which
groups the market into three families. The provider picks above map to it as follows:

| Guide family | Guide options | Our pick | Where it powers the app |
| --- | --- | --- | --- |
| **Unified Social API** (posting) | Zernio, Ayrshare, **Mallary.ai**, PhantomBuster, Postiz, SociaVault, Upload-Post | **Mallary.ai** | Phase 4 — "Post ad" button, publishing delivered designs |
| **Public scraping / monitoring** | PhantomBuster, Apify | **Apify** | Phase 2 — competitors' recent social posts |
| **Review API** | ~~**Reviewflowz**~~, DataForSEO, BrightLocal | **SerpApi + Apify** (the `reviews` slot; Reviewflowz superseded — §3.3) | Phase 3 — monitor six review platforms; reading delivered, replies gated on Google Business Profile OAuth |
| **SEO / SERP Metrics API** | **SerpApi**, Bright Data SERP API | **SerpApi** | Phase 1 — rankings, local/maps, rich snippets, autocomplete |

Provider choices are deliberate but reversible: §6.5 keeps each behind an interface, so switching a
provider (or adding a second one for a region/cost reason) is a gateway change, not an app rewrite.

---

## 10. Definition of done (per provider capability)

A capability is "properly implemented to our app" only when all of the following are true:

1. It has a server path via an Edge Function; no provider key is in the client bundle.
2. Its data is stored in a tenant-scoped, RLS-protected table (or an existing one, extended safely).
3. It renders in the app, with an empty/`pending` state before the first scan (no invented numbers).
4. It works in **demo mode** with sample data and stubbed actions.
5. It raises an alert where it represents a meaningful change.
6. It records usage/cost in `api_usage_log` and respects the per-tenant cap.
7. It has typecheck-clean code and at least one automated test or a documented manual verification.
8. It respects the guardrails: competitor content is a signal, AI output is a draft, nothing posts
   without an explicit user action.
