# BIZLIT — Supplier & Competitor Monitoring Web App

A four-page workspace for a **Retail Market Watch & Ad Response** service: watch supplier sites,
competitor sites, your own numbers and your client list in one place, on a daily, weekly or monthly
cadence.

Built from `Retail_Market_Watch_Recommendation-1.docx` (the option ranked "highest overall").

- **Login:** Clerk
- **Database:** Supabase (Postgres + row level security)
- **Onboarding:** every new account answers a short business profile before the dashboard opens
- **Stack:** React 19 · TypeScript · Vite · Tailwind CSS v4

---

## 1. Run it

```bash
npm install
cp .env.example .env.local     # then fill in the values (see §3)
npm run dev                    # http://localhost:5173
```

Other commands:

```bash
npm run build      # typecheck + production build into dist/
npm run test       # vitest: page, data, onboarding and gateway-normaliser tests
npm run typecheck
```

**Demo mode.** With no Clerk/Supabase keys the app opens straight into the dashboard using sample
data, so you can preview and demo everything. Add the keys and it becomes a real multi-tenant app:
sign in, onboard, and every page reads and writes your own rows.

---

## 2. What you need to create

| # | Service | Where | What to copy |
| --- | --- | --- | --- |
| 1 | **Clerk** app | https://dashboard.clerk.com → Create application | Publishable key, Secret key, Frontend API / Issuer URL |
| 2 | **Supabase** project | https://supabase.com/dashboard → New project | Project URL, anon key, service_role key, project ref |

Both have generous free tiers. Fill the results into `.env.local` (template in `.env.example`).

---

## 3. Environment variables

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...      # browser — Clerk login
CLERK_SECRET_KEY=sk_test_...               # server only
CLERK_JWT_ISSUER=https://xxx.clerk.accounts.dev

VITE_SUPABASE_URL=https://xxxx.supabase.co  # browser — database
VITE_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...            # server only, bypasses RLS
SUPABASE_PROJECT_REF=xxxx

VITE_APP_URL=http://localhost:5173
```

Only `VITE_`-prefixed values reach the browser. The service role key and Clerk secret must stay
server-side (scheduled scan jobs / edge functions). The four monitoring providers add their own
server-only keys — see §8 and the banner in `env.example`.

---

## 4. Connect the two services (5 steps)

1. **Create the database.** In Supabase → SQL Editor, paste and run
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql). It is safe to run more
   than once. It creates every table, index, trigger, the row level security policies and the private
   `ad-assets` storage bucket.

2. **Tell Supabase to trust Clerk.** Supabase → **Authentication → Sign In / Providers → Third-party
   auth → Clerk** → paste your Clerk **Frontend API / Issuer URL** (the `CLERK_JWT_ISSUER` value).
   This is what lets Supabase verify Clerk session tokens.

3. **Add the role claim in Clerk.** Clerk → **Sessions → Customize session token** → add
   ```json
   { "role": "authenticated" }
   ```
   Supabase uses that claim to pick the Postgres role, which is what the RLS policies expect.

4. **Clerk redirects.** In Clerk → Domains, keep the local dev domain (`localhost:5173`) enabled so
   sign-up/sign-in work locally.

5. **Restart the dev server** so Vite picks up `.env.local`.

### How identity works

- Clerk owns identity. The app sends a fresh Clerk session token on every Supabase request
  (`src/lib/supabase.ts`).
- `auth.jwt() ->> 'sub'` is the Clerk user id.
- `public.current_business_ids()` resolves the businesses that user owns, and every tenant table has
  a policy that only allows rows where `business_id` is in that set.
- Verified locally: a signed-in tenant sees only their own rows, and attempting to insert a row for
  another tenant fails with *"new row violates row-level security policy"*.

---

## 5. Onboarding

A new account cannot reach the dashboard until the profile exists, so the screens always have the
right data to work with. Six steps:

1. **Business** — brand, legal name, industry, niche, country, currency, timezone, team size
2. **Online presence** — domains, where you sell, alert email, social handles, ad platforms
3. **Suppliers** — every supplier site to watch, with a per-source cadence (daily/weekly/monthly)
4. **Competitors** — the businesses to track
5. **Clients & messaging** — send-from email, signature, default frequency, message types, and the
   current active customer list
6. **Goals** — primary goal, weekly report day, what winning looks like

Finishing writes the business profile plus all monitored sources to Supabase, and queues a baseline
scan. Until that scan lands, the pages say a baseline is pending rather than showing invented numbers.

---

## 6. The workspace pages

Navigation is a hash route you can bookmark: `#/suppliers`, `#/competition`, `#/clients`,
`#/business`, `#/social`, `#/inventory`, `#/promotion` and `#/notifications`.

**Suppliers** — latest inventory from each supplier site and what changed (new product, price move,
stock move, promotion), buy price before/after, stock transitions, MOQ, lead time, a suggested action
per row, filters by change type and 48h/7d/30d, per-supplier cadence, "Scan now" (queues a
`scan_runs` job), and CSV export.

