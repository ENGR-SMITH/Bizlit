# Live test plan — the whole product, end to end

A hands-on checklist for exercising **everything** this repo ships against the **live** Supabase
project, in the order that costs least and depends on least.

[`docs/API_INTEGRATION_BLUEPRINT.md`](docs/API_INTEGRATION_BLUEPRINT.md) (the provider gateway, Phases
0–5) and [`docs/SOURCE_MANAGEMENT_BLUEPRINT.md`](docs/SOURCE_MANAGEMENT_BLUEPRINT.md) (sources and
competitor discovery, Phases 0–4) are both deployed. This document is how to prove that from the app
and from the database, rather than from a test suite.

**Read §2.4 before you start.** A lot of what used to be manual is now covered by `npm test`, and
this plan deliberately does not re-prove it — the checks below are the layer the suite cannot reach.

---

## 1. What is deployed

Verify this first, so a failure during testing is a real failure:

```bash
npx supabase functions list                       # every function should be ACTIVE
npx supabase migration list --linked              # 0001 … 0021, all applied
npx supabase secrets list                         # names only; values are never printed
```

| Piece | What it is |
| --- | --- |
| 15 gateway functions | `serp-scan`, `serp-competitors`, `keyword-ideas`, `social-scan`, `web-contacts-scan`, `site-scan`, `traffic-scan`, `ads-scan`, `reviews-sync`, `review-reply`, `ai-draft`, `publish-ad`, `social-accounts`, `provider-webhook`, `integrations-status` |
| 17 migrations | `0008`–`0024` (integration foundation → competitor discovery → its run ledger → site-scan change columns → the business search-visibility columns → the traffic and ads scan source types) |
| 5 providers | SerpApi, Apify, Reviews (via the two above), AI drafting (Groq), Mallary.ai |
| 8 discovery secrets | `APIFY_CONTACTS_ACTOR_ID`, `…_MAX_CHARGE_USD`, `…_MAX_PAGES`, `…_MAX_DEPTH`, `…_RUN_TIMEOUT_SECS`, `…_ENRICH_PROFILES`, `…_PREVIEW_MAX_PER_HOUR`, `…_REUSE_WINDOW_MINUTES` |
| 5 site-scan secrets | `APIFY_SITE_ACTOR_ID` — **required**, and the one that decides whether these pages work at all: it must be a product-catalogue actor, because the contacts crawler returns no product rows and no page JSON-LD, so a catalogue read through it reports `succeeded` and writes 0 rows. Plus `APIFY_SITE_MAX_PAGES`, `APIFY_SITE_MAX_CHARGE_USD`, `APIFY_SITE_RUN_TIMEOUT_SECS`, `APIFY_SITE_MAX_ITEMS`, which all have working defaults |
| 2 traffic secrets | `APIFY_TRAFFIC_ACTOR_ID` — **required** for the traffic panels on My Business and Competition, which nothing else can fill. Plus `APIFY_TRAFFIC_MAX_CHARGE_USD`, `APIFY_TRAFFIC_MAX_DOMAINS`, `APIFY_TRAFFIC_RUN_TIMEOUT_SECS` |
| 2 ads secrets | `APIFY_ADS_ACTOR_ID` — **required** for Competition's *Active ad campaigns* tile. Plus `APIFY_ADS_MAX_CHARGE_USD`, `APIFY_ADS_RESULTS_LIMIT`, `APIFY_ADS_MAX_TARGETS`, `APIFY_ADS_RUN_TIMEOUT_SECS` |

**No provider key ever reaches the browser.** The app calls a gateway function; the function holds the
key, makes the call server-side, and writes to a tenant-scoped table.

### Is the deployment the code you are reading?

Version numbers only tell you *something* was deployed. This tells you *what*:

```bash
set -a; . ./.env.local; set +a
cp supabase/functions/web-contacts-scan/index.ts /tmp/wcs.bak
npx supabase functions download web-contacts-scan --use-api --project-ref "$SUPABASE_PROJECT_REF"
diff /tmp/wcs.bak supabase/functions/web-contacts-scan/index.ts && echo "IDENTICAL — the deployment is the working tree"
cp /tmp/wcs.bak supabase/functions/web-contacts-scan/index.ts    # restore
```

- [ ] **The diff is empty.** On 2026-09-28 it was byte-identical, `_shared/` included — which is also
      how to catch a deploy that was forgotten after a code change.

> **Careful:** `functions download` also rewrites every file under `supabase/functions/_shared/`, not
> just the one function. Back up first, as above, and restore afterwards — otherwise you have quietly
> replaced your working tree with the deployed copy.

Every function is deployed with `--no-verify-jwt` **on purpose**: the bearer token is a Clerk token,
which the platform cannot verify, so each function verifies it itself (§11 checks this).

---

## 2. Before you start

### 2.1 You are in live mode, and the workspace starts near-empty

The app shows your **real** workspace. Demo data only appears when Clerk is *not* configured, so if you
see sample competitors called GlowMart and TecWave after signing in, something is wrong — check
`VITE_CLERK_PUBLISHABLE_KEY` in `.env.local`.

Empty states are correct, not broken: every monitoring feature needs its first scan. At the time of
writing: `businesses` 1, `competitors` 7, and `my_reviews` / `social_posts` / `keyword_ideas` /
`competitor_social` / `api_usage_log` all 0.

That is why the order below matters — set up and scan first (§4–6), then exercise the AI on real
material (§8).

### 2.2 Start the app

```bash
npm run dev
```

In GitHub Codespaces, open the forwarded port 5173 rather than localhost:

- Direct link: `https://<CODESPACE_NAME>-5173.app.github.dev` (`echo $CODESPACE_NAME`)
- Or VS Code → **Ports** → **5173** → the globe icon

Sign in with Clerk. The instance uses a development key (`pk_test_`), so the codespace domain is
accepted without adding allowed origins.

### 2.3 The helpers

Most checks need one of these four things. Put the `sql()` function in your shell once — several
sections below assume it exists.

```bash
# 1. Run one SQL query against the live project, with values never echoed to a file.
sql() {
  set -a; . ./.env.local; set +a
  curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
    -d "{\"query\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1")}"
}

# 2. The project ref and your Clerk token, for the curl recipes.
set -a; . ./.env.local; set +a
echo "$SUPABASE_PROJECT_REF"
```

**Your Clerk session token** — two ways, both fine:

- **Network tab (reliable):** DevTools → Network → filter `functions/v1` → click any request →
  **Request headers** → copy the whole `Authorization` value (including `Bearer`).
- **Console (quicker):** `await window.Clerk.session.getToken()`.

A token is short-lived. If a curl returns `401 Invalid or expired session token`, refresh it.

**Resetting anything a check changes** is §12. Everything the pass mutates, that section puts back.

### 2.4 What `npm test` already proves — do not pay to re-prove it

`npm test` runs **242 tests across 14 files** with no session, no tenant and no provider account:

