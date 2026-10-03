# Reply credentials — what the Review reply composer needs

How to get every credential behind **Social & reviews → a review → Reply**, which
button each one unlocks, and — read Part 3 first if you only read one part — how
Send reply actually posts to Google once a Business Profile is connected.

State below verified against the live project `xjftzfixjklgsowlcrzl` on
2 October 2026.

## What each control needs

| Control | Backend function | Credential | Status |
| --- | --- | --- | --- |
| **Draft with AI** | `ai-draft` (v9, live) | `GROQ_API_KEY` | ✅ already set |
| **Copy** | none | — | ✅ works |
| **I posted it myself — mark as replied** | local record | Clerk sign-in only | ✅ works |
| **Send reply** | `review-reply` (live) | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + a connected Google Business Profile | ✅ Phase B live — see Part 3 |

---

## Part 1 — Draft with AI (already done on this deployment)

`GROQ_API_KEY` is present in the function secrets, so drafting works today. To
(re)set it:

1. <console.groq.com> → **API Keys** → **Create API Key**.
2. From the repo root:
   ```bash
   set -a && . ./.env.local && set +a
   npx supabase secrets set --project-ref $SUPABASE_PROJECT_REF GROQ_API_KEY=gsk_...
   ```
3. **No redeploy is needed** — secrets are read per call. The defaults already
   match: `LLM_BASE_URL=https://api.groq.com/openai/v1`,
   `LLM_MODEL=openai/gpt-oss-120b` (both optional; only the key is required).

---

## Part 2 — The credentials the Send 409 names

`review-reply` refuses before it reads the body unless both are set:

```ts
export function repliesConfigured(): boolean {
  return hasEnv("GOOGLE_CLIENT_ID") && hasEnv("GOOGLE_CLIENT_SECRET");
}
```

> **Status — both are now set on `xjftzfixjklgsowlcrzl`** (pushed from
> `.env.local` with the command in step 5 on 2 October 2026, and confirmed by
> digest: the deployed `sha256` of each value matches the file). You can prove
> the gate is open without ever seeing a secret: an unauthenticated POST to
> `/functions/v1/review-reply` now answers **`401 Missing bearer token`** where
> it used to answer **`409 … (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)`**. No
> redeploy is involved — secrets are read per call.
>
> Part 3 covers the rest of the chain: those two values let the function run,
> but the reply only lands after a tenant connects its own Business Profile.

1. **Create a project** — <console.cloud.google.com> → project dropdown →
   **New Project** → e.g. *BIZLIT replies*.
2. **Enable the API** — *APIs & Services → Library* → search **Business
   Profile Performance API** (and **Google Business Profile API** where offered)
   → **Enable**. Google gates the Business Profile API behind an access request:
   file Google's API-interest form and wait for approval, or later calls will
   403 even with valid credentials.
3. **OAuth consent screen** — *APIs & Services → OAuth consent screen* →
   **External** → app name + your email → add the scope
   `https://www.googleapis.com/auth/business.manage` → under **Test users** add
   the Google account that manages the Business Profile (test-only apps reject
   everyone else).
4. **Create the client** — *APIs & Services → Credentials → Create
   credentials → OAuth client ID* → **Web application** → add **both**
   Authorized redirect URIs → **Create** → copy the **Client ID** and **Client
   secret**:
   - `https://xjftzfixjklgsowlcrzl.supabase.co/functions/v1/google-connect`
     — the live connect callback (the one Google actually redirects to);
   - `http://localhost:5173/oauth/google` — local development stand-in.

   > If this URI is missing from the client, Google refuses the consent step
   > with *redirect_uri_mismatch* and the connect flow never starts.
5. **Set them** (repo root; secrets need no redeploy):
   ```bash
   set -a && . ./.env.local && set +a
   npx supabase secrets set --project-ref $SUPABASE_PROJECT_REF \
     GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com \
     GOOGLE_CLIENT_SECRET=GOCSPX-...
   npx supabase secrets list --project-ref $SUPABASE_PROJECT_REF | grep GOOGLE_
   ```