**Competition** — per competitor: new inventory listed, traffic trend and sources vs yours, the
keyword/SEO gap ranked by opportunity, social presence (**add a competitor's Instagram, TikTok,
Facebook or X handle here** — those handles are the scan's target list) and live ad counts, ad platforms, target
audiences by segment and age band, their ads with banner links (reference only) plus "build our own"
original briefs, reviews their customers leave with the 2-month rating trend, and scan cadence. Two
sub-tabs hold the measured detail: **Local** (your Google positions per device, the map 3-pack, your
Google Business profile health, share of voice and the rating/review-count gap against each
competitor) and **Social** (their recent public posts, the one to beat, and measured posting cadence).

**Social & reviews** — your reputation and channels in one place: the latest review scan per source
with a **reply composer** (every suggested reply is a draft you edit and send yourself), the review
profiles being monitored and a control to connect another by its public handle or URL, your social
scores with focus priorities, and the competitor benchmark set behind them.

**Clients** — your mail account (login email, reply-to, signature, digest), a form to add current
active customers, the customer list with inline status/frequency, a per-customer message schedule
(new stock, 2-day check-in, platform info, deals, competitor alert, review update, weekly report), a
customers-to-mail queue that actually delivers over Spacemail SMTP, records what the mail server said
for each customer and reschedules only the ones it accepted, and the recent email activity log.

**My Business** — SEO and GEO scores, traffic and channels, top SEO keywords and top GEO prompts for
the week, downloadable weekly SEO/GEO report, 2-month review analysis per source plus the latest
review scan with suggested replies, social scores with focus priorities, and inventory to buy next
driven by competitor traffic and keyword gaps.

**Inventory & services** — the catalogue your ads are built from: products (with stock) and services,
each with its own image.

**Promotions** — this page is a design brief, not a design tool. You pick the components your ad
should include (product, price, discount, deal, coupon, logo, contact, rating), fill in their values
— a discount can be a percentage or a money amount — plus the headline, format, accent colour and any
notes. Sending the brief writes it to Supabase for the design team. The **Ad frame** shows an "in design" placeholder until we finish, then the delivered design we pushed to the `delivered-ads`
bucket appears there to export. From the Ad frame (or a delivered row) the **`Post ad`** button opens
a post modal: pick the social accounts you connected, edit the caption the brief seeded, then post now
or schedule it in a timezone you choose. **Ads history** is a single timeline of every brief sent,
every design delivered and every post published, each with its platform badges and a link to the live
post.

---

## 7. Database layout

| Group | Tables |
| --- | --- |
| Tenant | `businesses` (one per Clerk user, filled by onboarding) |
| Suppliers | `suppliers`, `supplier_items` |
| Competitors | `competitors`, `competitor_metrics`, `competitor_social`, `competitor_keywords`, `competitor_ads`, `competitor_reviews`, `competitor_audience`, `competitor_items` |
| Clients | `clients`, `mail_accounts`, `sent_messages` |
| My business | `my_keywords`, `my_metrics`, `my_review_sources`, `my_review_series`, `my_reviews`, `social_scores`, `inventory_recommendations`, `buy_list_items`, `weekly_reports` |
| Catalogue | `inventory_items` (products & services, images in the `inventory-images` bucket) |
| Promotions | `promotion_briefs` (what the business asks for), `delivered_ads` (finished designs in the `delivered-ads` bucket) |
| Search & local | `serp_rankings`, `local_pack_rankings`, `local_profile_health`, `keyword_ideas` |
| Social monitoring | `competitor_social` (one monitored handle per competitor per platform — the scan's target list), `social_posts`, `social_monitor_targets` (how each handle was last scraped), `competitor_share_of_voice`, `competitor_review_gap` |
| Reputation | `review_connections` (profiles tracked by public handle), `review_replies` (sent/failed audit) |
| Publishing | `social_accounts` (mirrored from Mallary), `social_publish_jobs` (one row per push) |
| Integrations | `integration_connections`, `api_usage_log`, `integration_idempotency`, `webhook_events` (replay protection) |
| Operations | `scan_runs` (every scan queue, manual or scheduled) |

Key files:

```
supabase/migrations/0001_init.sql   schema, RLS, storage bucket
supabase/migrations/0005_inventory_and_promotions.sql  catalogue + superseded promotion designs
supabase/migrations/0006_promotion_briefs_and_delivered_ads.sql  ad briefs + delivered designs
supabase/migrations/0008_integration_foundation.sql  connections, usage log, idempotency
supabase/migrations/0009–0014_*.sql  search/local, benchmarks, social, reviews, publishing, webhooks
supabase/functions/                 the provider gateway (see §8)
src/lib/supabase.ts                 Supabase client using Clerk session tokens
src/lib/repo.ts                     all reads/writes + row mapping
src/lib/workspace.tsx               data provider (live Supabase or sample mode)
src/lib/integrations.ts             provider catalogue, usage/health readouts, gateway calls
src/pages/OnboardingPage.tsx        the six-step wizard
src/pages/LoginPage.tsx             Clerk sign-in / sign-up
src/lib/types.ts                    shared domain types
```

---

## 8. Third-party integrations — the provider gateway

Five providers are wired in behind one gateway. **No provider key ever reaches the browser:** the app
calls a Supabase Edge Function, which holds the key, makes the provider call server-side and writes
the result to a tenant-scoped table.

| Provider | What it powers | Gateway functions |
| --- | --- | --- |
| **SerpApi** | Google organic positions per device, the local map 3-pack, Google Business profile health, competitor keyword/Share-of-Voice benchmarks, autocomplete keyword ideas | `serp-scan`, `serp-competitors`, `keyword-ideas` |
| **Apify** | Competitors' recent public social posts, their engagement and posting cadence; and reading a competitor's own website to *propose* the social profiles it mentions (never applied without an explicit accept) | `social-scan`, `web-contacts-scan` |
| **Reviews** | Reviews from six platforms, read through the SerpApi and Apify accounts above. Not a vendor of its own — see §3.3 of the blueprint | `reviews-sync`, `review-reply` |
| **AI drafting** | Reply drafts for your reviews, original ad angles from a competitor's best post, and intent themes for keyword suggestions. **Every draft is a draft** — nothing is sent, posted or created without you | `ai-draft` |
| **Mallary.ai** | Publishing a finished ad design to your connected social accounts | `publish-ad`, `social-accounts` |
| **Spacemail SMTP** | Delivering the customer update emails — the desk's Send buttons and the scheduled run that mails whoever is due. SMTP credentials are server-side secrets like every other key here | `client-mail` |
| — | Which providers the server is configured for, and the caps it enforces | `integrations-status` |
| — | Inbound webhooks from both providers (signature-verified, replay-protected) | `provider-webhook` |

Shared plumbing lives in `supabase/functions/_shared/`: auth (Clerk JWT → tenant), HTTP client, budget
caps, idempotency, usage logging, CORS and webhook verification. Setup and the deploy commands are in
[`supabase/functions/README.md`](supabase/functions/README.md); the full plan, per-phase status and the
provider contract notes are in [`docs/API_INTEGRATION_BLUEPRINT.md`](docs/API_INTEGRATION_BLUEPRINT.md).

**Cost control.** Every call is logged to `api_usage_log` with its billable units and dollars.
`_shared/budget.ts` reads that log back and enforces a per-workspace monthly allowance per provider —
unit caps for SerpApi and Mallary, a dollar cap for Apify. Review reads are billed to whichever of
those two readers served them, so they are bounded by the same caps. AI drafting is deliberately
**uncapped** — it is user-triggered and costs a fraction of a cent — so it is logged and shown but
never refused; set `LLM_MONTHLY_CHARGE_USD` to put a ceiling on it. A run trims itself to what
fits and refuses with a clear message once the allowance is gone. Business settings shows a **Plan
usage** panel (the same numbers the caps enforce) and a **Monitoring health** panel (recent failed
scans and any connection a provider has rejected), and the Notifications page raises an alert at 80%
and again at 100%.

Website social discovery needs one more layer, because onboarding reads a competitor's site *before*
there is a workspace to bill: those preview reads are counted per **signed-in user** (10/hour by
default) from a service-role-only run ledger, and the spend is attributed to the user's workspace as
soon as they have one. The same ledger makes a repeat read idempotent — a partial unique index allows
one live run per competitor, and a read taken in the last couple of minutes is replayed rather than
paid for again. See `docs/SOURCE_MANAGEMENT_BLUEPRINT.md` Phase 4.

---

## 9. Not built yet

- The scheduled worker that fetches supplier/competitor **pages** (non-API sources) and writes rows.
  "Scan now" queues a `scan_runs` row and updates the last-scan time, and the provider gateway covers
  everything that has an API; this worker is the next piece.
- The **cron entry** that calls `client-mail` with `MAIL_JOB_SECRET` on a cadence. Delivery itself is
  built — the desk's Send buttons send through Spacemail SMTP and the function has a scheduled mode
  that mails every customer past their `next_send_at` — but nothing invokes that mode yet, so due
  emails go out when you press Send. See `supabase/functions/README.md` for the one-line trigger.
- Product photo shoots / ad exports uploaded to the `ad-assets` bucket (paths and signed URLs are
  already wired).
- Code splitting: the Clerk + Supabase bundle is one chunk today.

---

## 10. Product guardrail

Competitor advertising is treated as a **market signal**, never artwork to copy. Banner links are
shown for reference only, and every "build our own" action produces an original brief for your brand.
The same rule runs through publishing: the gateway will only ever post creative the tenant owns.

AI output follows the same rule. Reply drafts go into the composer for you to edit and send; angles
are options you pick from and they create a brief, never a published ad; keyword themes only label
suggestions you already had. A cluster may never contain a keyword the model invented — those are
dropped before the page sees them — and the drafting model is never handed text typed into the
browser: it works from rows we already hold for your tenant.
