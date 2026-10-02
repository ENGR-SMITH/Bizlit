# Reply credentials — what the Review reply composer needs

How to get every credential behind **Social & reviews → a review → Reply**, which
button each one unlocks, and — read Part 3 first if you only read one part — the
one that *cannot* be unlocked with a key alone yet.

State below verified against the live project `xjftzfixjklgsowlcrzl` on
2 October 2026.

## What each control needs

| Control | Backend function | Credential | Status |
| --- | --- | --- | --- |
| **Draft with AI** | `ai-draft` (v9, live) | `GROQ_API_KEY` | ✅ already set |
| **Copy** | none | — | ✅ works |
| **I posted it myself — mark as replied** | local record | Clerk sign-in only | ✅ works |
| **Send reply** | `review-reply` (v15, live) | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | ❌ unset — see Part 3 |

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
   credentials → OAuth client ID* → **Web application** → add an Authorized
   redirect URI (`http://localhost:5173/oauth/google` stands in until the
   connect flow exists) → **Create** → copy the **Client ID** and **Client
   secret**.
5. **Set them** (repo root; secrets need no redeploy):
   ```bash
   set -a && . ./.env.local && set +a
   npx supabase secrets set --project-ref $SUPABASE_PROJECT_REF \
     GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com \
     GOOGLE_CLIENT_SECRET=GOCSPX-...
   npx supabase secrets list --project-ref $SUPABASE_PROJECT_REF | grep GOOGLE_
   ```

---

## Part 3 — Why Send still will not post after Part 2

**No credential makes Send work today**, and it is not a missing key: the
posting call itself is a deliberate stub in
`supabase/functions/_shared/reviews.ts`.

```ts
export async function sendReply(_params: {
  platform: string;
  reviewExternalId: string;
  handle: string;
  body: string;
}): Promise<ReplyResult> {
  throw new HttpError(
    409,
    "Sending replies needs your own Google Business Profile connected, which this deployment does not have yet. …",
  );
}
```

So Part 2 only changes the message you see:

1. Without the two values → *"…it needs your own Google Business Profile
   connected (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Copy the suggested reply
   across by hand for now."*
2. With them → *"…Reading and replying are separate permissions: Google only
   accepts replies to reviews it told us about directly…"*

The reason is structural. Reviews are read through **SerpApi / Apify**, i.e.
scraped — Google only accepts a reply against a review id **it** minted, so a
scraped id is rejected. Closing the gap is **Phase B**:

- connect the tenant's own Google Business Profile through OAuth and store the
  refresh token per workspace;
- ingest that profile's reviews from `mybusiness.googleapis.com` so the ids in
  `my_reviews.external_id` are Google's own;
- post `accounts/{account}/locations/{location}/reviews/{review}/reply`.

Until then the compliant path is the manual one, which needs no credentials at
all: **Copy** → paste it on the platform → **I posted it myself — mark as
replied**, which records `replied`, the reply text and the timestamp against the
row.

---

## Verifying

Open **Social & reviews → a review → Reply**:

- **Draft with AI** returns a draft within a couple of seconds (a 409 here means
  `GROQ_API_KEY` is missing).
- **Send reply** always shows the server's own words in the composer — never a
  silent failure. Part 3's message is the expected answer until Phase B exists.
- **I posted it myself** marks the review replied without any provider call.

Reading reviews in the first place is separate: `SERPAPI_KEY` and `APIFY_TOKEN`
(and the per-platform `APIFY_*_REVIEWS_ACTOR_ID` values) are what pull reviews
into the list. All are already set on this deployment.
