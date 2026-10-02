import { afterEach, describe, expect, it, vi } from "vitest";

import {
  byDomain,
  normaliseTraffic,
  SERIES_WINDOW,
  seriesRestatement,
  trafficActorId,
  trafficDomain,
  trafficMaxChargeUsd,
  trafficMaxDomains,
  writeSeries,
} from "../supabase/functions/_shared/traffic.ts";

/**
 * `_shared/traffic.ts` reads its configuration through `Deno.env`, which the
 * browser test runner does not have. A minimal double is enough: the module only
 * touches it inside function calls.
 */
const denoEnv = new Map<string, string>();
vi.stubGlobal("Deno", { env: { get: (name: string) => denoEnv.get(name) } });
afterEach(() => denoEnv.clear());

/**
 * The traffic panels read whatever these functions produce, so this file pins the
 * shapes against the actor's **real** output rather than an invented fixture.
 * Every value in `patagoniaItem` was copied from a live
 * `curious_coder/similarweb-scraper` dataset item — including `visits` arriving as
 * a string, which is the detail a hand-written fixture would have got wrong.
 */
const patagoniaItem = {
  domain: "patagonia.com",
  globalRank: 3433,
  visits: "10435813",
  estimatedMonthlyVisits: {
    "2026-06-01": 7328027,
    "2026-07-01": 7479613,
    "2026-08-01": 10435813,
  },
  trafficSources: {
    SocialOrganic: 0.030150196033628018,
    SocialPaid: 0.015539984700349419,
    Mail: 0.06449930983376358,
    SearchOrganic: 0.32709975474183,
    SearchPaid: 0.15665853009866615,
    Direct: 0.2893418397917854,
  },
};

describe("trafficDomain", () => {
  it("reduces any URL form the workspace stores to the hostname the actor wants", () => {
    expect(trafficDomain("https://www.Patagonia.com/shop?x=1")).toBe("patagonia.com");
    expect(trafficDomain("patagonia.com")).toBe("patagonia.com");
    expect(trafficDomain("www.patagonia.com/")).toBe("patagonia.com");
    expect(trafficDomain("")).toBe("");
  });
});

describe("normaliseTraffic", () => {
  it("reads a live item into visits, a chronological series and channel shares", () => {
    const traffic = normaliseTraffic(patagoniaItem);
    expect(traffic).not.toBeNull();
    if (!traffic) return;

    // `visits` arrives as a string from the actor and must still land as a number.
    expect(traffic.visits).toBe(10435813);
    expect(traffic.domain).toBe("patagonia.com");

    // Oldest first, so the chart draws left to right without the caller sorting.
    expect(traffic.series.map((point) => point.label)).toEqual([
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
    ]);
    expect(traffic.series.map((point) => point.sortOrder)).toEqual(
      [...traffic.series.map((point) => point.sortOrder)].sort((a, b) => a - b),
    );

    // Growth is against the previous month: 7479613 → 10435813.
    expect(traffic.visitsChange).toBe(39.5);

    // Fractions become percentages, largest first.
    expect(traffic.channels[0]).toEqual({ label: "Search organic", share: 32.71 });
    expect(traffic.channels.some((channel) => channel.label === "Social paid")).toBe(true);
  });

  it("treats a domain with no figure as unknown, not as zero visits", () => {
    // "SimilarWeb has nothing for this site" and "this site had no visitors" are
    // different facts; storing 0 would report the second while meaning the first.
    expect(normaliseTraffic({ domain: "brand-new.example" })).toBeNull();
    expect(normaliseTraffic({ domain: "brand-new.example", visits: "0" })).toBeNull();
  });

  it("leaves the change at 0 when there is only one month to compare", () => {
    const traffic = normaliseTraffic({
      domain: "one.example",
      visits: "500",
      estimatedMonthlyVisits: { "2026-08-01": 500 },
    });
    expect(traffic?.visitsChange).toBe(0);
  });
});

