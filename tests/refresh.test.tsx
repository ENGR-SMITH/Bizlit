import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PULL_REFRESH_INTERVAL_MS, RefreshProvider, useRefresh } from "../src/lib/refresh";
import type { PullOutcome } from "../src/lib/refresh";
import { sampleWorkspace } from "../src/data/sample";
import type { WorkspaceActions, WorkspaceData } from "../src/lib/workspace";

/**
 * The pull's own decisions are what this file tests — how much it starts, and
 * whether the window holds — so the workspace it reads is a double rather than the
 * live provider, which would go out to the network.
 */
const hook = vi.hoisted(() => ({ workspace: null as unknown }));

vi.mock("../src/lib/workspace", () => ({
  useWorkspace: () => hook.workspace,
}));

/** Mirrors `STORAGE_KEY` in `src/lib/refresh.tsx`. */
const STORAGE_KEY = "workspace:pull-refresh-at";

let container: HTMLDivElement;
let root: Root;
let captured: (() => Promise<PullOutcome>) | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  window.localStorage.clear();
  root = createRoot(container);
  captured = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

/** Reaches the pull through the provider the pages use. */
function Probe() {
  captured = useRefresh().pull;
  return null;
}

interface Harness {
  data: WorkspaceData;
  actions: WorkspaceActions;
  refresh: ReturnType<typeof vi.fn>;
  /** Action names in call order, so a test can assert on what was started. */
  calls: string[];
  /** Replaces one action's outcome, for the failure cases. */
  stub: (name: string, outcome: () => Promise<unknown>) => void;
}

/**
 * A workspace whose watched sources are all clear of pending crawls, with the
 * named ones marked as holding an uncollected run.
 */
function harness(options: { pendingCompetitors?: string[] } = {}) {
  const pendingCompetitors = new Set(options.pendingCompetitors ?? []);
  const calls: string[] = [];
  const sample = sampleWorkspace();

  const data = {
    ...sample,
    competitors: sample.competitors.map((competitor) => ({
      ...competitor,
      siteScanPending: pendingCompetitors.has(competitor.id),
    })),
  } as WorkspaceData;

  const record = (name: string) => async () => {
    calls.push(name);
    return null;
  };

  const actions = {
    runSerpScan: record("runSerpScan"),
    runSocialScan: record("runSocialScan"),
    runCompetitorBenchmark: record("runCompetitorBenchmark"),
    // The workspace-wide live scans the pull drives. Traffic and advertising are
    // in the same lane because the figures they read go stale between visits — a
    // traffic count or an active-campaign count is only as good as the last read.
    runTrafficScan: record("runTrafficScan"),
    runAdsScan: record("runAdsScan"),
    // Derived from data already on file, so it costs nothing — but it runs with
    // the sweep so the Buy list is never stale next to the panels it relates to.
    runBuyList: record("runBuyList"),
    // The connected review pages. A no-op without one, but it runs with the sweep
    // now that Social & reviews has no "Scan reviews now" button of its own.
    runReviewScan: record("runReviewScan"),
    scanCompetitorSite: async (competitorId: string) => {
      calls.push(`scanCompetitorSite:${competitorId}`);
      return null;
    },
  } as unknown as WorkspaceActions;

  const refresh = vi.fn(async () => {});

  return {
    data,
    actions,
    refresh,
    calls,
    stub(name, outcome) {
      (actions as unknown as Record<string, unknown>)[name] = async () => {
        calls.push(name);
        return await outcome();
      };
    },
  } as Harness;
}

async function mount(spec: Harness): Promise<PullOutcome> {
  hook.workspace = { data: spec.data, actions: spec.actions, refresh: spec.refresh };
  await act(async () => {
    root.render(
      <RefreshProvider>
        <Probe />
      </RefreshProvider>,
    );
  });
  if (!captured) throw new Error("the pull was never provided");
  let outcome: PullOutcome | null = null;
  await act(async () => {
    outcome = await (captured as () => Promise<PullOutcome>)();
  });
  if (!outcome) throw new Error("the pull returned nothing");
  return outcome;
}