| Test file | Tests | What it proves |
| --- | --- | --- |
| `tests/contacts.test.tsx` | 21 | The actor normaliser against the **live fixture**: bare handles, the `twitters` → `x` mapping, which platforms are monitorable, the input shape, the caps, and that emails/phones/`leadsEnrichment` cannot appear in the output. |
| `tests/contacts-gateway.test.tsx` | 14 | The **real handler**, end to end, with only Clerk and Postgres faked: the preview quota, the replay window, the double-click claim, the gone-run release, the cross-account `404`, the tenant `403`, the no-website `409` and the unconfigured state. |
| `tests/app.test.tsx` | 30 | Every page flow in demo mode, including add/edit/remove for competitors and suppliers, the two-click confirm, and accepting a discovery result. |
| `tests/onboarding.test.tsx` | 5 | The wizard: step validation, socials typed by hand (normalisation, replace-per-platform, remove), and accepting a discovery result with the right provenance. |
| `tests/reviews.test.tsx` | 31 | Review readers, mapping, the reply gate, run state. |
| `tests/social.test.tsx` | 38 | Post normalisation, engagement maths, cadence. |
| `tests/ai.test.tsx` | 13 | Prompt building and output validation for the three drafting tasks. |
| `tests/operations.test.tsx` | 37 | Budgets, alerts, workspace health, the provider catalogue and the capped-but-feature-off line. |
| `tests/publishing.test.tsx` | 5 | Publish jobs and idempotency. |
| `tests/rankings.test.tsx` | 7 | Ranking/keyword merging. |
| `tests/seo.test.tsx` | 8 | The visibility score and standings derived from the rankings a scan just stored: banding, rich snippets, one standing per term on its best device, and a malformed position read as "not ranking" rather than position 0. |
| `tests/site.test.tsx` | 21 | The catalogue read: price/stock parsing, JSON-LD and flat-row normalising, the exact input sent to the actor (including `discoverProducts`), the actor-configuration states, and that settling a **competitor** never names a supplier-only column. |
| `tests/refresh.test.tsx` | 6 | The pull's own decisions: what it starts, that the window holds when nothing is waiting, that a crawl waiting to be collected is collected **inside** that window, and that a collection cannot push the next sweep out. |
| `tests/serp-competitors.test.tsx` | 6 | The **real benchmark handler**, end to end, with only Clerk, Postgres and SerpApi faked: share of voice, the keyword rows, one review-trend point per rival, the rerun prune staying inside its tenant, and the ratings and review counts written back onto the competitor row the pages read. |

```bash
npm test
```

Those tests were themselves mutation-tested: reverting each Phase 4 fix makes the matching test fail.
So **this plan is about the layer above them** — real Clerk, real row-level security, real actors,
real money, real UI. Where a check below is the browser half of something already covered, it says so,
and you are verifying the *wiring*, not the logic.

### 2.5 What a full pass costs