describe("byDomain", () => {
  it("keys usable items by domain and drops the rest", () => {
    const found = byDomain([patagoniaItem, { domain: "unknown.example" }, {} as never]);
    expect([...found.keys()]).toEqual(["patagonia.com"]);
  });
});

/** `count` consecutive months, labelled the way the provider labels them. */
function monthSeries(count: number, startYear = 2024, startMonth = 1) {
  const points: { label: string; value: number; sortOrder: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const absolute = startMonth - 1 + i;
    const year = startYear + Math.floor(absolute / 12);
    const month = (absolute % 12) + 1;
    points.push({
      label: `${year}-${String(month).padStart(2, "0")}-01`,
      value: 1_000 + i,
      sortOrder: year * 12 + month,
    });
  }
  return points;
}

describe("seriesRestatement", () => {
  it("restates the months the provider returned and keeps the ones it did not", () => {
    const stored = monthSeries(3, 2026, 6);
    const incoming = [
      { label: "2026-08-01", value: 500, sortOrder: 2026 * 12 + 8 },
      { label: "2026-09-01", value: 600, sortOrder: 2026 * 12 + 9 },
      { label: "2026-10-01", value: 700, sortOrder: 2026 * 12 + 10 },
    ];

    const plan = seriesRestatement(stored, incoming);

    // The re-read month is rewritten — not duplicated, not left with two values.
    expect(plan.dropLabels).toContain("2026-08-01");
    expect(plan.insert.map((point) => point.label)).toEqual([
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
    ]);
    // The months this run did not mention survive: that is the history a plain
    // replace used to throw away, pinning the chart at three bars forever.
    expect(plan.dropLabels).not.toContain("2026-06-01");
    expect(plan.dropLabels).not.toContain("2026-07-01");
  });

  it("ages the oldest months out once the window is full", () => {
    const stored = monthSeries(24);
    const incoming = stored.slice(-3);

    const plan = seriesRestatement(stored, incoming, 12);

    const survivors = [
      ...stored.filter((point) => !plan.dropLabels.includes(point.label)).map((point) => point.label),
      ...plan.insert.map((point) => point.label),
    ];
    expect(new Set(survivors).size).toBe(SERIES_WINDOW);
    // The newest month is still there; the oldest is what aged out.
    expect(survivors).toContain("2025-12-01");
    expect(survivors).not.toContain("2024-01-01");
  });

  it("never stores more than the window, however much the provider returns", () => {
    const incoming = monthSeries(15, 2026, 1);

    const plan = seriesRestatement([], incoming);

    expect(plan.insert).toHaveLength(SERIES_WINDOW);
    // The window keeps the newest points, not the first ones it saw.
    expect(plan.insert.at(-1)?.label).toBe(incoming.at(-1)?.label);
  });
});

/** The smallest stand-in for the service-role client that `writeSeries` uses. */
type Row = Record<string, any>;

