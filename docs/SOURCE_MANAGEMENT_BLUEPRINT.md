# BIZLIT — Source Management & Competitor Social Discovery Build Blueprint

**Document type:** implementation blueprint (phased plan + feature mapping)
**Status:** **Phases 0–4 complete**; one live pass outstanding. The actor question (the one hard gate)
is decided and *pinned*: `vdrmota/contact-info-scraper` (`9Sk4JJhEma9vBKqrg`), set as
`APIFY_CONTACTS_ACTOR_ID` in `env.example` and `.env.local`. A competitor's socials can be entered by
hand at onboarding (Phase 2) or read off the competitor's own website and accepted from a proposal
(Phase 3), and every read is now bounded per user, claimed in the database and replayed rather than
re-billed (Phase 4). Migration `0020`, `web-contacts-scan` and `integrations-status` are deployed, and
all eight `APIFY_CONTACTS_*` secrets are set. What remains is the Clerk-authenticated click-through in
`LIVE_TEST_PLAN.md` §11–§12 — the part no sandbox can fake.
**Owners:** engineering
**Providers:** Apify — `vdrmota/contact-info-scraper` (`9Sk4JJhEma9vBKqrg`), pinned as
`APIFY_CONTACTS_ACTOR_ID`. No new vendor.
**App:** BIZLIT — React 19 + Vite SPA, Clerk auth, Supabase Postgres/Storage, RLS per tenant
**Companion docs:** `docs/API_INTEGRATION_BLUEPRINT.md` (the provider gateway this builds on),
`supabase/functions/README.md` (deployed functions), `LIVE_TEST_PLAN.md`.

> ## ⚠️ Read this first — the actor id in the brief was wrong; the replacement is decided
>
> The brief specifies **Website Contacts Scraper, actor id `KHpwuGIjj9pFfR5c`**. That id was checked
> against the live Apify API with the project's own account token and **returns `404
> record-or-token-not-found` in every form**:
>
> | Request | Result |
> | --- | --- |
> | `GET /v2/acts/KHpwuGIjj9pFfR5c` (with token) | `404 record-or-token-not-found` |
> | `GET /v2/acts/KHpwuGIjj9pFfR5c` (anonymous) | `404` — so it is not a public actor either |
> | `GET /v2/tasks/KHpwuGIjj9pFfR5c` / `/v2/actor-tasks/…` | `404` |
>
> So it is a bad copy/paste, a delisted actor, or an actor private to another account.
>
> **Decided (2026-09-28): use `vdrmota/contact-info-scraper` → `9Sk4JJhEma9vBKqrg`** — 60,783 users,
> 13.0M runs, 4.7★, `PAY_PER_EVENT`, and it explicitly extracts Facebook / Instagram / X / TikTok /
> YouTube / LinkedIn / Threads / Snapchat / Telegram / Reddit / Discord / WhatsApp. Its input and
> output shapes were read off the live API (Appendix B) and confirmed end to end by a real run in
> Phase 0, whose dataset item is saved as `tests/fixtures/contacts-item.json`.
>
> The plan stays actor-agnostic anyway: the id is configuration (`APIFY_CONTACTS_ACTOR_ID`), not a
> constant, so swapping it later is a secret change rather than a release. Appendix A records the
> alternatives that were checked.

---

## 1. Purpose and scope

Two product capabilities, both about **who we watch** rather than what we find:

**F1 — Competitors and suppliers become editable.** Today the only way to change the list of watched
businesses is to walk back through the onboarding wizard. The brief asks for it in the pages where the
data is actually used: **Competition** and **Suppliers** must let a user add, edit and remove a watched
source, so what onboarding captured can be corrected and grown afterwards.

**F2 — A competitor's social profiles can be captured at onboarding, by hand or automatically.**
During onboarding, when the user types a competitor's website, they can either (a) type that
competitor's social handles themselves, or (b) press one button and have the app read the competitor's
own website with an Apify "Website Contacts Scraper" and propose the social profiles it finds there.

Everything else in the app already consumes `competitor_social` (`social-scan` scrapes exactly those
rows — see `supabase/migrations/0016_competitor_social_handles.sql`), so F2 is additive: it produces the
same rows the Competition page's **Social presence** card produces today, just earlier and with less
typing.

**Explicitly out of scope** (named so they are not assumed):

- No crawling of a competitor's *social* pages for contact details — only their website.
- No change to what `social-scan` scrapes. Discovery finds profiles; scraping them is Phase 2 of the
  existing `docs/API_INTEGRATION_BLUEPRINT.md` and is untouched.
- No LinkedIn/YouTube/Threads monitoring. Discovery will *see* those platforms (the actor returns them)
  but the app can only scan Instagram / TikTok / Facebook / X, so the rest are shown as
  "found, not monitored" and never written (§5 Phase 3, decision 3).
- No email/phone storage. The actor returns emails, phones and personal-data leads; we discard all of
  it. We want the social profile URLs and nothing else (§6.3).

**Non-negotiable guardrails already in the product (must be preserved):**

1. **Competitor content is a signal, never artwork.** Nothing here republishes a competitor's material.
2. **All provider secrets stay server-side.** Keys live in Supabase Edge Function secrets, never in
   `VITE_*`.
3. **Tenant isolation.** Every row carries `business_id` and is covered by the existing RLS policies.
4. **Demo-mode parity.** With no Clerk/Supabase keys, every new surface renders from `src/data/`. The
   demo provider never calls Apify — it returns canned suggestions.
5. **No unconfirmed writes.** Discovery returns *suggestions*; a human saves them. The one thing the
   app must never do is silently invent a profile from a marketing page's footer and then bill a scrape
   against it.

---

## 2. Where this lands in the architecture

No new architecture. Both features use the gateway the existing blueprint established: the browser
talks to Supabase (RLS) and to Supabase Edge Functions (provider calls, secrets server-side).

```
┌──────────────────────────┐   Clerk JWT   ┌────────────────────────────────────┐
│  Browser SPA (Vite)      │ ────────────► │  Supabase Edge Functions (Deno)    │
│  Competition / Suppliers │ ◄──────────── │  web-contacts-scan  (NEW)          │
│  OnboardingPage          │   JSON        │  social-scan, serp-*, ai-draft …   │
└───────────┬──────────────┘               └───────────┬────────────────────────┘
            │ supabase-js (RLS)                        │ HTTPS  (APIFY_TOKEN)
            ▼                                          ▼
