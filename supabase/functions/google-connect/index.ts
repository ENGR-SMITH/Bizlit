import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { assertBusinessOwned, requireCaller } from "../_shared/auth.ts";
import { getEnv } from "../_shared/env.ts";
import { readJsonBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import {
  authUrl,
  connectConfigured,
  exchangeCode,
  listAccounts,
  listLocations,
  redirectUri,
  signState,
  verifyState,
  GBP_SCOPE,
  GoogleAuthError,
} from "../_shared/googleBusiness.ts";

/**
 * Google Business Profile connection — the OAuth half of sending a review
 * reply.
 *
 * Three calls, all from the app:
 *
 *   start      → the consent-screen URL to send the browser to, signed for
 *                this business and this user, with where to land afterwards
 *   status     → what is connected, for the button on Social & reviews
 *   disconnect → forget the grant
 *
 * And one that the app never makes: Google's own **callback**, a bare GET with
 * no session, carrying the signed state back. That path has no Clerk token, so
 * it verifies the signature instead and answers with a redirect — never with
 * JSON the browser would render. It is deployed with `--no-verify-jwt` for the
 * same reason `review-reply` is: the caller is verified here.
 *
 * Nothing here ever shows a token. The refresh token goes straight to the
 * table, the access token is minted per call and discarded, and the browser
 * only ever sees the consent URL and the status of the connection.
 */
interface Body {
  action?: string;
  businessId?: string;
  /** Where to land after consent — the page that started the flow, signed into the state. */
  returnTo?: string;
}

/**
 * A reply walks locations in order; this bounds what a single grant can list.
 * The list API serves 100 per page, and this is one page per account — a
 * business with more shops than that still replies against the first hundred.
 */
const MAX_LOCATIONS = 100;

/** Accounts tried when a grant can see more than one. */
const MAX_ACCOUNTS = 5;

interface ConnectionRow {
  id: string;
  status: string;
  display_name: string;
  account_name: string;
  location_names: string[] | null;
  connected_at: string;
  last_error: string;
}

Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  try {
    const url = new URL(req.url);
    if (req.method === "GET" && (url.searchParams.has("code") || url.searchParams.has("error"))) {
      return await callback(url);
    }

    if (!connectConfigured()) {
      throw new HttpError(
        409,
        "Connecting a Google Business Profile is not available on this deployment yet — it needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET set on the server.",
      );
    }

    const caller = await requireCaller(req);
    const body = await readJsonBody<Body>(req);
    const action = String(body.action ?? "");
    const businessId = String(body.businessId ?? "");

    if (action === "start") {
      await assertBusinessOwned(caller.userId, businessId);
      const state = await signState({
        businessId,
        userId: caller.userId,
        returnTo: assertReturnTo(req, body.returnTo ?? ""),
      });
      return json({ authUrl: authUrl(state), redirectUri: redirectUri(), scope: GBP_SCOPE });
    }

    if (action === "status") {
      await assertBusinessOwned(caller.userId, businessId);
      const { data } = await adminClient()
        .from("google_profile_connections")
        .select("status, display_name, account_name, location_names, connected_at, last_error")
        .eq("business_id", businessId)
        .maybeSingle();
      const row = (data ?? null) as ConnectionRow | null;
      return json({
        connected: Boolean(row),
        status: row?.status ?? "",
        displayName: row?.display_name ?? "",
        accountName: row?.account_name ?? "",
        locations: Array.isArray(row?.location_names) ? row.location_names : [],
        connectedAt: row?.connected_at ?? "",
        lastError: row?.last_error ?? "",
        redirectUri: redirectUri(),
      });
    }

    if (action === "disconnect") {
      await assertBusinessOwned(caller.userId, businessId);
      await adminClient().from("google_profile_connections").delete().eq("business_id", businessId);
      return json({ connected: false });
    }

    throw new HttpError(400, "Unknown action — expected start, status or disconnect.");
  } catch (error) {
    return failure(error);
  }
});