describe("pull-to-refresh cap", () => {
  it("holds the window when nothing is waiting, and calls no provider", async () => {
    const stored = new Date().toISOString();
    window.localStorage.setItem(STORAGE_KEY, stored);
    const spec = harness();

    const outcome = await mount(spec);

    expect(outcome).toEqual({ status: "capped", lastRefreshedAt: stored });
    expect(spec.calls).toEqual([]);
    expect(spec.refresh).not.toHaveBeenCalled();
    // The stamp is untouched: an idle drag costs nothing and moves nothing.
    expect(PULL_REFRESH_INTERVAL_MS).toBe(10 * 60 * 1000);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(stored);
  });

  it("collects a crawl that is already paid for, instead of reporting up to date", async () => {
    window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    const sample = sampleWorkspace();
    const first = sample.competitors[0];
    const second = sample.competitors[1];
    const spec = harness({
      pendingCompetitors: [first.id, second.id],
    });

    const outcome = await mount(spec);

    expect(outcome).toMatchObject({
      status: "refreshed",
      mode: "collect",
      // Nothing was started, so nothing may be reported as having run.
      live: { ran: 0, attempted: 0 },
      site: { ran: 2, attempted: 2 },
    });
    // Only the two sources holding a run were touched — the sweep is skipped.
    expect(spec.calls).toEqual([
      `scanCompetitorSite:${first.id}`,
      `scanCompetitorSite:${second.id}`,
    ]);
    expect(spec.refresh).toHaveBeenCalledWith({ silent: true });
  });

  it("does not let a collection push the next sweep a whole window out", async () => {
    const stored = new Date().toISOString();
    window.localStorage.setItem(STORAGE_KEY, stored);
    const spec = harness({ pendingCompetitors: [sampleWorkspace().competitors[0].id] });

    await mount(spec);

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(stored);
  });

  it("still collects when the stored stamp is exactly one window old", async () => {
    // The boundary matters: `Date.now() - stamp < INTERVAL` has to fail here, or a
    // workspace never sweeps again.
    window.localStorage.setItem(
      STORAGE_KEY,
      new Date(Date.now() - PULL_REFRESH_INTERVAL_MS).toISOString(),
    );
    const spec = harness();

    const outcome = await mount(spec);

    expect(outcome).toMatchObject({ status: "refreshed", mode: "sweep" });
  });

  it("names the reason behind the count, rather than reporting a bare number", async () => {
    // "2 failed" tells the user nothing they can act on. The first refusal is
    // carried out so the toast can say what refused and why.
    const stored = new Date(Date.now() - PULL_REFRESH_INTERVAL_MS - 1000).toISOString();
    window.localStorage.setItem(STORAGE_KEY, stored);
    const spec = harness();
    spec.stub("runSerpScan", async () => {
      throw new Error("No tracked keywords yet — track one on My Business first.");
    });
    spec.stub("scanCompetitorSite", async () => ({
      status: "failed",
      reason: "The site read did not finish cleanly: TIMED-OUT",
    }));

    const outcome = await mount(spec);

    expect(outcome).toMatchObject({ status: "refreshed" });
    if (outcome.status !== "refreshed") throw new Error("expected a refreshed outcome");
    // A body that answers "failed" did not run, and the count has to say so.
    expect(outcome.failed).toBe(spec.data.competitors.length + 1);
    // The catalogue reason is the one the user just acted on, so it leads.
    expect(outcome.error).toBe("The site read did not finish cleanly: TIMED-OUT");
  });

  it("runs the whole sweep once the window has passed, and stamps it", async () => {
    const stored = new Date(Date.now() - PULL_REFRESH_INTERVAL_MS - 1000).toISOString();
    window.localStorage.setItem(STORAGE_KEY, stored);
    const spec = harness();

    const sample = sampleWorkspace();
    const watched = sample.competitors.length;

    const outcome = await mount(spec);

    expect(outcome).toMatchObject({
      status: "refreshed",
      mode: "sweep",
      // Search, social, the competitor benchmark, tracked reviews, website
      // traffic, competitor advertising and the derived buy list — every one of
      // them a panel that would otherwise go stale between visits.
      live: { ran: 7, attempted: 7 },
      site: { ran: watched, attempted: watched },
    });
    expect(spec.calls.slice(0, 7)).toEqual([
      "runSerpScan",
      "runSocialScan",
      "runCompetitorBenchmark",
      "runTrafficScan",
      "runAdsScan",
      "runBuyList",
      "runReviewScan",
    ]);
    // Stamped on a sweep — and on purpose before the re-read, so a reload that
    // then fails cannot hand back a free retry that bills every source twice.
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBe(stored);
  });
});
