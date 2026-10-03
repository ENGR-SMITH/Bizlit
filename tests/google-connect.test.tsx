import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDb, seedBusiness, state } from "./helpers/mailGateway";
import { signState, verifyState } from "../supabase/functions/_shared/googleBusiness";

/**
 * The OAuth half of a reply, driven as the real handler: what the app asks for,
 * what Google is sent, and what comes back with the code.
 *
 * Two boundaries are faked — Clerk's session check and Postgres — because they
 * are the same fakes `client-mail` uses, so the storage and the redirect are
 * shipped code rather than a mock. Google itself is stubbed at `fetch`.
 */

const denoEnv = new Map<string, string>();
let handler: ((req: Request) => Promise<Response>) | null = null;

// Stubbed before the function is imported: `Deno.serve` runs at module load.
vi.stubGlobal("Deno", {
  env: { get: (name: string) => denoEnv.get(name) },
  serve: (fn: (req: Request) => Promise<Response>) => {
    handler = fn;
  },
});

vi.mock("../supabase/functions/_shared/supabaseAdmin.ts", async () => {
  const helper = await import("./helpers/mailGateway");
  return { adminClient: helper.adminClient };
});

vi.mock("../supabase/functions/_shared/auth.ts", async () => {
  const helper = await import("./helpers/mailGateway");
  return { requireCaller: helper.requireCaller, assertBusinessOwned: helper.assertBusinessOwned };
});

interface FetchCall {
  url: string;
}

/** Google's discovery: one account, one location, whatever the test needs. */
function stubGoogle(result: {
  accounts?: unknown[];
  locations?: unknown[];
  refreshToken?: string;
}): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url });
    const body = url.includes("oauth2.googleapis.com")
      ? { access_token: "at-1", refresh_token: result.refreshToken ?? "rt-1" }
      : url.includes("/locations")
        ? { locations: result.locations ?? [] }
        : { accounts: result.accounts ?? [] };
    const text = JSON.stringify(body);
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(text) as unknown,
      text: async () => text,
    } as unknown as Response;
  });
  return calls;
}

await import("../supabase/functions/google-connect/index.ts");