function fakeDb(store: { my_metrics: Row[]; competitor_metrics: Row[] }) {
  return {
    from(table: string) {
      const rows = (store as Record<string, Row[]>)[table] ?? [];
      const filters: ((row: Row) => boolean)[] = [];
      let action: "select" | "delete" | "insert" = "select";
      let payload: Row | Row[] | null = null;

      const api: any = {
        select: () => api,
        delete: () => {
          action = "delete";
          return api;
        },
        insert: (values: Row | Row[]) => {
          action = "insert";
          payload = values;
          return api;
        },
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return api;
        },
        in: (column: string, list: unknown[]) => {
          filters.push((row) => list.includes(row[column]));
          return api;
        },
        then: (resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) => {
          if (action === "insert") {
            const list = Array.isArray(payload) ? payload : [payload ?? {}];
            rows.push(...list.map((row) => ({ id: crypto.randomUUID(), ...row })));
            return Promise.resolve({ data: list, error: null }).then(resolve, reject);
          }
          const matched = rows.filter((row) => filters.every((filter) => filter(row)));
          if (action === "delete") {
            for (const row of matched) rows.splice(rows.indexOf(row), 1);
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  } as any;
}

describe("writeSeries", () => {
  it("accumulates months across runs instead of resetting to this run's payload", async () => {
    const store = { my_metrics: [] as Row[], competitor_metrics: [] as Row[] };
    const db = fakeDb(store);

    await writeSeries(db, "my_metrics", "biz-1", null, "traffic", monthSeries(3, 2026, 6));
    // The next run reports two fresh months and re-reads one of the old ones.
    await writeSeries(db, "my_metrics", "biz-1", null, "traffic", [
      { label: "2026-08-01", value: 999, sortOrder: 2026 * 12 + 8 },
      { label: "2026-09-01", value: 888, sortOrder: 2026 * 12 + 9 },
    ]);

    const labels = store.my_metrics.map((row) => row.label);
    expect(labels).toEqual(["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"]);
    // The re-read month carries the new value once — a merge that left the old
    // row behind would draw two bars for August.
    const august = store.my_metrics.find((row) => row.label === "2026-08-01");
    expect(august?.value).toBe(999);
    expect(store.my_metrics.filter((row) => row.label === "2026-08-01")).toHaveLength(1);
    expect(store.my_metrics.every((row) => row.kind === "traffic")).toBe(true);

    // As the provider's own window rolls on, the series keeps growing: this is
    // the mechanism that takes a chart off the three bars it used to be pinned at.
    await writeSeries(db, "my_metrics", "biz-1", null, "traffic", [
      { label: "2026-10-01", value: 1_100, sortOrder: 2026 * 12 + 10 },
      { label: "2026-11-01", value: 1_200, sortOrder: 2026 * 12 + 11 },
    ]);
    expect(store.my_metrics.map((row) => row.label)).toEqual([
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
      "2026-11-01",
    ]);
  });

  it("touches only the kind it was asked to write", async () => {
    const store = {
      my_metrics: [
        { id: "mix", business_id: "biz-1", kind: "channel", label: "Direct", value: 40, sort_order: 0 },
      ] as Row[],
      competitor_metrics: [] as Row[],
    };
    const db = fakeDb(store);

    await writeSeries(db, "my_metrics", "biz-1", null, "traffic", monthSeries(2, 2026, 9));

    expect(store.my_metrics.some((row) => row.kind === "channel")).toBe(true);
    expect(store.my_metrics.filter((row) => row.kind === "traffic")).toHaveLength(2);
  });

  it("writes a rival's series under that rival, not the workspace's", async () => {
    const store = { my_metrics: [] as Row[], competitor_metrics: [] as Row[] };
    const db = fakeDb(store);

    await writeSeries(db, "competitor_metrics", "biz-1", "comp-1", "traffic", monthSeries(2, 2026, 9));

    expect(store.competitor_metrics).toHaveLength(2);
    expect(store.competitor_metrics.every((row) => row.competitor_id === "comp-1")).toBe(true);
    expect(store.my_metrics).toHaveLength(0);
  });
});

describe("configuration", () => {
  it("reports the feature as off until the actor id is set", () => {
    // An unset id means "this deployment has not opted in", and the gate is what
    // keeps the panel from calling the feature configured while it bills nothing.
    expect(trafficActorId()).toBe("");
    denoEnv.set("APIFY_TRAFFIC_ACTOR_ID", "yOYYzj2J5K88boIVO");
    expect(trafficActorId()).toBe("yOYYzj2J5K88boIVO");
  });

  it("defaults the caps and honours a configured ceiling", () => {
    expect(trafficMaxDomains()).toBe(12);
    expect(trafficMaxChargeUsd()).toBe(0.25);

    denoEnv.set("APIFY_TRAFFIC_MAX_DOMAINS", "4");
    denoEnv.set("APIFY_TRAFFIC_MAX_CHARGE_USD", "0.1");
    expect(trafficMaxDomains()).toBe(4);
    expect(trafficMaxChargeUsd()).toBe(0.1);

    // A zero or nonsense ceiling falls back rather than disabling the guard.
    denoEnv.set("APIFY_TRAFFIC_MAX_CHARGE_USD", "0");
    expect(trafficMaxChargeUsd()).toBe(0.25);
  });
});