| Section | Rough cost |
| --- | --- |
| 3, 4.1–4.5, 11, 12 | **$0** — no provider call |
| 4.6–4.7 website discovery | $0.05–0.20 (each read is a few cents; the actor's floor is $0.50 per run) |
| 5 SerpApi | 1 search per scan, 4 for one "Find ideas" with intent probes |
| 6 Apify social | ~$0.12 per Instagram handle, less for other platforms |
| 7 Reviews | $0.006–0.065 per profile (Google/TripAdvisor are 1 SerpApi search) |
| 8 AI drafting | fractions of a cent per call |
| 9 Mallary | 1 post |

Under about a dollar if you run it once. The per-workspace ceilings are in §10.

---

## 3. Free checks (2 minutes, no provider spend)

- [ ] **Business profile** (top-right) opens the settings dialog
- [ ] **Integrations** lists 5 providers, including **AI drafting — configured**

      If it says "Not configured", the deployed `integrations-status` does not know about the
      provider — redeploy it: `npx supabase functions deploy integrations-status --no-verify-jwt --use-api`

- [ ] **Apify shows no amber line** under it

      Expect exactly this, and it is the cheapest possible proof that the eight `APIFY_CONTACTS_*`
      secrets reached the runtime: if the actor id were missing you would see
      *"Website social discovery is off — add APIFY_CONTACTS_ACTOR_ID to switch it on."* Check this
      **before** spending anything, because nothing in §4 will work without it.

- [ ] **One query says what every panel on the three pages should be showing.** Run this before a
      pass and after each one. A column that stays `0` is either a table with no producer (§2 note in
      `docs/API_INTEGRATION_BLUEPRINT.md`) or a scan that has not run yet — and those are different
      problems, which is the distinction the pages themselves cannot make:

      ```bash
      sql "select
        (select count(*) from suppliers) suppliers, (select count(*) from supplier_items) supplier_items,
        (select count(*) from competitors) competitors, (select count(*) from competitor_items) competitor_items,
        (select count(*) from competitor_metrics where kind='traffic') traffic_points,
        (select count(*) from competitor_metrics where kind='review_trend') review_trend,
        (select count(*) from competitor_social) comp_social, (select count(*) from social_posts) social_posts,
        (select count(*) from competitor_keywords) comp_keywords, (select count(*) from my_keywords) my_keywords,
        (select count(*) from serp_rankings) serp_rankings, (select count(*) from local_pack_rankings) local_packs,
        (select count(*) from competitor_share_of_voice) share_of_voice,
        (select count(*) from competitor_review_gap) review_gap,
        (select count(*) from competitors where rating is not null) rival_ratings"
      ```

      Expected on a workspace that has pulled once with keywords tracked: `suppliers` 3+,
      `competitors` 2+, `my_keywords` 1+, `serp_rankings` = terms × devices, `local_packs` = terms,
      `comp_keywords` = terms × rivals, `review_trend` = rivals, `share_of_voice` = rivals,
      `review_gap` = rivals, `rival_ratings` = rivals. `traffic_points`, `comp_social`, `social_posts`
      and the reviews/ads/audience tables stay 0 until their producer is built or a handle is accepted.

- [ ] **Monitoring health** reads "Nothing needs attention" on a clean workspace
- [ ] **Plan usage** is hidden until something has actually been spent (honest, not broken)
- [ ] **Notifications** (bell) opens and shows nothing actionable yet
- [ ] **Competition** and **Suppliers** both render, with a **Watching** bar and **Scan cadence** controls

---

## 4. Sources — onboarding, competitors, suppliers, discovery

The source-management surfaces. Everything here is either free or a few cents, and it is the section
that creates the data the later sections need.

### 4.1 Onboarding, end to end

Onboarding only appears when the signed-in user has **no** business row. Check first:

```bash
sql "select id, owner_user_id, name from businesses"
```

- If your account is listed, onboarding is unreachable — **use a second Clerk account** (a private
  window is enough). You need one anyway for §4.3 and §11, so make it now and keep it.
- If nothing is listed for you, `npm run dev` drops you straight into the wizard.

Then walk it:

- [ ] **Step 1 — Business:** name, industry, timezone. **Continue** stays disabled with a reason until
      the name is filled in (that inline refusal is deliberate)
- [ ] **Step 2 — Presence:** your website. A pasted path such as `https://yourstore.com/shop` is
      stored as the host
- [ ] **Step 3 — Suppliers:** one supplier, with website
- [ ] **Step 4 — Competitors:** one competitor with a **real website** (§4.6 will read it)
- [ ] **Step 5 — Clients + messaging:** optional, "Add customer" works
- [ ] **Step 6 — Confirm:** the summary shows the counts you entered, then **Finish setup**

Expect: the workspace appears with your data. Verify the rows landed:

```bash
sql "select (select count(*) from businesses) as businesses,
            (select count(*) from suppliers) as suppliers,
            (select count(*) from competitors) as competitors,
            (select count(*) from clients) as clients"
```

### 4.2 Onboarding: a competitor's socials, typed by hand

This closes the acceptance criterion Phase 2 deferred, so it is worth doing carefully.

- [ ] On **Step 4**, expand **Add their social profiles** on the competitor
- [ ] Add two platforms by hand

      Expect: a platform `<select>`, a handle field, **Add**, and a `Trash2` per saved row. Paste a
      full profile URL — `https://www.instagram.com/glowmartbeauty/` is stored as `glowmartbeauty`.
      That is not cosmetic: the gateway builds the profile URL around the stored handle, so a pasted
      URL would be embedded in another URL and the scan would quietly return nothing.

- [ ] Re-add a platform you already used, with a different handle

      Expect: it **replaces** the row (one handle per platform is the model, and the unique index
      enforces it) — the count does not go up.

- [ ] Remove one with the trash icon and confirm the count drops
- [ ] Add an unreadable handle (e.g. `not a handle!!`) → refused inline rather than saved
- [ ] **Step 6** reports **"Social profiles recorded: N"** matching what you kept
- [ ] Finish, then check the rows are real and carry their provenance:

```bash
sql "select c.name, cs.platform, cs.handle, cs.source, cs.discovered_at
     from competitor_social cs join competitors c on c.id = cs.competitor_id
     order by c.name, cs.platform"
```

Expect **one row per platform per competitor**, `source = 'manual'`, `discovered_at` null. A missing
row here means the wizard collected the handles and dropped them on the way to the database — which is
exactly what this check exists to catch.

### 4.3 Onboarding: find them automatically

Do this as the **second account**, on a competitor with a real website. It costs one read.

- [ ] **Step 4** → a competitor card → **Find them automatically** → **Read their website**

      Expect the checklist: the site it read, one row per platform with the handle pre-filled and
      **ticked**, and *"Found, not monitored: …"* for platforms with no scraper. Nothing is saved by
      the read itself.

- [ ] **Check it** opens the URL the actor found, in a new tab — confirm it is the *competitor's*
      profile and not, say, their web agency's
- [ ] Change one handle, then accept with **Add N profiles**

      Expect the changed one to be `manual` and the untouched ones `discovered` — visible in the
      confirm step's count and in SQL after you finish.

- [ ] Confirm the preview run authored nothing on the server:

```bash
sql "select mode, status, business_id, suggestion_count, round(cost_usd,4) as cost
     from contacts_discovery_runs order by created_at desc limit 3"
```

Expect one `preview` row, `status='done'`, and **`business_id` null** — there is no workspace to attach
it to yet, which is the whole reason preview mode has its own allowance. One `api_usage_log` row with
`endpoint='contacts:preview'` should accompany it.

- [ ] **Spend the preview allowance cheaply.** Raise the cap to 1 first so you buy one read instead of
      ten, then read two competitors' sites:

      ```bash
      # set APIFY_CONTACTS_PREVIEW_MAX_PER_HOUR=1 for the project, then:
      sql "select count(*) from contacts_discovery_runs where mode='preview' and user_id='<your clerk id>'"
      ```

      Expect the second read within the hour to be refused with a `429` naming the count and the
      limit. Put the cap back to 10 afterwards. Note these rows are operator-only — the app never
      reads them.

### 4.4 Competition: add, edit and remove a competitor

- [ ] **Watching** card → **Add competitor**
- [ ] Submit it empty

      Expect the dialog to **stay open** with an inline refusal naming what is missing. A dialog that
      closes on a failed save would look like a success and lose the input.

- [ ] Add one with a website containing a path (`https://theirbrand.com/collection/all`)

      Expect the stored website to be the host only:
      `sql "select name, website, cadence from competitors order by created_at desc limit 3"` — and a
      `…/shop` path must never reach the actor, which reads hosts.

- [ ] **Edit** it → the form is pre-filled (including notes) → change the name → **Save changes**
      → the pill and the header follow
- [ ] **Remove** it → the confirm **arms** on the first click (*"Remove competitor"*), and only the
      second click deletes (*"Delete permanently"*)

      Expect the copy to name the real collateral ("this also deletes 2 monitored social profiles, 3
      tracked keywords…"). **Check that against reality** — compare with
      `sql "select count(*) from competitor_social where competitor_id='<id>'"` and the same for
      `social_posts`. The dialog builds that sentence from what is on screen, so a mismatch is a bug
      in the copy, not in the delete.

- [ ] After deleting, the pills and the cascade are clean:

```bash
sql "select (select count(*) from competitor_social where competitor_id='<id>') as socials,
            (select count(*) from social_posts where competitor_id='<id>') as posts,
            (select count(*) from social_monitor_targets where competitor_id='<id>') as targets"
```

Expect 0 / 0 / 0. `competitors` itself should no longer have the row. Removing a competitor is
deliberately offering to delete its monitored handles too — one place registers a profile.

- [ ] Delete your **last** competitor and confirm the page offers a way back (an empty state with an
      **Add competitor** button), rather than a dead end.

### 4.5 Suppliers: add, edit and remove

- [ ] **Suppliers** → **Add supplier** → empty form refused inline
- [ ] Add one with a full URL including a path → stored as the host
- [ ] The **pencil** beside a pill opens the same form pre-filled → **Save changes**
- [ ] Inside that dialog, **Remove supplier** → confirm dialog → **Keep watching** first

      Expect nothing to be deleted, and the supplier to still be there.

- [ ] Re-open, **Remove supplier** → **Remove supplier** → **Delete permanently**

      Expect *"Stopped watching <name>"*. Then confirm the cascade treats the two tables differently:

```bash
sql "select (select count(*) from supplier_items where supplier_id='<id>') as detected_items,
            (select count(*) from inventory_items) as our_catalogue"
```

Expect `detected_items` 0 and `our_catalogue` **unchanged** — the confirm promises exactly that
("your catalogue and ad briefs stay"), so an empty catalogue here would be data loss.

- [ ] The **Suppliers monitored** stat follows the adds and removes.

### 4.6 Discovery from a competitor's own website (stored mode)

Cost: `$0.002`/page + `$0.005` per GB of actor start, so a 5-page read is a few cents. It is a
`PAY_PER_EVENT` actor, so `APIFY_MAX_ITEMS` does **not** bound it — `APIFY_CONTACTS_MAX_PAGES` and
`APIFY_CONTACTS_MAX_CHARGE_USD` do, and the actor refuses anything under its own `$0.50` floor, which
is why that ceiling is its own setting.

The **logic** here is covered by `tests/contacts-gateway.test.tsx` (see §2.4). What you are checking is
the browser wiring and the real actor.

**Competition → Social → Social presence**

- [ ] **Find socials from their site** on a competitor with a real website

      Expect the checklist naming the site, one row per platform, prefilled and ticked, and the
      *"Found, not monitored:"* line. Nothing is saved by the read itself.

- [ ] Change one handle before accepting, then **Save N profiles**

      Expect the badge *"found on their site"* under the `discovered` channels only, and
      `source = 'discovered'` in SQL for those — the one you edited stays `manual`.

- [ ] Untick a platform → the save button counts only what is ticked, and the unticked platform is not
      written
- [ ] Press it on a competitor whose site lists nothing → *"Nothing we can monitor was found on their
      site — add their handles by hand instead"*, no row written, and the row's state `done` rather
      than a failed status stuck on screen
- [ ] **Last checked** appears after any read, and the button reads *"Checking their site…"* while a
      run is live rather than starting a second one
- [ ] Take an accepted profile through to a scan: **Competition → Social → Scan posts now** should
      report it as a target, not "nothing to do". This is the Phase 3 criterion that a discovered
      handle is a *real* target, and it is the only check that proves discovery and scanning agree.

### 4.7 Discovery hardening — the four guarantees

These are the Phase 4 behaviours. Three of them are covered by the suite already; the point of running
them here is that the suite fakes Postgres, so this is where the **real** `0020` indexes are exercised.

- [ ] **The replay window.** Press **Find socials from their site**, then press it again immediately.

      Expect *"Reusing the read of … from a moment ago"* and **no second run bought**. Confirm:

      ```bash
      sql "select mode, status, round(cost_usd,4) as cost, suggestion_count, created_at
           from contacts_discovery_runs order by created_at desc limit 5"
      ```

      One new row, not two. *(Suite-covered; here to exercise the real index.)*

- [ ] **And that it is a window, not a cache.** Wait more than two minutes
      (`APIFY_CONTACTS_REUSE_WINDOW_MINUTES`), press again, and expect a fresh *"Read from …"*. These
      two presses together are the check — either one alone proves nothing.

- [ ] **The double-click race.** Click as fast as you can.

      Expect at most one run, and the loser reporting *"still running"* rather than starting a second
      one:

      ```bash
      # Must always return no rows. A violation locks the competitor out of discovery.
      sql "select competitor_id, count(*) from contacts_discovery_runs
           where mode='stored' and status='running' group by 1 having count(*) > 1"

      # And one charge per read, not one per attempt:
      sql "select endpoint, count(*), round(sum(cost_usd),4) as spend
           from api_usage_log where provider='apify' group by endpoint"
      ```

- [ ] **A run whose Apify id is gone is released.** The only way to reach this is a run id Apify no
      longer knows, so point the row at a bogus one:

      ```bash
      sql "update competitors set contacts_run_id='00000000-0000-0000-0000-000000000000',
                  contacts_status='running' where name='<competitor>'"
      # … now press Find socials from their site. Expect NO error in the UI.
      sql "select status, error from contacts_discovery_runs order by created_at desc limit 2"
      sql "select contacts_status, contacts_run_id from competitors where name='<competitor>'"
      ```

      Expect the abandoned ledger row to read **`failed`, not `running`** — that release is what lets
      the next claim through, and it is the difference between a bad minute and a competitor that can
      never be read again. The second query should show a fresh `done` and an empty run id.

- [ ] **Unset the actor id** and press the button again

      Expect *"Website discovery is not available on this deployment…"* — a configuration state, not
      an error, and never a guessed actor id. Meanwhile **Business settings → Integrations → Apify**
      should still read **Configured** (social monitoring is unaffected) with the amber line naming
      what is off. Restore the secret and confirm the line disappears — no redeploy is needed,
      `Deno.env` is read per invocation.

- [ ] **A competitor with no website** → a `409` naming it. The form validates the website, so force
      the state rather than trying to type it:

      ```bash
      sql "update competitors set website='' where name='<competitor>'"
      # … press the button, then put it back:
      sql "update competitors set website='https://<their site>' where name='<competitor>'"
      ```

### 4.8 Catalogue scans — suppliers and competitors (`site-scan`)

This is what the shared pull-to-refresh gesture runs, and the only thing that writes
`supplier_items` / `competitor_items`. Both pages are served by one actor, `APIFY_SITE_ACTOR_ID`, because
a supplier and a competitor are the same thing to this read — a business with a website. It has to be a
**product-catalogue** actor, run with `discoverProducts`: the contacts crawler reads contact details, so
pointing this read at it bills every source, reports every scan `succeeded`, and writes no rows at all.
Do this once with a catalogue actor set, once with the slot empty, and once with no actor id at all.

- [ ] **Configured (the normal state)** → set `APIFY_SITE_ACTOR_ID` to a product-catalogue actor, pull
      down on Suppliers, and expect *"N of M site scans ran"*. Then confirm each source moved **and
      that rows landed** — a scan reporting success is not the same as a catalogue arriving:

      ```bash
      sql "select name, last_scan_at, next_scan_at, site_scan_at, site_error, site_run_id
           from suppliers order by site_scan_at desc nulls last limit 5"
      sql "select change, count(*) from supplier_items group by change order by 2 desc"
      sql "select endpoint, units, cost_usd from api_usage_log where provider='apify'
           and endpoint like 'site:%' order by created_at desc limit 10"
      ```

- [ ] **Misconfigured — the failure that hides.** This is the check worth doing, because nothing else
      reports it: clear `APIFY_SITE_ACTOR_ID` but leave `APIFY_CONTACTS_ACTOR_ID` set, pull down, and
      expect the scans to report **succeeded with 0 changes**, the usage rows above to still land (the
      run is being billed), and `supplier_items` to stay **empty**. The Integrations panel should be
      showing *"Website catalogue reading is off — add APIFY_SITE_ACTOR_ID to switch it on."* If the
      panel says nothing while the catalogue is empty, that is the bug this line fixes. Put
      `APIFY_SITE_ACTOR_ID` back.
- [ ] **Not configured** → clear `APIFY_SITE_ACTOR_ID` *and* `APIFY_CONTACTS_ACTOR_ID` (the read uses
      whichever is present, so leaving the crawler set means it *is* configured), pull down on
      Suppliers, and expect the toast to report the site scans as **not run** rather than failed. No run
      is started, so `sql "select count(*) from scan_runs where source_type='supplier' and created_at > now() - interval '5 minutes'"`
      stays at 0. Put `APIFY_CONTACTS_ACTOR_ID` back — competitor discovery is off without it.

- [ ] **A second pull finds only what moved.** Pull again after the window
      (`PULL_REFRESH_INTERVAL_MS`, 10 minutes — or clear
      `localStorage['workspace:pull-refresh-at']`) and expect `changes` to be 0 or small — **not** the
      whole catalogue again. A product re-read unchanged must not appear as `new_product`:

      ```bash
      sql "select product, count(*) from supplier_items group by product having count(*) > 1
           order by 2 desc limit 10"
      ```

      One row per real change is right; the same row per scan is the bug this replaced.
- [ ] **A crawl that outlives the wait** reports *"still running"* rather than a result, and the *next*
      pull collects it. `site_run_id` is set on the row in between, and collection is what writes
      `site_scan_at` and the usage row — the cost lands once, never twice:

      ```bash
      sql "select source_id, cost_usd, created_at from api_usage_log
           where endpoint like 'site:%' order by created_at desc limit 5"
      ```

      That next pull is **not blocked by the pull cap**, and must not be: the crawl has already been
      billed, and the cap exists to stop the *sweep* re-running, not to hide a dataset the user paid
      for. Pull straight after the one that said "still running" and expect a `Collected — N of M
      waiting catalogue reads collected` toast — with the three live scans **not** re-run. Confirm the
      stamp was left alone, so the sweep is still due when it was:

      ```bash
      # in the browser console, before and after that pull — must not change
      localStorage.getItem('workspace:pull-refresh-at')
      ```

- [ ] **The cap still holds when nothing is waiting.** With `sql "select name from suppliers where
      site_run_id is not null"` and the same for `competitors` both empty, pull inside the window and
      expect the plain *"Already up to date"* toast, no `api_usage_log` row, and no new `scan_runs` row.

- [ ] **Competition → New inventory** shows what changed on their site, with the move behind each
      row, and an empty list reads as "their catalogue held still" rather than as a failure. Note the
      Suppliers page no longer carries Price moves / Stock moves / Promotions: nothing we read
      publishes a comparable buy price or stock level, so those panels could only ever be empty.

- [ ] **Suppliers → Catalogue reads says what each read did.** This is the check the page needed but
      never had. The change table can only show *products*, and every supplier watched here publishes
      none — so the page had one number for a read (changes found) that was permanently 0, which is
      indistinguishable from a scan that never runs. Expect one row per supplier with a state:

      - *no catalogue* — read cleanly, the site publishes nothing to monitor. `site_scan_at` is set and
        there are no items. **This is the state all three current suppliers are in**, and it is why an
        empty table is the correct answer rather than a fault.
      - *listing products* — items are held, so the read worked.
      - *read failed* — `site_error` is set; the row quotes it.
      - *reading* — a crawl is in flight (`site_run_id` set).
      - *not read yet* — no read has settled. **Not the same as *no catalogue*** and must never render
        the same way.

      ```bash
      sql "select name, site_scan_at, site_error, last_scan_at,
                  (select count(*) from supplier_items i where i.supplier_id=s.id) items
           from suppliers s order by name"
      sql "select count(*) from supplier_items"   -- 0 while every source is a factory site
      ```

      The card's subtitle reads the set back (*"3 supplier sites checked — 3 with no catalogue to
      read"*), the *New items this cycle* tile says why it is 0, and the table's empty state stops
      blaming the date filters. **Read now** re-reads one supplier on demand and reports the same
      answer — a run still going says so rather than claiming a result.

### Deliberate non-features

- **Only four platforms are ever written.** Instagram, TikTok, Facebook and X are the ones with a
  scraper; YouTube, LinkedIn, Threads and the rest are shown as *"found, not monitored"* and never
  saved, because a row no scan can fill would sit in Social presence with zero metrics forever.
- **Preview reads are bounded two ways.** Onboarding runs before a business row exists, so the
  allowance is per **signed-in user** (10/hour) — but the spend is still attributed to the user's
  workspace as soon as they own one, so a preview read from an already-set-up account *does* land in
  that workspace's monthly Apify cap, and a genuinely pre-onboarding one does not
  (`api_usage_log.business_id` is null).
- **Suggestions are never auto-applied.** A footer link can belong to the site's web agency rather
  than the brand, and every accepted handle becomes a billed scrape target.

---

## 4b. Website traffic and competitor advertising

Two producers that exist because their panels were otherwise structurally empty. Both are run by every
pull, and neither needs a button: they are part of the six live scans.

> ### Start here: is Apify refusing everything?
>
> On 2026-09-29 the account hit its **$5 monthly hard limit** ($5.07 used) and every Apify call began
> returning `403 platform-feature-disabled: Monthly usage hard limit exceeded`. Supplier catalogue
> reads, competitor inventory, social, traffic and advertising all stopped **at once** and each looked
> separately broken. Check this first, because nothing else on this page can work while it is true:
>
> ```bash
> set -a; . ./.env.local; set +a
> curl -s "https://api.apify.com/v2/users/me/limits" -H "Authorization: Bearer $APIFY_TOKEN" | python3 -c "
> import json,sys; d=json.load(sys.stdin)['data']; c=d['current']; l=d['limits']
> print(f\"used \${c['monthlyUsageUsd']:.2f} of \${l['maxMonthlyUsageUsd']} — cycle ends {d['monthlyUsageCycle']['endAt'][:10]}\")"
> ```
>
> - [ ] **The refusal is explained, not swallowed.** With the limit spent, any Apify-backed scan must
>       answer with a sentence naming Apify, the monthly limit and what fixes it — **not**
>       `Provider request failed (403)`. That message is the whole reason six features looked broken.
>       It is raised as 429, and it must not be retried: one attempt, one message.
> - [ ] **The cost of a read is bounded.** `APIFY_SITE_MAX_ITEMS` is a *price*, not just a breadth —
>       the actor bills per product returned, and the old 200-item cap cost **$1.00 a read**. Confirm
>       a read costs about $0.30 and that the ledger agrees:
>
>       ```bash
>       sql "select endpoint, round(sum(cost_usd)::numeric,4) cost, count(*) from api_usage_log
>            where provider='apify' and created_at > now() - interval '1 day' group by 1 order by 2 desc"
>       ```

### 4b.1 `traffic-scan` — My Business *Website traffic* and Competition *Their monthly traffic*

One Apify run prices our domain and every rival's together (`{ domains: [...] }`), which is why the two
pages always agree about the same site. Costs about **$0.001** for eight domains.

- [ ] **Measured** → expectations, all of which held on 2026-09-29:

      ```bash
      sql "select monthly_visits, visits_change from businesses where id='<business>'",
      sql "select name, monthly_visits, visits_change from competitors order by monthly_visits desc"
      sql "select kind, label, value, sort_order from my_metrics where kind in ('traffic','channel') order by kind, sort_order"
      sql "select count(*) from competitor_metrics where kind in ('traffic','traffic_source')"
      sql "select source_type, status, changes_found from scan_runs where source_type='traffic' order by started_at desc limit 3"
      ```

      Live result: 8 of 8 domains measured, `10,435,813` visits (+39.5%) for the site itself, three
      months of series and ten channel rows for us, three `traffic` plus ten `traffic_source` rows for
      each of the seven rivals. The response names which domains came back; My Business shows the
      series and the channel mix, Competition shows the rival's bars and sources.

- [ ] **A windowed restatement.** The provider reports its recent three months every run, so run it
      twice and expect the row **counts to stay identical** — the labels this run returned are
      rewritten rather than duplicated, so a second scan cannot grow the chart a duplicate point.
      Months it does *not* return are kept until the series passes 12 points, which is what lets the
      traffic chart add a bar a month instead of staying pinned at three. `sort_order` is months since
      the epoch, and the channel rows are ordered largest-first because their `sort_order` is the
      display order.
- [ ] **The estimate is labelled as one.** My Business says "Estimated visits in the latest month" and
      "Visits are estimates"; nothing claims these figures are counted. SimilarWeb models them.
- [ ] **A domain with no data is not a zero.** `unavailable` in the response lists it, the tile stays
      empty, and nothing is written for it. `0 visits` and `nobody has looked` must not render the same.
- [ ] **Conversion rate is hidden, not faked.** No provider we hold reports it, so the line is omitted
      and a sentence says why — previously it printed "Conversion rate 0% · 0 orders last month", which
      reads as a measured zero.

### 4b.2 `ads-scan` — Competition *Active ad campaigns*

- [ ] **The tile needs a Facebook page, and says so.** With no competitor holding one, the scan answers
      `status: "unavailable"` with a per-competitor reason and **starts no provider run** — confirming
      `sql "select count(*) from scan_runs where source_type='ads' and created_at > now() - interval '5 minutes'"`
      stays 0, because nothing was spent. The tile shows an **em dash**, not a 0, and its meta line says
      *"add their Facebook page on the Social tab to read their ads"*. A 0 would mean "not advertising".
- [ ] **Add a page and it fills.** Competition → Social presence → add the rival's **Facebook** page,
      pull down, and expect *"N active Meta ads across M competitor pages"*. On 2026-09-29 four pages
      (`arcteryx`, `ColumbiaSportswear`, `Marmot`, `REI`) produced 9 live Meta ads between them, with
      real creative headlines, real start dates and `ads_running` written back onto each
      `competitor_social` row — which is what the Social tab's per-channel "Ads live" reads.

      ```bash
      sql "select c.name, a.platform, a.status, a.headline, a.first_seen_at::date from competitor_ads a
           join competitors c on c.id=a.competitor_id order by c.name, a.first_seen_at desc"
      sql "select c.name, s.platform, s.handle, s.ads_running from competitor_social s
           join competitors c on c.id=s.competitor_id order by c.name"
      ```

- [ ] **Attribution is exact, and stays exact.** Meta's search does not return the advertiser you asked
      for — a live search for *Patagonia* returned Mapu Lahual Chile, Rue La La, On Water Expeditions,
      MRCOOL and Helados Patagonia, and `search_type=page` returned the same set. So a result is only
      ever stored when its advertiser's page name or profile handle matches the competitor exactly;
      `unmatched` in the response counts what was rejected. Never accept a "contains" match here: it
      would file Helados Patagonia's campaign under Patagonia and raise an urgent alert about it.
- [ ] **A campaign that stops stops counting.** The rows are restated per competitor, so an ad the
      library no longer lists disappears from `competitor_ads` and from the tile. `first_seen_at` is the
      library's own start date, so the row's history survives the rewrite and the "new campaign" alert
      still judges 5-day recency correctly.

---

### 4b.3 `buy-list` — My Business *Buy list*

Calls no provider: the suggestions are derived from readings already on file, so this costs nothing and
is the one live scan that keeps working while a provider is refusing us. It runs with every pull, and
also has its own **Find suggestions** button on the tab.

- [ ] **Fills from the rival catalogue we already read.** With a competitor whose catalogue has been
      read, expect *"N suggestions from M tracked rivals"* and rows in `inventory_recommendations`:

      ```bash
      sql "select product, competitor_ref, estimated_price, traffic_potential, priority, reason
           from inventory_recommendations order by priority, product limit 15"
      ```

      On 2026-09-29 this produced 12 real suggestions from Cotopaxi's 200-product catalogue, with
      decoded names (`Men's`, not `Men&#39;s`), the rival's own shelf price and a checkable reason.
- [ ] **It invents nothing.** `margin_pct` and `suggested_qty` must be **null** — there is no cost or
      sales data on the server — and the card renders them as em dashes, never as `0%` or `null units`.
      `estimated_price` is the rival's shelf price, labelled as an estimate, not a cost.
- [ ] **A repeat run adds nothing.** Run it twice: the second answers *"every product the tracked
      rivals listed is already on the buy list"* with `created: 0`. It also never rewrites a row already
      on file, so a star the user has set is never thrown away.
- [ ] **Gift cards are not suggestions.** A storefront catalogues `Digital Gift Card` like any product;
      those rows must be absent, because they cannot be stocked.
- [ ] **Priority is evidence, not enthusiasm.** `high` needs two rivals stocking the same product or a
      match on a tracked term; a single fresh listing is `medium`.

---

## 5. SerpApi — search visibility, local & keyword ideas

Cost: budgeted against `SERPAPI_MONTHLY_CAP` (250 on the free tier). "Find ideas" with intent probes
costs **4 searches**.

**My Business** — pull down to refresh; the page has no scan button of its own.

- [ ] **Pull to refresh** → organic positions per device, the Google map 3-pack and Business profile health fill in
- [ ] **Overview → Search & AI visibility health** reports the scan's own figures rather than the ones
      onboarding wrote: the top-10 count, the average position and their movement all come from the
      `businesses` row, and the SEO tile's hint now reads *"was N at the last scan"*.

      ```bash
      sql "select seo_score, previous_seo_score, top10_count, previous_top10_count,
                  ranked_count, avg_position, rankings_checked_at
           from businesses limit 1"
      ```

      Expect `rankings_checked_at` moments old, and `top10_count` to equal the number of rows in the
      Search tab whose position is 10 or better. Pull again after the window: the current columns take the
      figures the scan just derived and the `previous_*` columns take what they held, so a movement of
      zero is the honest answer when nothing moved.
- [ ] Toggle **Desktop / Mobile** → the ranking table switches without a full reload
- [ ] **Find keywords** → seed e.g. `velvet lip kit` → **Find ideas** → suggestions appear
- [ ] **Group into themes** → 2–5 themes, each with an intent badge

      Expect every suggestion to still be listed, and the line *"Grouped by what each search is
      actually asking for. Every suggestion you had is still here — nothing was added."* A
      "Not grouped" section appears if the model left something out — that is the list being
      complete, not a bug.

- [ ] **Reload the page** → the themes are still there (labels are written to the database, not held
      only in the response)

**Competition → Local**

- [ ] **Run benchmark** → Share of Voice and the competitor review gap for tracked rivals
- [ ] The same run fills the panels that read the **competitor row** rather than the gap table. Until
      this write existed, the Maps lookup returned each rival's stars and review count, they were stored
      only in `competitor_review_gap`, and the page showed **0** beside a figure we had already paid
      for. Expect every competitor to carry a real rating and count, and `previous_rating` to hold the
      figure from the *previous* run — never the new one, or the movement column would always read zero:

      ```bash
      sql "select name, rating, previous_rating, review_count, reviews_this_month, last_scan_at
           from competitors order by name"
      sql "select name, their_rating, their_reviews from competitor_review_gap
           join competitors on competitors.id = competitor_review_gap.competitor_id order by name"
      ```

      The two queries must agree on `rating` / `their_rating` and on `review_count` / `their_reviews`.
      Run the benchmark twice: the second run moves `previous_rating` onto the first run's figure.
      `reviews_this_month` counts growth since the earlier benchmark *of the same month*, and is 0 on
      the first run of a month — that is a real zero, not a missing value.
- [ ] `last_scan_at` moves with them, so *"Last scan"* on the page is when we actually read the
      competitor rather than the page-open time it used to fall back to

---

## 6. Apify — competitor social monitoring

Cost: ~$0.12 for one Instagram handle (50 results × $0.0023), capped by `APIFY_MAX_CHARGE_USD` ($0.25
per run) inside `APIFY_MONTHLY_CHARGE_USD` ($5/month).

**Competition → Social**

- [ ] **Add handle** → add an **Instagram** handle for a rival

      Pasting a full profile URL is fine — it is reduced to the bare handle. A URL stored verbatim
      would build a broken profile URL and quietly scrape nothing (as in §4.2).

- [ ] Remove it with the ✕ on the channel row

      Expect the handle *and its scrape state* to be cleared, so re-adding a **different** profile for
      the same platform does not inherit the old "not due yet" timer.

- [ ] Re-add it, then **Scan posts now** → recent posts with engagement numbers

      Cadence is measured from the posts actually scraped, not from the competitor's own claims.

- [ ] Confirm the page still says *"Their posts are a signal, never artwork."*
- [ ] Any handles you accepted in §4.3/§4.6 appear here as scannable targets.

### Deliberate non-features

- **TikTok / Facebook / Trustpilot** actors are `FLAT_PRICE_PER_MONTH` rentals ($35–45/month). Apify
  refuses them under a $0.25 per-run cap, so they are reported as **skipped**. That is the cap working.
- **Yelp** needs the exact `biz` slug; a wrong one syncs 0 reviews without an error.
- **A slow run is not lost.** If a scrape outlives the wait the toast reports it as still running, and
  the next scan collects it — without paying twice.

---

## 7. Reviews — sync, deferred runs & reply drafts

Cost: Google and TripAdvisor go through SerpApi (1 search); Yelp/G2/Capterra/Trustpilot use an Apify
actor (~$0.006–0.065 per run).

**Social & reviews**

- [ ] **Connect** a review profile — cheapest is **Google** (one SerpApi search)
- [ ] **Scan reviews now** → reviews appear in **My reviews**

      If a scrape is slow: *"Synced N profiles — M reviews, X need a reply. K still running — the next
      sync collects it."* Scan again and it collects the **same** run.

- [ ] Click **Reply** on a review → **Draft with AI**

      Expect the textarea to fill with a draft, and *"Drafted with a `<tone>` tone. Sending is still
      yours to do."*

- [ ] **Send reply** by hand → the reply is recorded against the review

      Sending needs your own Google Business Profile connected (no reader exposes a reply API).
      Without it the app explains the refusal rather than failing silently.

---

## 8. AI drafting on real material

Every task produces a **draft the user confirms**. Nothing is sent, posted or published by the model.

- [ ] **Reply drafts** — see §7
- [ ] **Ad angles** — Competition → Social → on **Top post this cycle**, **Build our own from this angle**

      Expect a modal with **3 angles**, each with a rationale and (when your catalogue has items) a
      product to build around, and the line *"Their wording is not reused — these are our own angles."*

      Then **Create this brief** → toast → the brief appears in **Promotions → Ads history**. This is a
      real brief; the button used to announce one that was never created.

- [ ] **Keyword themes** — see §5

      A cluster may never contain a keyword that was not already in your suggestion list. The model's
      invented keywords are dropped before the page sees them.

> With an empty catalogue (`inventory_items` = 0) every angle comes back with **no product hint**, and
> the brief carries only logo + contact. Add a product in **Inventory & services** first if you want
> angles that name one.

---

## 9. Mallary.ai — publishing

Needs a **delivered** design, which arrives through the design flow.

- [ ] **Promotions** → a delivered design shows **Post ad**
- [ ] Choose accounts → **Publish now** (or schedule) → the post lands in **Ads history** with a permalink
- [ ] Inbound publish events are signature-verified and replay-protected:

```bash
sql "select provider, event_id, created_at from webhook_events order by created_at desc limit 5"
```

With no delivered designs yet this panel is an empty state — expected.

---

## 10. Limits, health and alerts

- [ ] **Business profile → Plan usage** — real units/dollars once calls have been made; AI drafting
      reports tokens and cost
- [ ] **Push a limit on purpose:** set `SERPAPI_MONTHLY_CAP=1`, run a scan, and confirm a clear refusal
      quoting the arithmetic rather than a silent failure. Set it back afterwards.

      ```bash
      npx supabase secrets set SERPAPI_MONTHLY_CAP=1 --project-ref "$SUPABASE_PROJECT_REF"   # then back to 250
      ```

- [ ] **Notifications** — budget alerts fire at 80% and again at 100%; failed scans and any connection
      a provider rejected are listed with a **Reconnect** affordance

### Cost ceilings in force

| Provider | Ceiling | Basis |
| --- | --- | --- |
| SerpApi | 250 searches/month | `SERPAPI_MONTHLY_CAP` |
| Apify | $5/month, $0.25 per run | `APIFY_MONTHLY_CHARGE_USD`, `APIFY_MAX_CHARGE_USD` |
| AI drafting | **uncapped** by design | logged and shown, never refused; set `LLM_MONTHLY_CHARGE_USD` to cap it |
| Mallary | 50 posts/month | `MALLARY_MONTHLY_CAP` |
| Discovery, before setup | 10 reads/hour **per signed-in user** | `APIFY_CONTACTS_PREVIEW_MAX_PER_HOUR` |
| Discovery, after setup | the Apify rows above, plus a 2-minute replay window | `APIFY_CONTACTS_REUSE_WINDOW_MINUTES` |

Drafting is uncapped because it is user-triggered and a call costs a fraction of a cent. Usage is
recorded to six decimals — at four, every drafting call would have rounded to `$0.0000`.

---

## 11. Security and isolation

The checks nothing else can make: a real Clerk token, real row-level security, real cross-account
requests.

- [ ] **Every function refuses an unauthenticated call.** Deployed with `--no-verify-jwt`, so this is
      the only thing standing between an anonymous caller and a provider:

      ```bash
      set -a; . ./.env.local; set +a
      for f in serp-scan serp-competitors keyword-ideas social-scan web-contacts-scan reviews-sync \
               review-reply ai-draft publish-ad social-accounts provider-webhook integrations-status; do
        code=$(curl -s -o /tmp/r.txt -w '%{http_code}' -X POST \
          "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/$f" \
          -H 'Content-Type: application/json' -d '{}')
        printf "%-22s %s  %s\n" "$f" "$code" "$(head -c 60 /tmp/r.txt)"
      done; rm -f /tmp/r.txt
      ```

      **Measured on 2026-09-28:** ten `401 {"error":"Missing bearer token."}`, and two that reject
      differently:

      | Function | Response | Why this is the expected one |
      | --- | --- | --- |
      | `provider-webhook` | `401 {"error":"Invalid webhook signature."}` | A provider has no Clerk session. Its authentication is the HMAC signature, verified over the raw body *before* anything is read — so a 401 here is the signature check working |
      | `review-reply` | `409 {"error":"Sending replies is not available on this deployment yet…"}` | **Known inconsistency, not a leak of anything dangerous but worth seeing:** this function reports that a *feature* is unconfigured before it authenticates, so an anonymous caller learns one configuration bit. Several functions check `hasEnv(...)` before `requireCaller()` for the same reason; the others look identical to the ten above only because their providers *are* configured, so the check passes and the caller is rejected next. Reordering `requireCaller()` first would remove the disclosure — see the note at the end of this section |

      A `200`, or a `500` naming an internal cause, is a real finding: it means a function is reachable
      without a session or is leaking an error rather than rejecting the caller.

- [ ] **A valid token is required even where there is no tenant.** `web-contacts-scan` in preview mode
      is the interesting case — it runs before a workspace exists, so it cannot be tenant-scoped, and
      the session is the only check:

      ```bash
      curl -s -X POST "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/web-contacts-scan" \
        -H "Content-Type: application/json" -d '{"url":"https://example.com"}' -w '\n%{http_code}\n'
      ```

      Expect `401 {"error":"Missing bearer token."}`.

- [ ] **One account cannot reach another's workspace.** Needs the second account *with a workspace of
      its own* (§4.1) — you want its `businesses.id`, which is not the id you already have:

      ```bash
      sql "select b.id, b.owner_user_id, b.name from businesses b"
      # then, with A's Clerk token and B's business id:
      curl -s -X POST "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/web-contacts-scan" \
        -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" \
        -d '{"businessId":"<B business id>","competitorId":"<B competitor id>"}' -w '\nhttp=%{http_code}\n'
      ```

      Expect `403 {"error":"You do not have access to this business."}`. This is `assertBusinessOwned`
      doing its job — the body is attacker-controlled in every one of these functions.

- [ ] **One account cannot collect another's discovery run.** The app never sends `runId`, so this is a
      curl rather than a click. The **pairing** is the check: one half alone proves nothing.

      ```bash
      # 1. Account A presses Find socials. Note the run id.
      sql "select run_id, user_id from contacts_discovery_runs order by created_at desc limit 1"

      # 2. With B's token — expect 404, and NOT a confirmation that the id exists:
      curl -s -X POST "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/web-contacts-scan" \
        -H "Authorization: Bearer $TOKEN_B" -H "Content-Type: application/json" \
        -d '{"runId":"<A run id>"}' -w '\nhttp=%{http_code}\n'

      # 3. With A's own token — the same call should resolve.
      ```

      Expect `404 {"error":"That discovery run is not in this account."}` for B and a `200` for A. The
      message is deliberately identical for "no such run" and "someone else's run": a distinguishable
      `403` would confirm that a guessed id exists.

- [ ] **The run ledger is operator-only, not tenant-readable.** It holds every account's spend, so it
      is RLS-on-with-no-policies:

      ```bash
      set -a; . ./.env.local; set +a
      K="$VITE_SUPABASE_ANON_KEY"
      curl -s "https://$SUPABASE_PROJECT_REF.supabase.co/rest/v1/contacts_discovery_runs?select=id,user_id" \
        -H "apikey: $K" -w ' <- select\n'
      curl -s -X POST "https://$SUPABASE_PROJECT_REF.supabase.co/rest/v1/contacts_discovery_runs" \
        -H "apikey: $K" -H "Content-Type: application/json" \
        -d '{"user_id":"attacker","mode":"preview"}' -w ' <- insert\n'
      ```

      Expect `[]` for the select and `401` with code `42501` ("new row violates row-level security
      policy") for the insert.

- [ ] **Tenant tables are unreadable without a Clerk session.** Row-level security resolves the tenant
      from the Clerk JWT, so the anon key alone sees nothing:

      ```bash
      for t in competitors competitor_social businesses clients api_usage_log; do
        printf "%-20s %s\n" "$t" "$(curl -s "https://$SUPABASE_PROJECT_REF.supabase.co/rest/v1/$t?select=id" -H "apikey: $K")"
      done
      ```

      Expect `[]` for every table.

- [ ] **No secret value is in the repo.** The actor id is a *public* identifier (it appears in the
      actor's URL), so it belongs in `env.example`; nothing else does:

      ```bash
      git check-ignore -v .env.local                 # must be ignored
      git ls-files | grep -E "^\.env"                # only .env.test, which is empty by design
      grep -nE "=[A-Za-z0-9_-]{24,}" env.example     # only obvious placeholders
      git diff --cached                              # nothing staged
      ```

- [ ] **The deploy matches the source** — see §1.

### Note: which functions answer before they authenticate

Seven functions check whether their provider is configured *before* they check who is calling:
`review-reply` (`repliesConfigured()`), `serp-scan`, `serp-competitors`, `keyword-ideas`, `social-scan`,
`publish-ad` and `social-accounts`. The order is the same in all seven — `hasEnv(...)` (or a helper
that wraps it), then `requireCaller(req)`.

You only *see* it on `review-reply` because `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are not set on
this deployment, so the config check fails first and returns `409`. The other six providers are
configured, so their check passes and the anonymous caller is rejected by `requireCaller()` a line
later — indistinguishable from the ten plain `401`s above. Unset, say, `SERPAPI_KEY` and redeploy, and
`serp-scan` would answer an anonymous caller with the identical unconfigured-feature `409`.

What this does and does not expose: an anonymous caller learns **one bit** — whether a given provider is
configured. They learn nothing about data, tenant ids, or the wiring. It is worth writing down rather
than worth panicking about.

If you want it gone, the fix is to move `requireCaller(req)` above the configuration check in each
function. Do that **only** after confirming nothing is intended to be reachable without a session:
`provider-webhook` authenticates by HMAC instead of Clerk, and preview-mode `web-contacts-scan` has no
tenant to scope to but still requires a token (it already calls `requireCaller()` first — the one of the
eight that does). Neither is in the list of seven.

---

## 12. Cleanup: putting the workspace back

The pass creates real rows, changes real secrets and mutates a competitor or two. Put it back.

- [ ] **Restore any secret you changed** (`APIFY_CONTACTS_ACTOR_ID`, `APIFY_CONTACTS_PREVIEW_MAX_PER_HOUR`,
      `SERPAPI_MONTHLY_CAP`) and confirm the amber line in Integrations is gone:

      ```bash
      npx supabase secrets list --project-ref "$SUPABASE_PROJECT_REF"
      ```

- [ ] **Restore any row you forced** — a blanked website, a bogus `contacts_run_id`:

      ```bash
      sql "select name, website, contacts_status, contacts_run_id from competitors order by name"
      ```

- [ ] **Remove the discovery ledger rows you created**, if you do not want them in the cost history.
      Note that deleting history loses the spend attribution, so this is optional:

      ```bash
      sql "select mode, status, count(*), round(sum(cost_usd),4) as spend
           from contacts_discovery_runs group by 1,2 order by 1,2"
      sql "delete from contacts_discovery_runs where user_id = '<a user id you tested with>'"
      ```

- [ ] **Decide about the test competitors/suppliers.** Deleting a competitor through the UI takes its
      `competitor_social` rows and tracked keywords with it (§4.4); deleting by SQL cascades the same
      way, because the foreign keys do the work. Accepted profiles are real monitoring targets, so
      leaving them means paying for their scans on the next cadence tick.
- [ ] **Leave the fixtures you want to keep.** `businesses`, `competitors` and `api_usage_log` are the
      workspace's own data — the plan has no opinion about them beyond not lying to you about what is
      there.

---

## 13. When something goes wrong

These messages are deliberate, so they tell you which layer failed:

| Message | Meaning |
| --- | --- |
| *"Missing bearer token."* / *"Invalid or expired session token."* (`401`) | Clerk rejected the call — a stale token, or `CLERK_JWT_ISSUER` unset on the server |
| *"You do not have access to this business."* (`403`) | The body's `businessId` is not yours — correct behaviour, not a bug |
| *"AI drafting is not configured — add GROQ_API_KEY…"* | The function cannot see the secret |
| *"Website discovery is not available on this deployment…"* | `APIFY_CONTACTS_ACTOR_ID` is blank or the function is not deployed |
| *"You have started 10 website reads in the last hour…"* (`429`) | The **preview** allowance — per signed-in user, because there is no workspace to bill yet |
| *"Reusing the read of … from a moment ago"* | Not a problem — the reuse window, so the same pages were not paid for twice |
| *"…has no readable website on file…"* (`409`) | Nothing to read — the competitor's website is empty or unparseable |
| *"Could not check the read already in flight…"* (`503`) | Apify could not be reached to check a run. Retry: clearing the pointer here would buy a second run for pages already being paid for |
| *"That discovery run is not in this account."* (`404`) | No such run, or not yours — the same answer for both, on purpose |
| *"Ask for keyword ideas first — there is nothing to group yet."* | No saved suggestions for that seed |
| *"That post is not in this workspace — run a social scan first."* | No scraped post, or the wrong one |
| *"That review is not in this workspace."* | The review id is not in your tenant |
| *"That review has no text to answer…"* | A star rating with no words has nothing to reply to |
| *"…still running"* | Not an error — the run is kept and collected next sync |
| A provider row shown as **skipped** | The actor is a monthly rental the cap will not pay for |
| `409` on sending a reply | That platform exposes no reply API; see §7 |

**Reporting:** the exact toast text, plus DevTools → **Network** → filter the function name
(`web-contacts-scan`, `social-scan`, `reviews-sync`, `ai-draft`) → the **status and response body** —
and the matching row from the SQL helpers, because a UI that says "nothing was charged" and a ledger
row that says otherwise is the bug worth finding.

---

## 14. What this plan cannot cover from a sandbox

- **Clerk sign-in itself** must be done by a person. The gateway verifies every request against Clerk's
  JWKS, so a token cannot be faked — which is why §11's checks need your session.
- **Provider webhooks** need Mallary to call back to a deployed URL.
- **The scheduled worker** that fetches supplier/competitor *pages* (non-API sources) is not built; so
  "Scan now" on those surfaces queues a `scan_runs` row and updates the last-scan time rather than
  changing page content. That is §9's "not built yet", not a failure.
- The three AI tasks were verified against the live model with the real prompts before this plan was
  written, so a drafting failure here is most likely configuration, not the prompt.