---

## Part 3 — How Send reply posts now (Phase B, live)

Send reply is **no longer a stub**. As of 2 October 2026 the flow is real:

1. **Connect** — *Review profiles → Google Business Profile → Link Google*
   invokes the `google-connect` function (live), which redirects to Google's
   consent screen with `access_type=offline&prompt=consent` and the scope
   `business.manage`. Google returns to
   `https://xjftzfixjklgsowlcrzl.supabase.co/functions/v1/google-connect`,
   which exchanges the code, discovers every account and location the grant can
   see (max 5 accounts / 100 locations), and stores the **refresh token** plus
   the location names in `google_profile_connections` (migration
   `0028_google_profile_replies.sql`, applied 2 Oct 2026 — RLS on, only the
   owning business can read it).
2. **Resolve at reply time** — when you press **Send reply**, `review-reply`
   reads the row (including any cached `google_review_name`), refreshes the
   access token, lists Google's *own* reviews for the connected location(s) and
   matches the scraped row to a Google review by id / rating / text overlap.
   Anonymous reviewers (no display name) match on rating + text overlap only.
   No confident match → **409 "…does not list a review matching…"** rather than
   a guess.
3. **Post** — `PUT mybusiness.googleapis.com/v4/accounts/*/locations/*/reviews/*/reply`
   with `{comment}`. The resolved Google review name is cached on the row so
   the next send skips discovery.

What still surfaces as a 409 (each with the server's own words in the
composer):

| Situation | Message |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` missing | names the two env vars |
| No `google_profile_connections` row | *Connect your Google Business Profile first* — the composer shows a **Connect Google Business Profile** button in this case |
| Row `status = needs_reauth` | connection expired — reconnect |
| Refresh token rejected (`invalid_grant`) | marks the row `needs_reauth`, asks you to reconnect |
| No confident match in Google's list | does not list a review matching this one |
| Google refuses the reply (400/403/404) | quotes Google's reason — 403 usually means the API-interest form has not been approved yet |
| Non-Google platform (Trustpilot, Yelp, …) | copy across by hand |

A *403 API access not granted* from Google is the one credential-shaped
failure: the Business Profile API is gated, so file Google's API-interest form
(step 2 in Part 2) and wait for approval.

The manual path needs no credentials at all and remains available:
**Copy** → paste it on the platform → **I posted it myself — mark as replied**.

---

## Not pushed, deliberately

Two keys sit in `.env.local` and are **not** function secrets, so they were left
out of the update:

| Key | Why not |
| --- | --- |
| `SCAN_JOB_SECRET` | No function reads it — it is documented in `env.example` for the scheduled ingestion job, which is not wired up yet. |
| `EMAIL_FROM` | `client-mail` also needs `EMAIL_SMTP_HOST` / `EMAIL_SMTP_USER` / `EMAIL_SMTP_PASS`, which are not in the file; setting only the From header enables nothing, so the pair goes up together. |

`GROQ_API_KEY`, `SERPAPI_KEY`, `APIFY_*`, `MALLARY_*` and `CLERK_JWT_ISSUER`
already hold their values on the project.

## Verifying

Open **Social & reviews → a review → Reply**:

- **Draft with AI** returns a draft within a couple of seconds (a 409 here means
  `GROQ_API_KEY` is missing).
- **Send reply** always shows the server's own words in the composer — never a
  silent failure. With no profile connected, Part 3's *Connect your Google
  Business Profile first* is expected (and comes with a one-click connect
  button). With one connected, the reply lands on Google and the row flips to
  *replied*.
- **Google Business Profile panel** (Review profiles card) shows the connection
  badge, account and location count; `?gbp=` results from the OAuth round trip
  arrive as toasts.
- **I posted it myself** marks the review replied without any provider call.

Reading reviews in the first place is separate: `SERPAPI_KEY` and `APIFY_TOKEN`
(and the per-platform `APIFY_*_REVIEWS_ACTOR_ID` values) are what pull reviews
into the list. All are already set on this deployment.