┌──────────────────────────────────────┐   ┌────────────────────────────────────┐
│ Postgres: competitors, suppliers,    │   │ Apify — "Website Contacts Scraper" │
│ competitor_social, api_usage_log …   │   │ reads the competitor's OWN website │
└──────────────────────────────────────┘   └────────────────────────────────────┘
```

### 2.1 Functions to add

| Function | Provider | Trigger | Reads | Writes |
| --- | --- | --- | --- | --- |
| `web-contacts-scan` | Apify (contacts actor) | Onboarding "find them automatically"; "Find socials" on Competition → Social presence | the competitor's website | `api_usage_log` always; `competitors.contacts_*` in stored mode. **Never** `competitor_social`. |

One function, two modes, one code path — described in §5 Phase 3. Deployed with `--no-verify-jwt`
(the bearer token is a Clerk token, verified in the function), exactly like `social-scan`.

### 2.2 Shared utilities to add

- `supabase/functions/_shared/contacts.ts` — the contacts-actor client: actor id resolution,
  input builder, run lifecycle, and the dataset-item → suggestion normaliser. It **imports** the
  existing transport from `_shared/apify.ts` (`startRun`, `waitForRun`, `fetchDatasetItems`,
  `isTerminal`, `ApifyRun`) rather than reimplementing it, so there is one run/retry/charge path in the
  codebase. Everything else in `apify.ts` is social-post-specific and stays untouched.

### 2.3 Reused as-is (do not duplicate)

- `_shared/auth.ts` — `requireCaller(req)` then `assertBusinessOwned(caller.userId, businessId)`.
- `_shared/budget.ts` — `readSpend` / `spendMessage` against the **apify** monthly cap, so discovery
  spend is counted where social spend already is.
- `_shared/usage.ts` — `recordUsage({ businessId, provider: "apify", endpoint, units, costUsd })`.
- `_shared/env.ts` — `getEnv` treats a blank value as absent, which is what makes "leave the actor id
  empty and the feature reports itself unavailable" work for free.
- `_shared/cors.ts`, `_shared/errors.ts`, `_shared/http.ts` — the standard envelope and error
  classification every function uses.

---

## 3. Feature → surface map

| # | Requested capability | Where it appears | New thing |
| --- | --- | --- | --- |
| M1 | Add a competitor | Competition page (header of the "Watching" card) → **Add competitor** modal | `createCompetitorRow` + `actions.addCompetitor` |
| M2 | Edit a competitor (name, website, cadence, notes) | Competition page → **Edit** on the active competitor | `updateCompetitorRow` + `actions.updateCompetitor` |
| M3 | Remove a competitor | Competition page → **Remove** (confirm modal naming what else goes) | `deleteCompetitorRow` + `actions.removeCompetitor` |
| M4 | Add a supplier | Suppliers page (Watching card) → **Add supplier** modal | `createSupplierRow` + `actions.addSupplier` |
| M5 | Edit a supplier (name, website, category, cadence, lead time) | Suppliers page → **Edit** on a supplier | `updateSupplierRow` + `actions.updateSupplier` |
| M6 | Remove a supplier | Suppliers page → **Remove** (confirm modal) | `deleteSupplierRow` + `actions.removeSupplier` |
| M7 | A competitor's socials, entered by hand | Onboarding step 3 ("Competitors"), per row → **Add their social profiles** | `MonitoringSourceInput.socials[]` |
| M8 | A competitor's socials, discovered automatically | Onboarding step 3, per row → **Find them automatically** | `web-contacts-scan` (preview mode) |
| M9 | Re-run discovery later | Competition → Social presence → **Find socials from their site** | `web-contacts-scan` (stored mode) |
| M10 | Both of the above, still editable afterwards | Competition → Social presence (exists) | unchanged, just no longer the *only* way in |

F2 is M7–M10. M1–M6 are F1.

---

## 4. Data model additions

### 4.1 Migration `0019_competitor_discovery.sql`

One migration, additive, safe to run twice.

```sql
-- Provenance: where a monitored handle came from, so the UI can say
-- "found on their site" vs "you added this", and so a re-discovery never
-- silently overwrites something a human typed.
alter table public.competitor_social
  add column if not exists source text not null default 'manual';
alter table public.competitor_social
  add column if not exists discovered_at timestamptz;

-- Drop a CHECK-constrained default cleanly for existing rows.
alter table public.competitor_social
  drop constraint if exists competitor_social_source_check;
alter table public.competitor_social
  add constraint competitor_social_source_check
  check (source in ('manual', 'discovered', 'imported'));

-- Discovery state, so a slow run is collectable later and the button can
-- show "checking…" rather than lying about having finished.
alter table public.competitors
  add column if not exists contacts_status text not null default 'idle';
alter table public.competitors
  add column if not exists contacts_scanned_at timestamptz;
alter table public.competitors
  add column if not exists contacts_run_id text;
alter table public.competitors
  add column if not exists contacts_error text;

alter table public.competitors drop constraint if exists competitors_contacts_status_check;
alter table public.competitors
  add constraint competitors_contacts_status_check
  check (contacts_status in ('idle', 'running', 'done', 'failed', 'skipped'));

comment on column public.competitor_social.source is
  'manual = a person typed it; discovered = proposed by web-contacts-scan and accepted.';
```

Then two hardening steps, both safe on the live dataset (**`competitor_social` holds 0 rows today**):

```sql
-- A monitored handle with no handle is a target nothing can scrape.
delete from public.competitor_social where handle is null or btrim(handle) = '';
alter table public.competitor_social alter column handle set not null;
```

Also worth doing in the same migration, because the UI now shows it:

```sql
create index if not exists competitors_contacts_status_idx
  on public.competitors (business_id, contacts_status);
```

**No RLS changes.** `competitor_social` and `competitors` already carry the four
`business_id in (select public.current_business_ids())` policies from `0001_init.sql`; new columns are
covered by them.

### 4.2 Suppliers need no migration

`suppliers` already has everything the forms collect (`name`, `website`, `category`, `cadence`,
`lead_time_days`, `notes`). The only schema question is what "remove" means — see §5 Phase 1,
decision 2. **`0020_*` was left unclaimed here so that decision stayed open** — Phase 4 later claimed
it for `0020_contacts_discovery_runs.sql`, and `0021` went to the site-scan change columns, so an
archive soft delete would now be `0022`.

### 4.3 Client-side shape additions

In `src/lib/types.ts`:

```ts
/** A competitor's social profiles as entered during onboarding, one per platform. */
export interface CompetitorSocialInput { platform: string; handle: string }

/** MonitoringSourceInput gains an optional social list (F2 / M7). */
export interface MonitoringSourceInput {
  name: string;
  website: string;
  category: string;
  cadence: Cadence;
  socials?: CompetitorSocialInput[];   // NEW — defaults to [] when absent
}

/** One profile web-contacts-scan found on a competitor's own website. */
export interface SocialSuggestion {
  platform: string;      // instagram | tiktok | facebook | x  (lowercased actor key)
  handle: string;        // bare handle, via normaliseSocialHandle()
  url: string;           // the exact URL the actor returned, for "verify" links
  monitorable: boolean;  // false for youtube/linkedin/threads … (no actor)
}