/**
 * The landing page may only be the page that started the connection: it is
 * signed into the state, and checked against the request's own origin here, so
 * a crafted link cannot turn this function into a redirector.
 */
function assertReturnTo(req: Request, raw: string): string {
  const value = String(raw ?? "").trim();
  if (!/^https?:\/\//i.test(value) || value.length > 512) {
    throw new HttpError(400, "returnTo must be an http(s) URL.");
  }

  let origin: string;
  try {
    origin = new URL(value).origin;
  } catch {
    throw new HttpError(400, "returnTo must be a valid URL.");
  }

  const referring = req.headers.get("origin") ?? req.headers.get("referer");
  if (referring) {
    let referringOrigin = "";
    try {
      referringOrigin = new URL(referring).origin;
    } catch {
      referringOrigin = "";
    }
    if (referringOrigin && referringOrigin !== origin) {
      throw new HttpError(400, "returnTo must be the page that started the connection.");
    }
  }

  return value;
}

/** Lands back on the app with what happened, so the page can say it in a toast. */
function redirect(returnTo: string, result: Record<string, string>): Response {
  const target = new URL(returnTo);
  for (const [key, value] of Object.entries(result)) target.searchParams.set(key, value);
  return new Response(null, { status: 302, headers: { Location: target.toString() } });
}

/** Where to land when the state itself cannot be trusted — nothing in it may be used. */
function fallbackReturnTo(): string {
  return getEnv("VITE_APP_URL") || getEnv("APP_URL") || "http://localhost:5173";
}

/**
 * Google's return leg: exchange the code, discover what the grant can see, and
 * store the grant against the business the signed state names.
 *
 * Every failure ends in a redirect rather than an error page — the user is
 * looking at their own app, and `?gbp=<reason>` is a thing the app can explain.
 */
async function callback(url: URL): Promise<Response> {
  const state = await verifyState(url.searchParams.get("state") ?? "");
  if (!state) return redirect(fallbackReturnTo(), { gbp: "expired" });

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return redirect(state.returnTo, {
      gbp: oauthError === "access_denied" ? "declined" : oauthError.slice(0, 40),
    });
  }

  const code = url.searchParams.get("code") ?? "";
  if (!code) return redirect(state.returnTo, { gbp: "no-code" });

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (cause) {
    return redirect(state.returnTo, {
      gbp: cause instanceof GoogleAuthError ? "expired" : "token",
    });
  }
  if (!tokens.refreshToken) return redirect(state.returnTo, { gbp: "no-refresh" });

  // Everything the grant can see, so a reply can walk it later without asking
  // the user which shop the review was left on.
  let accountName = "";
  let displayName = "";
  const locations: string[] = [];
  try {
    const accounts = await listAccounts(tokens.accessToken);
    accountName = accounts[0]?.name ?? "";
    displayName = accounts[0]?.displayName ?? "";
    for (const account of accounts.slice(0, MAX_ACCOUNTS)) {
      for (const location of await listLocations(tokens.accessToken, account.name)) {
        if (location.name) locations.push(location.name);
        if (!displayName) displayName = location.displayName;
        if (locations.length >= MAX_LOCATIONS) break;
      }
      if (locations.length >= MAX_LOCATIONS) break;
    }
  } catch {
    return redirect(state.returnTo, { gbp: "discover" });
  }

  if (!locations.length) return redirect(state.returnTo, { gbp: "no-location" });

  const db = adminClient();
  const patch = {
    account_name: accountName,
    location_names: locations,
    display_name: displayName || accountName,
    refresh_token: tokens.refreshToken,
    status: "connected",
    last_error: "",
    connected_at: new Date().toISOString(),
  };

  const { data: existing } = await db
    .from("google_profile_connections")
    .select("id")
    .eq("business_id", state.businessId)
    .maybeSingle();

  if (existing) {
    await db
      .from("google_profile_connections")
      .update(patch)
      .eq("id", (existing as { id: string }).id);
  } else {
    await db.from("google_profile_connections").insert({ business_id: state.businessId, ...patch });
  }

  return redirect(state.returnTo, { gbp: "connected" });
}