function request(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!handler) throw new Error("the handler was never captured");
  return handler(
    new Request(`https://proj.supabase.co/functions/v1/google-connect${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer session-token",
        ...(init.headers ?? {}),
      },
    }),
  );
}

function start(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return request("", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "start", businessId: "biz-1", ...body }),
  });
}

const RETURN_TO = "http://localhost:5173/#/social";

beforeEach(() => {
  denoEnv.clear();
  denoEnv.set("GOOGLE_CLIENT_ID", "client-id.apps.googleusercontent.com");
  denoEnv.set("GOOGLE_CLIENT_SECRET", "client-secret");
  denoEnv.set("SUPABASE_URL", "https://proj.supabase.co");
  // Re-stubbed every test: the last one's afterEach un-stubs everything, the
  // handler's own `Deno.env` reads included.
  vi.stubGlobal("Deno", {
    env: { get: (name: string) => denoEnv.get(name) },
    serve: (fn: (req: Request) => Promise<Response>) => {
      handler = fn;
    },
  });
  state.db = emptyDb();
  state.userId = "user-a";
  seedBusiness("biz-1", "user-a");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("starting a connection", () => {
  it("answers a session-less caller before doing anything else", async () => {
    const response = await start({ returnTo: RETURN_TO }, { Authorization: "" });

    expect(response.status).toBe(401);
  });

  it("will not start a connection for another tenant's business", async () => {
    state.userId = "someone-else";
    const response = await start({ returnTo: RETURN_TO });

    expect(response.status).toBe(403);
  });

  it("hands back the consent URL, signed for this business and this landing page", async () => {
    const body = (await (await start({ returnTo: RETURN_TO })).json()) as {
      authUrl: string;
      redirectUri: string;
      scope: string;
    };
    const url = new URL(body.authUrl);

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o.oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://proj.supabase.co/functions/v1/google-connect",
    );
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/business.manage",
    );
    expect(body.scope).toBe("https://www.googleapis.com/auth/business.manage");

    const stateParam = url.searchParams.get("state") ?? "";
    expect(await verifyState(stateParam)).toMatchObject({
      businessId: "biz-1",
      userId: "user-a",
      returnTo: RETURN_TO,
    });
  });

  it("refuses a landing page that is not the page asking", async () => {
    // Without this the function would be an open redirector: the state is only
    // signed after the origin has been checked.
    const response = await start({ returnTo: "http://evil.example/#/social" }, {
      Origin: "http://localhost:5173",
    });

    expect(response.status).toBe(400);
  });

  it("refuses a landing page that is not even a URL", async () => {
    const response = await start({ returnTo: "javascript:alert(1)" });

    expect(response.status).toBe(400);
  });
});

describe("Google's callback", () => {
  async function callback(stateParam: string, extra = "") {
    return request(`/?code=code-1&state=${encodeURIComponent(stateParam)}${extra}`);
  }

  it("stores the grant and lands back on the workspace", async () => {
    stubGoogle({
      accounts: [{ name: "accounts/1", displayName: "GlowMart" }],
      locations: [{ name: "accounts/1/locations/2", displayName: "GlowMart HQ" }],
    });
    const signed = await signState({ businessId: "biz-1", userId: "user-a", returnTo: RETURN_TO });

    const response = await callback(signed);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("http://localhost:5173/?gbp=connected#/social");

    const [row] = state.db.google_profile_connections;
    expect(row).toMatchObject({
      business_id: "biz-1",
      account_name: "accounts/1",
      display_name: "GlowMart",
      location_names: ["accounts/1/locations/2"],
      refresh_token: "rt-1",
      status: "connected",
    });
  });

  it("replaces the grant instead of stacking a second one", async () => {
    stubGoogle({
      accounts: [{ name: "accounts/1", displayName: "GlowMart" }],
      locations: [{ name: "accounts/1/locations/2", displayName: "GlowMart HQ" }],
      refreshToken: "rt-2",
    });
    const signed = await signState({ businessId: "biz-1", userId: "user-a", returnTo: RETURN_TO });
    await callback(signed);
    await callback(signed);

    expect(state.db.google_profile_connections).toHaveLength(1);
    expect(state.db.google_profile_connections[0].refresh_token).toBe("rt-2");
  });

  it("says so when the account manages no location, and stores nothing", async () => {
    stubGoogle({ accounts: [{ name: "accounts/1", displayName: "GlowMart" }], locations: [] });
    const signed = await signState({ businessId: "biz-1", userId: "user-a", returnTo: RETURN_TO });

    const response = await callback(signed);

    expect(response.headers.get("Location")).toContain("gbp=no-location");
    expect(state.db.google_profile_connections).toHaveLength(0);
  });

  it("reports a declined consent without touching the connection", async () => {
    const signed = await signState({ businessId: "biz-1", userId: "user-a", returnTo: RETURN_TO });

    const response = await request(
      `/?error=access_denied&state=${encodeURIComponent(signed)}`,
    );

    expect(response.headers.get("Location")).toContain("gbp=declined");
    expect(state.db.google_profile_connections).toHaveLength(0);
  });

  it("refuses a state this deployment did not sign", async () => {
    const signed = await signState({ businessId: "biz-1", userId: "user-a", returnTo: RETURN_TO });
    // Rotating the secret is what a forged state looks like from this side.
    denoEnv.set("GOOGLE_CLIENT_SECRET", "rotated");
    stubGoogle();

    const response = await request(`/?code=code-1&state=${encodeURIComponent(signed)}`);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("gbp=expired");
    expect(state.db.google_profile_connections).toHaveLength(0);
    expect(await verifyState(signed)).toBeNull();
  });

  it("lands on the configured app URL when nothing about the state can be trusted", async () => {
    denoEnv.set("VITE_APP_URL", "https://bizlit.example");

    const response = await request("/?code=code-1&state=not-signed");

    expect(response.headers.get("Location")).toBe("https://bizlit.example/?gbp=expired");
  });
});

describe("status and disconnect", () => {
  async function status() {
    const response = await start({ action: "status" });
    return (await response.json()) as Record<string, unknown>;
  }

  it("reports nothing connected before a grant exists", async () => {
    expect(await status()).toMatchObject({ connected: false, locations: [] });
  });

  it("reports the connection without ever handing out the refresh token", async () => {
    state.db.google_profile_connections.push({
      id: "conn-1",
      business_id: "biz-1",
      account_name: "accounts/1",
      location_names: ["accounts/1/locations/2"],
      display_name: "GlowMart",
      refresh_token: "rt-1",
      status: "connected",
      connected_at: "2026-10-02T12:00:00.000Z",
      last_error: "",
    });

    const body = await status();

    expect(body).toMatchObject({
      connected: true,
      status: "connected",
      displayName: "GlowMart",
      locations: ["accounts/1/locations/2"],
    });
    expect(JSON.stringify(body)).not.toContain("rt-1");
  });

  it("forgets the grant on disconnect", async () => {
    state.db.google_profile_connections.push({
      id: "conn-1",
      business_id: "biz-1",
      account_name: "accounts/1",
      location_names: [],
      display_name: "GlowMart",
      refresh_token: "rt-1",
      status: "connected",
      connected_at: "2026-10-02T12:00:00.000Z",
      last_error: "",
    });

    const response = await start({ action: "disconnect" });

    expect(response.status).toBe(200);
    expect(state.db.google_profile_connections).toHaveLength(0);
  });

  it("rejects an action it does not know", async () => {
    const response = await start({ action: "nonsense" });

    expect(response.status).toBe(400);
  });
});