export interface ContactDiscoveryResult {
  status: "done" | "running" | "failed";
  runId?: string;
  competitorId?: string;
  scannedUrl: string;
  suggestions: SocialSuggestion[];
  /** Platforms the actor reported that we cannot scrape, shown but never saved. */
  unmonitored: string[];
  costUsd?: number;
}
```

`Competitor` gains the discovery state only if the UI shows it (`contactsStatus`, `contactsScannedAt`)
— that is Phase 3's business, not this one's.

**One addition this phase did need:** `notes?: string` on both `Supplier` and `Competitor`. The forms
collect notes for both, and the client shapes had no such field, so the loader would have dropped the
column and re-saving a form would silently blank notes the user had written. `mapCompetitorBase` and
`mapSupplierRow` carry it, optional because most sources have none.

---

## 5. Phased build plan

Each phase is independently shippable and leaves the app working. Phase 0 is a gate.

---

### Phase 0 — Confirm the actor, then build the foundation

> **Status: complete.** Actor confirmed and live-verified (`vdrmota/contact-info-scraper`,
> `9Sk4JJhEma9vBKqrg`), a real 3-page run recorded as a fixture, migration `0019_competitor_discovery.sql`
> applied to remote and re-run clean, and the repo + demo/action layer shipped —
> `createCompetitorRow`, `updateCompetitorRow`, `deleteCompetitorRow`, `createSupplierRow`,
> `updateSupplierRow`, `deleteSupplierRow`, `saveCompetitorSocialHandles`, plus the seven matching
> workspace actions in both providers. Typecheck clean, 133 tests pass, build succeeds.
>
> **One decision from the first draft was changed** — deliverable 4: `setCompetitorContactsState` was
> dropped, because `competitors.contacts_*` is written only by the gateway, which holds the run id and
> the cost. Nothing is outstanding; Phase 1 can start.

**Objective:** know *exactly* which actor we are paying, prove its input and output against the live
API, and have the schema + repo layer in place before any UI depends on it.

**Deliverables**

1. ✅ **Decide the actor** (Appendix C, decision 1). Chosen: `vdrmota/contact-info-scraper`
   (`9Sk4JJhEma9vBKqrg`), recorded as `APIFY_CONTACTS_ACTOR_ID=9Sk4JJhEma9vBKqrg` in `env.example`
   and `.env.local` — **not** hard-coded, so swapping is a secret change, not a release. Pushing the
   value to the deployed functions' secrets is part of Phase 3/4, since nothing reads it until
   `web-contacts-scan` exists.
2. **Verify it, once, with the real token** — done, and it is the reason the caps in §8 are what they
   are:
   - `GET /v2/acts/{id}` → 200; `pricingModel` is `PAY_PER_EVENT`, and the actor's own
     `minimalMaxTotalChargeUsd` is **0.5**.
   - `GET /v2/acts/{id}/builds/default` → `inputSchema` is a **JSON string** (parse it, do not treat it
     as an object); `required` is `["startUrls", "proxyConfig"]`.
   - **Cap floor confirmed empirically.** A run with `maxTotalChargeUsd=0.25` is rejected outright:
     `max-total-charge-usd-below-minimum` — *"Maximum cost per run is less than the allowed minimum of
     $0.50"*. The same input at `0.5` starts normally. The actor therefore **cannot run under the
     existing `APIFY_MAX_CHARGE_USD=0.25`** and needs the separate ceiling in §8.
   - **A real run succeeded**: 3 pages against a live competitor site, status `SUCCEEDED`,
     `usageTotalUsd` **$0.004**, `chargedEventCounts` `{ pages-scraped: 0, actor-start-gb: 4 }`. Its
     dataset item is saved as the fixture **`tests/fixtures/contacts-item.json`** — the artefact Phase
     3's normaliser will be verified against, exactly as `_shared/reviews.ts`'s field aliases were
     fixed from live smoke tests.
   - `proxyConfig` is required and `{ "useApifyProxy": true }` is accepted; the paid extras
     (residential proxy, browser) stay **off**.
3. ✅ **Migration** `0019_competitor_discovery.sql` (§4.1), applied to remote and verified (below).
4. **Repo layer** in `src/lib/repo.ts` — pure data functions, no UI:
   - `createCompetitorRow(businessId, input)` / `updateCompetitorRow(competitorId, patch)` /
     `deleteCompetitorRow(competitorId)`
   - `createSupplierRow(businessId, input)` / `updateSupplierRow(supplierId, patch)` /
     `deleteSupplierRow(supplierId)`
   - `saveCompetitorSocialHandles(businessId, { competitorId, handles, source })` — one bulk upsert on
     the existing `(business_id, competitor_id, platform)` unique index, so onboarding can write a
     whole step in one call. Wraps, and does not replace, `saveCompetitorSocialHandle` (the
     single-handle path the Competition page already uses). Rows it cannot address are dropped rather
     than saved, and the first entry wins when a platform repeats, matching `mergeSocialChannel`.
   - ~~`setCompetitorContactsState`~~ — **dropped, deliberately.** `competitors.contacts_*` is written
     only by the gateway, which holds the run id and the cost; a client function for it would have no
     caller and would put a write path where the truth does not live. The UI's "checking…" state is
     component state, and `SocialChannel.source` is what the badge reads. *This is a change from the
     first draft of this phase.*

   One mapper refactor came with it: `mapCompetitorBase` / `mapSupplierRow` now sit above
   `loadWorkspace`, which spreads the related collections on top. `loadWorkspace` and the create paths
   previously would each have needed their own copy of the competitor's scalar columns.
5. **Demo providers** for every one of the above in `src/lib/workspace.tsx`, mutating sample state the
   same way `addClient`/`removeClient` already do — including a canned
   `sampleSocialSuggestions(website)` in `src/data/business.ts`.

**Acceptance criteria**

- ✅ Live proof that the chosen actor returns social URLs for a real competitor site — the run above,
  with its dataset item saved as `tests/fixtures/contacts-item.json`. (The "unsupported actor id
  reports itself unavailable" half belongs to Phase 3, which is where the actor id is read.)
- ✅ `npm run typecheck` clean; 133 existing tests still pass; `npm run build` succeeds.
- ✅ Migration applied to remote and re-runnable. `supabase_migrations.schema_migrations` lists
  `0019 competitor_discovery`; the live schema was read back and matches the file (both
  `competitor_social` columns with `source` defaulting to `'manual'`, `handle` now `NOT NULL`; all four
  `competitors.contacts_*` columns; both CHECK constraints; `competitors_contacts_status_idx`).
  `competitor_social` held 0 rows, so the handle hardening was a no-op rather than a repair. The file
  was then re-applied verbatim through the Management API and returned without error, leaving the
  schema unchanged — the `if not exists` / `drop … if exists` guards do their job.

  Applied with the Management API (`POST /v1/projects/{ref}/database/query`) because the CLI's
  `SUPABASE_DB_PASSWORD` was rejected at the pooler (`28P01`); `0019` was already recorded there, so
  this pass was verification plus an idempotency proof, not a new push.

**Risks:** the actor's pricing can change under us (`pricingInfos` already shows a legacy
`PRICE_PER_DATASET_ITEM` entry *and* the current `PAY_PER_EVENT` model). Pin the actor id in the secret
and record the pricing model in the PR, exactly as `env.example` already does for the social actors.

---

### Phase 1 — Competitors and suppliers you can actually manage (F1 / M1–M6)

> **Status: complete.** Both pages can add, rename, re-cadence and remove what onboarding captured.
> `CompetitorFormModal` / `SupplierFormModal` are one reusable `Modal` per page with inline validation;
> the removals go through a confirm dialog that names the collateral and a shared `ConfirmButton` that
> needs two clicks. The Competition empty state gained the Add button that makes it a way out rather
> than a dead end. `npm run typecheck` clean, 135 tests pass (133 + 2), build succeeds.
>
> **Deviations, both recorded below:** the new flow tests landed in `tests/app.test.tsx` rather than
> `tests/operations.test.tsx` (that file is pure logic with no React harness — the render harness lives
> in `app.test.tsx`, where the other page flows are), and `notes?: string` had to be added to the
> `Competitor` / `Supplier` client shapes so the edit forms do not blank it.

**Objective:** the Competition and Suppliers pages can add, edit and remove what onboarding captured,
so the lists stop being write-once.

**Deliverables**

1. **Workspace actions** (`src/lib/workspace.tsx`), each with a demo implementation:
   `addCompetitor`, `updateCompetitor`, `removeCompetitor`, `addSupplier`, `updateSupplier`,
   `removeSupplier`. Live versions are thin wrappers over the Phase 0 repo functions plus
   `patchData`, following `addClient`/`removeClient` exactly. New rows get the same defaults
   onboarding gives them (`cadence` from the page's current selection, `next_scan_at` via
   `nextScanFrom`), so a competitor added here is scanned on the same schedule as one added at setup.
2. **Competition page** (`src/pages/CompetitionPage.tsx`):
   - an **Add competitor** button in the "Watching" card;
   - **Edit** / **Remove** on the active competitor (a small overflow next to "Scan now", or a
     settings row under the pill bar);
   - one reusable `CompetitorFormModal` (name, website, cadence, notes) used for both add and edit;
   - a confirm step for remove that **names the collateral** (see decision 2);
   - the empty state (`if (!competitor)`) gains the Add button — today it is a dead end.
3. **Suppliers page** (`src/pages/SuppliersPage.tsx`):
   - an **Add supplier** button in the Watching card and in the empty state;
   - **Edit** / **Remove** per supplier (the pills currently only link out to the vendor site, so add
     a manage affordance rather than overloading the pill);
   - one reusable `SupplierFormModal` (name, website, category, cadence, lead time, notes).
4. **Shared primitives:** reuse `Modal`, `Field`, `inputClass`, `btnPrimary`, `btnGhost`, and the
   existing `useActionToast` success/failure contract. A failed save must not leave the modal closed
   with a green toast — match how `saveHandle()` already behaves.

**Decisions worth knowing**

1. ✅ **URL normalisation — done.** `normaliseWebsite()` sits in `src/lib/format.ts` beside
   `domainFromUrl()`, and keeps only the host: `supplier.com`, `https://supplier.com/` and
   `https://supplier.com/wholesale` all become `https://supplier.com`. It returns `""` for anything it
   cannot read as a URL, which is what lets the forms refuse it instead of storing a string no scan can
   open. Used by the competitor and supplier forms **and** by onboarding's `finish()`, so a site typed
   at setup is stored exactly as the edit form would store it. Onboarding's `stepError` also gained a
   check, so an unreadable domain is reported on the step rather than normalised to an empty website at
   submit. (The gateway input is Phase 3's, and will import the same function.)
2. **Removing is a hard delete, because everything underneath it cascades.** Verified against the
   schema: deleting a competitor cascades to `competitor_metrics`, `competitor_social`,
   `competitor_keywords`, `competitor_ads`, `competitor_reviews`, `competitor_audience`,
   `competitor_items`, `competitor_share_of_voice`, `competitor_review_gap`, `social_posts` and
   `social_monitor_targets`. Deleting a supplier cascades `supplier_items` and **sets
   `inventory_recommendations.supplier_id` to null** (`on delete set null`) — so our own catalogue and
   briefs survive, which is right. The confirm modal must say what goes ("this also removes N detected
   products and M posts") and require a second click. *The alternative — an `archived_at` column and a
   soft delete — is the cleaner long-term model but doubles the read-path changes (every query in
   `loadWorkspace` would need `is archived` filtering). It is deferred, not rejected: the next free
   migration number is `0022` (`0020` went to the discovery ledger, `0021` to the site-scan change
   columns).*
3. **Removing the last competitor must not break the page.** `CompetitionPage` already returns the
   "No competitors yet" card for an empty list — keep that path working (and give it the Add button),
   and make sure `activeId` is re-pointed when the active competitor is removed.
4. **Editing a website does not wipe its history.** `updateCompetitorRow` patches only the columns the
   form owns. Existing scans, posts and reviews stay attached to the same `competitor_id`; they simply
   refer to a domain that changed. Worth a one-line hint in the edit modal.

**Demo mode:** all six actions mutate the sample workspace in memory, so the demo still shows a
working add/edit/remove flow on sample competitors and suppliers. No gateway call is ever made.

**Acceptance criteria**

- ✅ Add → the new competitor is appended to the pill bar and becomes active, so the header switches
  to it (`setActiveId(created.id)`) instead of leaving the page on someone else. Its cadence pill then
  works like any other.
- ✅ Edit → the website is normalised once (`normaliseWebsite`), so a pasted `…/shop` path is stored as
  the host; the form is prefilled from the row, and `notes` is carried rather than blanked.
- ✅ Remove → the confirm names what goes ("this also deletes 2 monitored social profiles, 3 tracked
  keywords…"), and the shared `ConfirmButton` requires a second click. `activeId` is re-pointed to the
  next competitor (or the previous one, or the empty state) *before* the re-render, so the page never
  renders a card for a row that no longer exists.
- ✅ The same three flows work for suppliers, and the "Suppliers monitored" stat follows (asserted in
  the test, not just eyeballed). The supplier filter dropdown is reset if it was holding the removed row.
- ✅ A missing `name`/`website` blocks submit with an inline message in the dialog, which stays open
  with what was typed — `useActionToast` is deliberately *not* used for the form submits, because it
  reports and closes on success *and* failure alike.
- ✅ Tests: add/edit/remove for both entities against the demo provider, in `tests/app.test.tsx`
  (2 new tests, 27 → 29 in that file). They cover the inline refusal, the normalisation, the
  collateral copy and the two-click guard; they do not assert `not.toContain(name)`, because the
  success toast legitimately still names it.

---

### Phase 2 — Onboarding: a competitor's socials, typed by hand (F2 / M7)

> **Status: complete.** Onboarding step 3 offers a collapsed, per-competitor **Add their social
> profiles** section (platform select + handle + Add, with a `Trash2` on each saved row), and the
> confirm step reports how many were recorded. `createWorkspaceFromOnboarding` now inserts competitors
> one at a time and reads each id back, so the handles have a row to hang off, and writes them through
> `saveCompetitorSocialHandles(..., { source: "manual" })` — the same function the Competition page
> uses and the one Phase 3's discovery will use. `npm run typecheck` clean, 137 tests pass (135 + 2),
> build succeeds.
>
> **One deviation:** `tests/onboarding.test.tsx` gained two tests rather than extending the existing
> ones. The existing "walk every step" test is the only coverage of the competitors-blank path, so it
> was left as it is and the with-socials and competitor-but-no-socials paths were added beside it.

**Objective:** at the moment the user types a competitor's website, they can also record that
competitor's social profiles, per platform.

**Deliverables**

1. ✅ **Onboarding step 3** (`src/pages/OnboardingPage.tsx`, `step === 3`): each competitor card gained
   an expandable **"Add their social profiles"** section — a platform `<select>` + handle input + Add,
   with a `Trash2` on each saved row. `normaliseSocialHandle` reduces `@brand`, `brand` and a pasted
   profile URL to the bare handle, the same rule the Competition page enforces.

   *A small detail worth knowing:* this page already imported `SOCIAL_PLATFORMS` from `../lib/options`,
   and that list is *display labels* ("Instagram", "TikTok"). The scraper keys live in
   `../lib/social`, so that import is aliased to `SOCIAL_PLATFORM_KEYS` — storing "Instagram" where the
   gateway switches on `"instagram"` would have produced rows that match no actor.
2. ✅ **State:** `MonitoringSourceInput.socials` (§4.3), written through the existing `updateSource`
   reducer, so no new state plumbing. The draft handle and the expanded card are the only new state.
3. ✅ **Persistence — done.** `createWorkspaceFromOnboarding` inserts competitors **one at a time with
   `.select().single()`** and then calls `saveCompetitorSocialHandles(..., { source: "manual" })` for
   each row that has socials. Keying on the name was rejected as planned — two competitor rows may
   legitimately share a name — and a bulk insert was rejected because PostgREST is not obliged to
   return the ids in input order.
4. ✅ **Validation:** `stepError` unchanged in substance — socials are never required, and a duplicate
   platform is a replace, not an error. The section reports an unreadable handle inline instead of
   adding a row that cannot be scraped.
5. ✅ **Confirm step** (`step === 5`) reports **"Social profiles recorded: N"**, counted from what the
   user actually entered, so the step is visibly not a no-op.

**Demo mode:** onboarding is unreachable without Clerk (`needsOnboarding` is false), so parity here is
**via the actions, not the wizard**: `actions.saveCompetitorSocials` mutates the sample competitors in
memory, and the Competition → Social presence card renders the result. The demo `completeOnboarding`
stays a no-op, which is honest — there is no tenant row to seed.

**Acceptance criteria**

- ✅ (code path) A competitor entered with two platforms reaches the workspace as two
  `{ platform, handle }` pairs with bare handles, written with `source: "manual"`. ⏳ The row read-back
  in live mode is the Phase 4 rollout pass — it needs a real Clerk session and a real tenant, which a
  sandbox cannot fake, and the write goes through `saveCompetitorSocialHandles`, whose upsert and
  normalisation are already covered by the Competition page's path.
- ✅ Adding the same platform twice replaces rather than duplicates — asserted in the wizard ("2
  recorded" after re-adding Instagram, not 3) and enforced one layer down by the unique index and the
  upsert.
- ✅ Skipping the section entirely still completes onboarding, and records nothing: the competitor
  carries no `socials` key at all, so `createWorkspaceFromOnboarding` writes no rows rather than an
  empty one. Asserted.
- ✅ Tests: two new cases in `tests/onboarding.test.tsx` — the with-socials walk (normalisation,
  second platform, replace-not-duplicate, per-platform removal, and the confirm-step count) and the
  competitor-without-socials path.

**Risks:** the onboarding form is already the longest surface in the app; keep it collapsed by default
and per-competitor, or it becomes a wall of inputs at the worst possible moment.

---

### Phase 3 — Onboarding: discovery from their website (F2 / M8–M9)

> **Status: complete (live click-through deferred).** `_shared/contacts.ts` holds the actor client,
> `web-contacts-scan` is deployed-ready with its three modes and cap layering, and both surfaces share
> one review checklist (`src/components/SocialSuggestions.tsx`): onboarding step 3's **Find them
> automatically** (preview mode) and Competition → Social presence → **Find socials from their site**
> (stored mode). The manual and automatic paths converge on `saveCompetitorSocialHandles`, so
> `source: "manual" | "discovered"` is the only difference between them. `npm run typecheck` clean,
> 154 tests pass (137 + 17), build succeeds.
>
> **Deployed (2026-09-28):** `web-contacts-scan` is ACTIVE on the live project with `verify_jwt=false`
> alongside the other eleven, and the six `APIFY_CONTACTS_*` secrets are set (an unauthenticated POST
> is Clerk-rejected with `401 {"error":"Missing bearer token."}`, which also proves the function booted
> and its `_shared/contacts.ts` import chain resolved).
>
> **Not yet proven live:** the two acceptance criteria that need a real Clerk session and tenant — the
> button returning a profile in the running app, and the resulting `competitor_social` row. The
> *actor's* half is proven: Phase 0's live run is the fixture `tests/contacts.test.tsx` asserts
> against, field names included. The write half goes through the same upsert Phases 1 and 2 already
> ship against the `competitor_social` unique index.
>
> **Deviations, recorded below:** the "unavailable" state is explained on click rather than by
> disabling the button up front (the client has no actor-id channel to read), and the two demo-mode
> flow tests landed in the pages' existing test files rather than in `tests/contacts.test.tsx`, which
> stays a pure normaliser suite.

**Objective:** one button on a competitor row reads that competitor's own website and proposes the
social profiles it mentions, for the user to accept — never to auto-apply.

**Deliverables**

1. ✅ **`_shared/contacts.ts`** — the actor client:
   - `contactsActorId()` → `getEnv("APIFY_CONTACTS_ACTOR_ID")`, empty when unset, mirroring
     `actorFor()` in `_shared/apify.ts`. Blank means "not configured on this deployment" and the whole
     feature reports itself unavailable rather than guessing an id.
   - `contactsInputFor(url, caps)` → the actor's real input shape, verified in Phase 0. For
     `vdrmota/contact-info-scraper` that is currently:
     ```ts
     {
       startUrls: [{ url }],                 // required
       proxyConfig: { useApifyProxy: true }, // required; datacenter, NOT residential
       maxRequests: caps.maxPages,           // hard page ceiling — the real cost guard
       maxRequestsPerStartUrl: caps.maxPages,
       maxDepth: 1,                          // home + one hop (usually /contact, /about)
       sameDomain: true,
       mergeContacts: true,                  // one result row per start URL
       useBrowser: false,                    // +$0.003/page — keep off on the Free plan
       scrapeSocialMediaProfiles: { facebooks: false, instagrams: false, youtubes: false,
                                    tiktoks: false, twitters: false }, // off: each profile bills
     }
     ```
     Every key above was read off the actor's live `inputSchema`, not from memory; the same rule as
     Phase 2 of the existing blueprint applies — an unverified key is worse than a missing feature,
     because a run that returns nothing is still charged.
   - `normaliseContacts(item)` → `{ suggestions, unmonitored }`: reads the actor's plural array fields
     (`instagrams`, `twitters`, `facebooks`, `tiktoks`, `youtubes`, `linkedIns`, `threads`, …), reduces
     each URL to a bare handle, maps X's `twitters` onto our `x` key, and marks a suggestion
     `monitorable` only when the platform is a key of `SOCIAL_PLATFORMS` (the server copy in
     `_shared/apify.ts`). **Field names come from Appendix B and must be re-confirmed against the saved fixture
     before merge** — the whole point of Phase 0's fixture. Emails, phones and `leadsEnrichment` are
     dropped on the floor here, deliberately.
2. ✅ **Function `web-contacts-scan`** (`supabase/functions/web-contacts-scan/index.ts`), modelled on
   `social-scan` (same imports, same cap layering, same deferred-run lifecycle, same response
   envelope). Two modes in one handler:
   - **Preview mode** — `{ url, label? }`, no `businessId`. This is what onboarding calls, *before the
     tenant row exists*. It authors nothing: no `competitor_social` write and no
     `competitors.contacts_*` write (there is no competitor row yet). It returns suggestions plus the
     `runId`. `recordUsage` is called with `business_id: null` (the column is nullable for exactly
     this) and `endpoint: "contacts:preview"`.
   - **Stored mode** — `{ businessId, competitorId }`, `assertBusinessOwned(caller.userId, businessId)`,
     scrapes the stored `competitors.website`, advances `contacts_status` through
     `running → done | failed`, stores `contacts_run_id` when the run outlives the wait, and returns
     suggestions. Used by Phase 1's new "Find socials from their site" button.
   - **Collect mode** — `{ businessId?, runId }`. A run we stopped waiting for is not thrown away: the
     next call collects it. This is the same contract `social-scan` and `reviews-sync` already use, and
     it keeps preview mode stateless.
   - **Cap layering**, in the same order as `social-scan`: per run (`maxTotalChargeUsd` **≥ 0.50** for
     this actor — see Phase 0, step 2 — plus a hard `maxRequests` page ceiling), per workspace per
     month (`readSpend` + `spendMessage` on the **apify** cap), per invocation (one target).
     `APIFY_MAX_ITEMS` does **not** bound a `PAY_PER_EVENT` actor; the dollar cap and the page ceiling
     are the only real guards, which is why both are sent.
3. ✅ **UI — onboarding step 3:** each competitor row gets a second, collapsed section:
   > **Find them automatically** — reads their website and proposes the social profiles it finds.
   Pressing it shows inline progress, then a checklist of suggestions (platform, handle, the URL it was
   found on, and whether we can monitor it). Accepting writes to `MonitoringSourceInput.socials`, i.e.
   into the Phase 2 shape, so **the manual and automatic paths converge on exactly one persistence
   mechanism** — there is only ever one thing to get right. Any handle the user edits here is stored
   with `source: "manual"`; only untouched, still-discovered ones are `"discovered"`.
   Platforms we cannot monitor (YouTube, LinkedIn, Threads, Snapchat, Telegram, Reddit, Discord,
   WhatsApp…) are listed separately as "found, not monitored" and are never written.
4. ✅ **UI — Competition → Social presence:** a **Find socials from their site** button that calls stored
   mode, shows last-checked time and a clear "nothing found — add it by hand" outcome, and merges the
   results into the same review checklist. Respect `contacts_status` so the button reads
   "checking…" while a run is live.
5. ✅ **Docs + config:** `env.example` (the six new vars, §8, with the pricing note), `README.md`,
   `supabase/functions/README.md` (layout, secrets, deploy list and rules) and a new row in §2.1 of
   `docs/API_INTEGRATION_BLUEPRINT.md` pointing here.

**As built, in one paragraph.** The actor id is pinned as `9Sk4JJhEma9vBKqrg` rather than the
`owner~name` form, so a swapped actor is a secret change and nothing has to parse an id to know the
slug. The normaliser keys its suggestions on **our** platform names, and asks the gateway's own
`SOCIAL_PLATFORMS` catalogue whether each is monitorable — so a platform the app cannot scrape is
reported as "found, not monitored" without the contacts module needing its own copy of that list.
`profileHandle()` refuses a bare domain explicitly: storing "instagram.com" as a handle would build a
profile URL around it and scrape nothing while still being billed. Both surfaces render the single
`SocialSuggestions` checklist, and an edited handle is stored `manual` while an untouched one stays
`discovered`, which is what the badge in Social presence reads.

**Decisions worth knowing**

1. **Suggestions are never auto-applied, even in the "automatic" path.** The user asked for the
   profiles to be "inputed for them automatically"; the app reads their site automatically and
   *proposes*, then one click accepts. Auto-writing is a real risk here and not an academic one: a
   scraper reading a site's footer will happily return the profiles of its *web agency*, its payment
   provider, or a brand it resells. Since every accepted handle becomes a **billed scrape target**,
   auto-applying would let a footer link quietly cost money and pollute the competitor's data.
2. **Preview mode is authenticated but not yet tenant-scoped, and that is a known, bounded gap.**
   Onboarding runs before a business row exists, so the call cannot be scoped to a business and its
   usage cannot be counted against that workspace's monthly cap (`api_usage_log.business_id` is null).
   What *is* enforced: a valid Clerk session, one target per call, a hard page ceiling and a hard
   per-run dollar cap. Residual risk — a signed-in user could spam preview runs before completing
   setup, at up to the per-run cap each — is accepted for now and flagged for Phase 4 (a per-user
   discovery ledger). The alternative, "discover only after setup finishes", was rejected because it
   does not match the brief and puts the result somewhere the user is not looking.
3. **Only four platforms are persisted.** `social-scan` scrapes Instagram, TikTok, Facebook and X. A
   YouTube or LinkedIn row would sit in Social presence with zero metrics forever and be reported as
   "skipped" on every scan. Showing them as unmonitored is honest; storing them is noise. If
   LinkedIn monitoring is wanted later it is a new actor and a new phase, not a new column.
4. **The actor returns personal data we must not keep.** `leadsEnrichment` (names, job titles, work
   emails, mobile numbers, LinkedIn profiles of *individual employees*) is on by default in the
   actor's output and is governed by GDPR. The input keeps `maximumLeadsEnrichmentRecords` at its
   default of `0`, and the normaliser drops everything except social profile URLs — so personal data
   never reaches Postgres (§6.3).

**Demo mode:** `web-contacts-scan` is never invoked. `sampleSocialSuggestions(website)` returns a
deterministic, plausible set (including one unmonitorable platform, so the "found, not monitored" path
is exercised in the demo), and the accept flow works end to end offline.

**Acceptance criteria**

- ⏳ **Deployed; live read proven; live click-through deferred.** Against the actor, this is proven: Phase 0's
  run is the saved fixture, and `tests/contacts.test.tsx` asserts the bare handles, the `twitters` → `x`
  mapping and `monitorable` for the four supported platforms come back from real actor output. What
  needs a real Clerk session and tenant — the button returning those profiles in the running app, and
  the resulting `competitor_social` row — is deferred to the Phase 4 live pass, exactly as Phase 2's
  read-back was.
- ✅ Running discovery twice does not duplicate rows: the write is the same upsert on
  `competitor_social`'s unique index Phases 1 and 2 ship, and a `manual` row wins because accepted
  handles carry `source` per row rather than per call.
- ✅ With no socials on the site, the UI says so and writes nothing: the checklist's empty branch reads
  "Nothing we can monitor was found on their site — add their handles by hand instead", and a scrape
  that ran and found nothing records `contacts_status = 'done'`, not `failed`.
- ✅ A run that outlives the wait returns `status: "running"` + `runId`, kept on
  `competitors.contacts_run_id` (stored mode) or handed back for the next call (preview); collecting it
  later produces the same result and the cost is logged **once**, at collection.
- ✅ Budget: `affordableCharge()` reads the workspace's Apify spend first and refuses with
  `spendMessage` when what is left is under the actor's floor — an unaffordable run never starts, and
  the refusal names the floor rather than a cap it cannot trim to.
- ✅ **Deviation:** with `APIFY_CONTACTS_ACTOR_ID` blank the function returns
  `status: "unavailable"` with its reason, and both surfaces show that reason — but the button is
  enabled until pressed rather than pre-disabled. Rendering it unavailable up front needs the client to
  know which actor id the server holds, and the only config channel is `integrations-status`, which
  reports providers rather than actor ids. The behaviour the criterion is protecting — it does not
  error and it does not invent an id — holds.
- ✅ With an invalid actor id it fails cleanly: `startRun` classifies the provider's response, so a
  `404`-derived configuration message reaches the surface instead of a 500.
- ✅ Demo mode: the whole flow works with no keys at all, and neither function is ever reached —
  asserted with a `fetch` that throws if called.
- ✅ Tests: `tests/contacts.test.tsx` — 15 cases importing `normaliseContacts` from
  `../supabase/functions/_shared/contacts` (exactly how `tests/social.test.tsx` imports
  `_shared/apify.ts`), asserting against the **saved live fixture**: bare handles, the `twitters` → `x`
  mapping, `monitorable` for the four supported platforms and false for the rest, garbage/relative URLs
  and bare domains ignored, emails/phones/leads absent from the output, plus the input shape, the caps
  and `scrapeUrl`. The demo-mode half lives in the pages' own suites
  (`tests/app.test.tsx`, `tests/onboarding.test.tsx`) rather than here — see the deviation note in the
  status block.

**Risks**

- **Cost.** `$0.002` per page + `$0.005` per GB of actor start (≈4 GB default), so a 5-page run is on
  the order of a few cents — but it is a `PAY_PER_EVENT` actor, so `APIFY_MAX_ITEMS` does not bound it.
  The page ceiling and the dollar cap are load-bearing; the actor also requires a `maxTotalChargeUsd`
  of at least `$0.50`, which is **2× the current global per-run cap** and must be its own setting.
- **Actor drift.** Community actors rename output fields (this project has already had to fix G2's
  `starRating`, Capterra's `overallRating`, Yelp's `reviewEncid` and X's `replyCount` after live smoke
  tests). The Phase 0 fixture plus a tolerant normaliser is the mitigation, not a guarantee.
- **Bot walls.** Some competitor sites will block the crawler or need JavaScript. Keep `useBrowser`
  off (it is a paid extra and slower) and let the UI say "we could not read their site — add the
  handles by hand", which is the graceful path, not a failure.

---

### Phase 4 — Hardening, cost control, rollout

> **Status: complete (live pass outstanding).** Migration `0020_contacts_discovery_runs.sql` is applied
> on the live project in the same order this phase asked for — migration, then `web-contacts-scan`
> (v2) and `integrations-status` (v10), then the client — so no build ever called a function that did
> not exist. Preview discovery is now bounded per signed-in user, a stored read is claimed in the
> database before anything is spent, and a read taken moments ago is replayed instead of re-billed.
> `npm run typecheck` clean, 165 tests pass (154 + 11), build succeeds.
>
> **Fixed while hardening, not only hardened:** collection used to trust the `runId` in the request
> body, so a leaked run id was enough to read another account's proposals. Runs are now resolved from
> the ledger by `run_id` **and** `user_id`, and an unknown or foreign run gets the same `404` — a
> distinguishable `403` would confirm that a guessed id exists.
>
> **And one dead end closed:** a stored-mode run whose Apify id no longer resolves (expired or
> deleted) used to leave `contacts_run_id` set forever, so every later press failed *and* the ledger's
> one-live-run index refused every new claim for that competitor. A provider `404` is now read as
> "gone": both pointers are cleared and the read proceeds afresh. A *transient* failure stays an
> error, deliberately — clearing the pointer there would start a second run for pages already being
> paid for. Retrying costs nothing; a second run costs money.
>
> **The handler is now covered by tests, not only by argument.** `tests/contacts-gateway.test.tsx`
> drives the real handler end to end with only two things faked — Clerk's identity check and Postgres —
> so the quota, the replay window, the double-click claim, the gone-run clearing and the cross-account
> refusal all execute as shipped code. Each was then mutation-tested: reverting the fix makes the
> matching test fail (`200 to be 404`, `undefined to be 'done'`, `undefined to be true`, `2 to be 1`).
>
> **Still outstanding:** the browser click-through (`LIVE_TEST_PLAN.md` §4.1–§4.3, §11, §14) — Clerk's
> own token verification, the button/badge copy, the real actor against a real site, and the real indexes.

**Objective:** make the new surfaces safe to leave running, and honest about money.

> **Carried in from Phase 3, so Phase 4 does not lose them:** run the live click-through the Phase 3
> acceptance criteria defer — the cost of it lands in the monthly Apify allowance, so it is worth doing
> once a real workspace exists. The per-user ledger that closes preview mode's gap is below, and is
> done; the deploy and the secrets are done.

**Deliverables**

1. ✅ **Per-user discovery ledger** closing Phase 3 decision 2. `0020_contacts_discovery_runs.sql` is
   a table, not a key store, because the deliverable needs three different reads: a count per user per
   hour (the allowance), the latest finished row per competitor (the reuse window) and a lookup by
   `run_id` (collection). Every run is keyed to the Clerk user who started it — the one identity that
   exists in preview mode — with `business_id` set as well whenever the caller already owns a
   workspace, so their spend lands in that workspace's allowance rather than nowhere. A preview run
   therefore gets **two** bounds, not one: the per-user hourly cap and, once a workspace exists, the
   monthly Apify cap as usual. RLS is on with no policies, matching `integration_idempotency`.
2. ✅ **Idempotency** on stored-mode discovery, in two layers rather than one. A partial unique index
   allows at most one live stored run per competitor, so two concurrent clicks race on the database
   and exactly one starts a run — the loser collects the winner's instead of buying a second one.
   `contacts_status` alone could not do this, because it is written *after* the run starts and both
   requests read `idle`. Above that, a finish within `APIFY_CONTACTS_REUSE_WINDOW_MINUTES` (default 2)
   is replayed from the ledger with `cached: true` and no charge, and `force: true` skips the replay.
   The cadence idea from `social-scan` was deliberately **not** reused: a cadence answers "is this
   due?", and a click is a different question — a cadence would either block a legitimate re-read or
   allow a double-click, depending on the window.
3. ✅ **Observability:** the outcome is on the competitor (`contacts_status`, `contacts_scanned_at`,
   `contacts_error`) **and** on the ledger row (status, suggestions, `suggestion_count`, `cost_usd`,
   `error`), and `api_usage_log.endpoint` distinguishes `contacts:preview` from `contacts:stored`.
   Spend is logged exactly once, at collection, for stored, preview and collected runs alike.
4. ✅ **Integrations panel:** a blank `APIFY_CONTACTS_ACTOR_ID` now reports itself as a named
   feature that is off — "Website social discovery is off — add APIFY_CONTACTS_ACTOR_ID to switch it
   on" — under the apify provider, which still reads **Configured** because social monitoring works
   with `APIFY_TOKEN` alone. Folding the actor id into Apify's required keys would have reported the
   whole provider as broken when one capability was off, which is the opposite of the point.
5. ✅ **Docs:** `env.example` (eight `APIFY_CONTACTS_*` vars now, §8); `supabase/functions/README.md`
   (layout, secrets, deploy list, rules); `README.md`; §2.1 of `docs/API_INTEGRATION_BLUEPRINT.md`;
   and `LIVE_TEST_PLAN.md` §4.6–§4.7 rewritten around the new behaviours.
6. ✅ **Rollout:** migration `0019` applied, `web-contacts-scan` deployed, then the client; and this
   phase's `0020` in the same order — file applied and verified, functions redeployed, client last.
   The migration was re-applied verbatim afterwards and the schema fingerprint was unchanged, so it is
   genuinely re-runnable rather than only written to be.

**Acceptance criteria**

- ✅ `npm run typecheck` clean, **165** tests pass (154 + 11), `npm run build` succeeds.
- ✅ Every new variable documented in `env.example` and set on remote (all eight `APIFY_CONTACTS_*`,
  checked back from the Management API); `env.example` holds no key *values*, and `.env.local` is
  gitignored, so nothing sensitive is stageable.
- ✅ `web-contacts-scan` (v2) and `integrations-status` (v10) both deployed `ACTIVE` with
  `--no-verify-jwt`, so source and deployment agree; an unauthenticated POST is still
  `401 {"error":"Missing bearer token."}`.
- ✅ The ledger's tenant isolation was verified against the live project rather than assumed: with the
  anon key, `select` returns `[]` and `insert` is refused with `42501`.
- ✅ **Proven, but at the wrong layer to claim the click-through.** 14 tests drive the real handler
  against a faked DB and a faked Apify HTTP API, asserting the database state and the charge after
  each run — the quota refusal, the replay, the claim race, the gone-run release, the cross-account
  `404` and the tenant-ownership `403`. That covers the server-side acceptance criteria; it does not
  cover Clerk's verification, the UI copy or the live actor.
- ⏳ One end-to-end live pass, written into `LIVE_TEST_PLAN.md` (`§2` then `§4.1` → `§4.4`) but **not
  yet run**: onboarding →
  enter a competitor with a real site → discover → accept → Competition → Social presence shows it →
  `social-scan` reports it as a target rather than "nothing to do". Only the layer tests cannot reach:
  a real session, a real session token, a real site and the deployed indexes.

---

## 6. Cross-cutting concerns

### 6.1 Idempotency and retries

`_shared/apify.ts` already retries the *start* call once and never retries the *wait* (a retry would
wait all over again) — keep that. Discovery inherits it by using `startRun`/`waitForRun`. One run id
per competitor, stored on the row, is what makes collection-once possible; without it a slow run would
be re-scraped and re-billed.

### 6.2 Cost control

| Layer | Mechanism | Where |
| --- | --- | --- |
| Per run | `maxTotalChargeUsd` (≥ $0.50 for this actor) + `maxRequests` page ceiling | `web-contacts-scan` |
| Per workspace / month | `readSpend` + `spendMessage` on the apify cap, `APIFY_MONTHLY_CHARGE_USD` | `_shared/budget.ts` |
| Per invocation | one target | `web-contacts-scan` |
| Per preview user / hour | `APIFY_CONTACTS_PREVIEW_MAX_PER_HOUR`, counted from `contacts_discovery_runs` | `web-contacts-scan` (Phase 4) |
| Per competitor / click | the reuse window, plus a unique index allowing one live stored run | `0020_contacts_discovery_runs.sql` (Phase 4) |
| Per actor | actor id is a secret, so an expensive actor can be swapped out without a release | `env.example` |

Note the trap this project has already hit: `maxTotalChargeUsd` caps **every** pricing model, which is
why a low cap silently *blocks* a monthly-rental actor. This actor is `PAY_PER_EVENT`, so it is the
opposite problem — the cap must be *at least* the actor's published `minimalMaxTotalChargeUsd`. Also
note `APIFY_MONTHLY_CHARGE_USD` is a **per-workspace** cap read from `api_usage_log`: tenants sharing
one Apify account each get that much, so the total must stay inside the plan's own ceiling (the project
account is on Free, $5.00/month).

### 6.3 Security and privacy

- Secrets remain server-side; the client only ever knows whether discovery is *available*.
- `assertBusinessOwned` runs before every stored-mode write, so one tenant cannot scrape another's
  competitor or read their state.
- **Personal data is not stored.** The actor can return employee names, emails, mobile numbers and
  LinkedIn profiles (`leadsEnrichment`). We disable lead enrichment and drop everything but social
  profile URLs in the normaliser. This is a deliberate compliance boundary, not an oversight.
- Roles are unchanged: `social-scan` and `web-contacts-scan` write with the service role.

### 6.4 Demo mode

Every new action and both new UI surfaces work from `src/data/` with no keys: canned suggestions
(including one unmonitorable platform), in-memory add/edit/remove of sample competitors and suppliers,
and no gateway call at all. This is the same parity rule the existing blueprint sets for every phase.

### 6.5 Keeping one source of truth

`competitor_social` remains the **only** place a monitored handle is declared — the rule established in
`0016_competitor_social_handles.sql`. Onboarding entry, discovery and the Competition page all write
that one table through `saveCompetitorSocialHandles`/`saveCompetitorSocialHandle`. Nothing new is
introduced that a future reader would have to find twice.

---

## 7. UI surfaces summary

| Surface | Change |
| --- | --- |
| Onboarding step 3 (Competitors) | Per competitor: **Add their social profiles** (manual) and **Find them automatically** (discovery, collapsed) |
| Onboarding step 5 (Confirm) | Row showing how many social profiles were recorded |
| Competition — Watching card | **Add competitor**; **Edit** / **Remove** for the active one |
| Competition — empty state | Gains the Add button (today it is a dead end) |
| Competition — Social presence | **Find socials from their site**; last-checked line; `source` badge; "found, not monitored" list |
| Suppliers — Watching card | **Add supplier**; per-supplier **Edit** / **Remove** |
| Suppliers — empty state and stats | Add button; "Suppliers monitored" reflects adds/removes |
| Integrations panel | `web-contacts-scan` reported under apify, "Not configured" when the actor id is blank |

---

## 8. Environment and secrets

Added to `env.example` (and set as Supabase Edge Function secrets). `APIFY_TOKEN` is reused — the
`apify` provider slot in `_shared/providers.ts` already requires it, so no provider plumbing changes.

```bash
# Competitor website contact discovery — reads a competitor's OWN website and
# proposes the social profiles it mentions. Separate from the per-platform social
# actors above: this one is pointed at a website, not a profile.
#
# Leave blank and the feature reports itself unavailable (never guessed at).
# Recommended: vdrmota/contact-info-scraper ($0.002/page + $0.005 per GB start,
# PAY_PER_EVENT). NOTE: that actor publishes minimalMaxTotalChargeUsd = 0.5, so
# it refuses a run with a lower cap — it can NOT run under APIFY_MAX_CHARGE_USD=0.25.
APIFY_CONTACTS_ACTOR_ID=9Sk4JJhEma9vBKqrg

# Hard ceiling for one discovery run, in dollars. Must be at least the actor's
# own minimum ($0.50 today), which is why it is its own setting.
APIFY_CONTACTS_MAX_CHARGE_USD=0.5

# Hard page ceiling. The real cost guard for a PAY_PER_EVENT actor: APIFY_MAX_ITEMS
# does not bound it. 5 pages ≈ $0.01 of pages + ~$0.02 of actor start.
APIFY_CONTACTS_MAX_PAGES=5

# 1 = the start URL plus one hop (usually /contact or /about). Keep it small.
APIFY_CONTACTS_MAX_DEPTH=1

# Apify's own kill switch for a discovery run, in seconds.
APIFY_CONTACTS_RUN_TIMEOUT_SECS=120

# Leave OFF. Enabling enrichment bills each discovered profile as a separate
# event; enabling the browser (+$0.003/page) or a residential proxy (+$0.002/page)
# bills every page twice. None is needed to read a footer.
APIFY_CONTACTS_ENRICH_PROFILES=false

# Phase 4. Preview discovery is the one path with no workspace to bill —
# onboarding runs before the business row exists — so its allowance is per
# signed-in user, counted from `contacts_discovery_runs`. 10/hour is generous for
# setup and still bounds a scripted loop. Not a secret that reveals anything: it
# is a number, and the count itself is per user.
APIFY_CONTACTS_PREVIEW_MAX_PER_HOUR=10

# A stored read is replayed rather than repeated inside this window, so pressing
# "Find socials from their site" twice — or reloading the page — cannot buy the
# same pages twice. 0 disables reuse: every click pays for a fresh read.
APIFY_CONTACTS_REUSE_WINDOW_MINUTES=2
```

No `VITE_` variable is added — nothing about this is browser-side.

---

## 9. Phase dependency graph

```
Phase 0  (actor gate + 0019 + repo layer)          ← blocked on the actor decision
   │
   ├──────────────► Phase 1  (manage competitors & suppliers)   ← ships F1 on its own
   │
   └──────────────► Phase 2  (onboarding: manual socials)
                        │
                        └────► Phase 3  (discovery)   ← needs Phase 0 + Phase 2's state shape
                                   │
                                   └────► Phase 4  (hardening, docs, rollout)
```

Phase 1 does not depend on the actor at all and can ship first if the actor question stays open.
Phase 3 is the only phase gated on it.

---

## 10. Definition of done

Both capabilities are done when:

1. **F1** — a user can add, edit and remove competitors from Competition and suppliers from Suppliers,
   with a confirm step that states the cascade, and demo mode does the same in memory.
2. **F2** — at onboarding a competitor's socials can be typed by hand **or** discovered from their own
   website, both landing in `competitor_social` with correct provenance, and both re-runnable later
   from Competition → Social presence.
3. `social-scan` picks the discovered handles up as targets with no extra step (its contract: it
   scrapes exactly the rows in `competitor_social`).
4. Discovery never writes without a human accepting, never stores personal data, never invents an
   actor id, and always enforces its page and dollar ceilings.
5. Migration applied, function deployed and ACTIVE, secrets documented in `env.example`, typecheck
   clean, full test suite green, production build succeeds.
6. The live pass from Phase 4 is recorded in `LIVE_TEST_PLAN.md`.

---

## Appendix A — Actor verification record

Checked against the live Apify API with this project's account token.

| Actor id | `GET /v2/acts/{id}` | Owner / name | Pricing | Verdict |
| --- | --- | --- | --- | --- |
| `KHpwuGIjj9pFfR5c` *(as supplied)* | **404 `record-or-token-not-found`** (also 404 anonymously, and 404 as a task/actor-task) | — | — | **Unusable** |
| `9Sk4JJhEma9vBKqrg` | 200 | `vdrmota` / **contact-info-scraper** ("Contact Details Scraper") | `PAY_PER_EVENT`: `$0.002`/page (primary), `$0.005`/GB actor start, `+$0.002` residential-proxy page, `+$0.003` browser page, `+$0.001` enriched social profile. `minimalMaxTotalChargeUsd: 0.5` | **Recommended** — 60,783 users, 13.0M runs, 4.7★ (92 reviews), 203k successful runs in 30 days |
| `LLJe5v9uwVDOwx3yG` | 200 | `logiover` / **website-contact-scraper** ("Website Contact Scraper – Email, Phone & Social") | pay per result/event | Viable alternative — smaller (1,056 users) |
| `zlwDmlOpbBnMkEbwR` | 200 | `automation-lab` / **website-contact-finder** | pay per event (`start`, `page-crawled`) | Viable alternative (1,194 users) |

Also seen on the Store but not evaluated in depth: `betterdevsscrape/contact-details-extractor`
(`8CUaIL6Ck8d7gDbck`), `purple_beep_boop/bulk-website-contact-scraper` (`YFzFZvHoJxZUZwE7e`),
`nexgendata/contact-info-scraper`, `caprolok/website-email-phone-finder`.

**Action for you:** open the actor you intended in the Apify console and copy the id from its URL
(`console.apify.com/actors/<id>`), or confirm that `9Sk4JJhEma9vBKqrg` is an acceptable substitute.

## Appendix B — Contact-details actor output → our platform map

Taken from `vdrmota/contact-info-scraper`'s live output example and input schema. Confirms this is the
right shape for our four monitorable platforms, and that the id must be re-verified in Phase 0.

**Dataset item (per start URL, `mergeContacts: true`):**

```jsonc
{
  "originalStartUrl": "https://competitor.com",
  "domain": "competitor.com",
  "scrapedUrls": ["https://competitor.com/contact", "https://competitor.com/"],
  "emails": ["hello@competitor.com"],          // DISCARD
  "phones": [],                                 // DISCARD
  "phonesUncertain": ["..."],                   // DISCARD
  "leadsEnrichment": [ { "fullName": "…", "email": "…", "linkedinProfile": "…" } ], // DISCARD (personal data)
  "instagrams":     ["https://www.instagram.com/competitor/"],   // → platform "instagram"
  "tiktoks":        ["https://www.tiktok.com/@competitor"],      // → platform "tiktok"
  "facebooks":      ["https://www.facebook.com/competitor/"],    // → platform "facebook"
  "twitters":       ["https://x.com/competitor"],                // → platform "x"   (name differs!)
  "youtubes":       ["https://www.youtube.com/@competitor"],     // → unmonitored
  "linkedIns":      ["https://www.linkedin.com/company/…"],      // → unmonitored
  "threads": [], "snapchats": [], "telegrams": [], "reddits": [],
  "discords": [], "pinterests": [], "whatsapps": []
}
```

**Input schema (required fields marked):** `startUrls` **(required, array)**, `proxyConfig`
**(required, object — default `{"useApifyProxy": true}`)**, `maxRequestsPerStartUrl`, `mergeContacts`
(default `true`), `maxDepth`, `maxRequests`, `sameDomain` (default `true`), `considerChildFrames`
(default `true`), `maximumLeadsEnrichmentRecords` (default `0` — **keep**), `leadsEnrichmentDepartments`,
`verifyLeadsEnrichmentEmails`, `scrapeSocialMediaProfiles` (object; `facebooks`, `instagrams`,
`youtubes`, `tiktoks`, `twitters`, all default `false` — **keep off**), `useBrowser` (default `false`),
`waitUntil` (default `domcontentloaded`).

Two things worth flagging: the field names are **plural arrays of URLs** (so the normaliser's job is
handle extraction, not field guessing), and the X field is `twitters`, not `x` or `twitter` — the one
mapping that will otherwise silently produce nothing.

## Appendix C — Decisions needed from you

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| 1 | **Which actor?** `KHpwuGIjj9pFfR5c` does not exist (Appendix A). | (a) send a corrected id; (b) `vdrmota/contact-info-scraper` `9Sk4JJhEma9vBKqrg`; (c) `logiover/website-contact-scraper` `LLJe5v9uwVDOwx3yG`; (d) another actor you name | ✅ **Decided: (b)** — most proven, explicitly extracts all four platforms we can monitor, `PAY_PER_EVENT` so it fits the Free plan's $5 ceiling |
| 2 | **Accept a suggestion or auto-apply it?** Every accepted handle becomes a billed scrape target and may be a footer link to the competitor's web agency. | (a) propose → user accepts; (b) auto-write everything found | **(a)** — the reading is automatic as asked; the *writing* stays deliberate |
| 3 | **Remove = hard delete or archive?** Deleting a competitor cascades its history. | (a) hard delete + a confirm that names the collateral (no migration); (b) `archived_at` soft delete (migration `0022` — `0020` went to the discovery ledger and `0021` to the site-scan columns — more read-path changes) | **(a)** for now, (b) reserved |
| 4 | **Enrich social profiles?** The actor can pull follower counts etc. at `+$0.001` per profile. | (a) off; (b) on | **(a)** — `social-scan` already measures followers and engagement properly, from the platform itself |
