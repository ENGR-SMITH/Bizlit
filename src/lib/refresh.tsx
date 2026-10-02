import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useWorkspace } from "./workspace";

/**
 * How long a pull-to-refresh stays satisfied.
 *
 * One pull runs three workspace-wide scans **and** one catalogue read per watched
 * source, every one of them billed, so the cap is what keeps an idle drag from
 * re-running the whole sweep: inside the window the gesture reports the workspace
 * as current instead of calling any provider.
 *
 * Ten minutes, deliberately short: a catalogue crawl is a couple of minutes' work,
 * so a longer window left the page showing a stale shelf for most of the time
 * between reads, and the scans are cheap enough that the spend this rations is
 * small. Ten is short enough that someone who has just changed something on a
 * watched site can pull it through in the same sitting, while still keeping an
 * idle drag from re-running the whole sweep. The cap is the only pacing there is —
 * no cron runs these.
 *
 * It gates **starting** work, not finishing it. A catalogue crawl that outlives the
 * pull's wait is billed at the moment it starts and collected later, so a pull that
 * finds one waiting collects it even inside the window — see `pull`.
 */
export const PULL_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/** Stored, so refreshing the browser tab does not hand back a free sweep. */
const STORAGE_KEY = "workspace:pull-refresh-at";

/**
 * How many catalogue reads one pull may have in flight at once.
 *
 * Every site read is an Apify actor job, and the account caps how many may run
 * together (five on the plan this deployment runs on) as well as how much memory
 * they may hold at once. The three workspace-wide scans start at the same time
 * and one of them — `social-scan` — is itself an actor job, so the site reads have
 * to stay under the cap rather than sit beside it.
 *
 * Firing one read per watched source was the old behaviour, and on a workspace
 * with ten competitors that is ten jobs at once: the account refuses all but the
 * first few, and each refusal surfaces as an error on that source while writing
 * nothing.
 *
 * Two, not three, since the traffic read joined the sweep: `social-scan`
 * contributes up to two jobs of its own and `traffic-scan` one, and the plan this
 * deployment runs on allows five running together. Three site reads beside those
 * is a sixth job, and the account refuses it — which shows up as a source that
 * failed to read rather than as a busy account. Two also stays inside the memory
 * ceiling: 2 x 4GB, the default a page crawler asks for, of the 16GB a free-plan
 * account may hold at once.
 */
const SITE_SCAN_CONCURRENCY = 2;

/** How one batch of scans ended, of those attempted. */
export interface ScanTally {
  /** Scans that answered with a result. */
  ran: number;
  /** Scans the pull asked for. */
  attempted: number;
}

/** What one pull did, so the caller can word its own report. */
export type PullOutcome =
  | {
      status: "refreshed";
      /**
       * `sweep` is the whole refresh. `collect` is the smaller pull made when the
       * window has not passed yet but a crawl is waiting to be read back: it starts
       * nothing and touches only those sources.
       */
      mode: "sweep" | "collect";
      /**
       * The workspace-wide scans (search, social, benchmark, reviews). Empty when
       * collecting.
       */
      live: ScanTally;
      /** The per-source catalogue reads on the Competition page. */
      site: ScanTally;
      /** Catalogue crawls still working; the next pull collects them. */
      running: number;
      /** Calls that refused or errored. */
      failed: number;
      /**
       * The first failure in the pull's own words, for the toast. A count on its
       * own ("3 failed") tells the user nothing they can act on: the gateway's
       * message names the missing configuration, the empty keyword list, or the
       * budget that stopped it.
       */
      error?: string;
    }
  | { status: "capped"; lastRefreshedAt: string }
  | { status: "busy" };

/**
 * How a batch of settled scan promises ended.
 *
 * A fulfilled promise is not the same as a scan that ran. `site-scan` answers 200
 * with `status: "running"` when a crawl outlives our wait — it is collected on the
 * next pull, and the money is already spent — with `status: "unavailable"` when
 * this deployment has no actor id for that target, and with `status: "failed"`
 * when it did the work and the result was not usable. Counting any of them as "ran"
 * would report work that never happened.
 *
 * The first failure is kept as a sentence rather than a number: the count alone
 * cannot tell the user that the benchmark refused because no keyword is tracked.
 */
function tally(results: PromiseSettledResult<unknown>[]): {
  ran: number;
  running: number;
  failed: number;
  error: string;
} {
  let ran = 0;
  let running = 0;
  let failed = 0;
  let error = "";

  /** Keeps the first explanation; one pull can fail several ways at once. */
  const remember = (message: unknown) => {
    const text = typeof message === "string" ? message.trim() : "";
    if (error || !text) return;
    error = text;
  };

  for (const result of results) {
    if (result.status === "rejected") {
      failed += 1;
      remember(result.reason instanceof Error ? result.reason.message : result.reason);
      continue;
    }
    const body =
      result.value && typeof result.value === "object"
        ? (result.value as { status?: unknown; reason?: unknown; error?: unknown })
        : null;
    const status = body ? String(body.status ?? "") : "";
    if (status === "running") running += 1;
    else if (status === "unavailable") continue;
    else if (status === "failed") {
      failed += 1;
      remember(body?.reason ?? body?.error);
    } else ran += 1;
  }

  return { ran, running, failed, error };
}

/**
 * Runs `task` over `items` with at most `limit` in flight, and resolves with the
 * settled results in input order — never rejecting, so a read that is refused
 * cannot abandon the reads still queued behind it.
 */
async function mapSettled<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;

  const worker = async () => {
    // The bounds check and the increment are both synchronous, so two workers can
    // never claim the same slot even though each one awaits inside the loop.
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await task(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

interface RefreshContextValue {
  /** A pull is queueing scans and re-reading the workspace right now. */
  refreshing: boolean;
  /** When the last pull ran, or null before the first one. */
  lastRefreshedAt: string | null;
  pull: () => Promise<PullOutcome>;
}

const RefreshContext = createContext<RefreshContextValue | null>(null);

export function useRefresh(): RefreshContextValue {
  const ctx = useContext(RefreshContext);
  if (!ctx) throw new Error("useRefresh must be used inside a RefreshProvider");
  return ctx;
}

/** Reads the stored pull time, tolerating a blocked or absent localStorage. */
function readStoredPull(): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw && Number.isFinite(Date.parse(raw)) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * One refresh for the whole workspace, shared by every page that pulls.
 *
 * Competition and My Business read the same workspace, so they are refreshed by
 * the same call: there is no per-page reload to drift out of sync, and a pull on
 * one leaves the other already current.
 */
export function RefreshProvider({ children }: { children: ReactNode }) {
  const { data, actions, refresh } = useWorkspace();
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(readStoredPull);
  const [refreshing, setRefreshing] = useState(false);
  // A ref rather than the state: two releases in the same tick would both read a
  // stale `refreshing` and run the entire sweep twice.
  const running = useRef(false);

  const pull = useCallback(async (): Promise<PullOutcome> => {
    if (running.current) return { status: "busy" };

    const competitors = data?.competitors ?? [];
    /** Crawls already billed and not yet read back, so there is something to collect. */
    const waitingCompetitors = competitors.filter((competitor) => competitor.siteScanPending);
    const waiting = waitingCompetitors.length;

    const insideTheWindow =
      lastRefreshedAt !== null &&
      Date.now() - Date.parse(lastRefreshedAt) < PULL_REFRESH_INTERVAL_MS;

    if (insideTheWindow && !waiting) {
      return { status: "capped", lastRefreshedAt };
    }

    /** Inside the window with output waiting: read it back, start nothing new. */
    const collecting = insideTheWindow;

    running.current = true;
    setRefreshing(true);
    try {
      // Scans first, because re-reading on its own can only show what the last
      // scan produced. Seven live scans are workspace-wide (search, social, the
      // competitor benchmark, tracked reviews, website traffic, competitor
      // advertising and the derived buy list); the site reads are one per watched
      // source. Reviews joined the sweep when the Social & reviews page lost its
      // own "Scan reviews now" button: the gesture has to do what the button did,
      // or a workspace would have no way left to pull a review profile forward.
      //
      // A collecting pull skips the live scans entirely: those are the part the
      // window protects, and running them would bill a second sweep just to show a
      // dataset that is already sitting in Apify. The one read it can start is for a
      // source whose tracked run has expired at Apify — `site-scan` clears that
      // pointer and reads afresh rather than stranding the source on "checking…".
      const live = collecting
        ? []
        : [
            actions.runSerpScan(),
            actions.runSocialScan(),
            actions.runCompetitorBenchmark(),
            // Traffic, because these figures are the fastest-moving thing on the
            // page: a monthly visit count that is only ever as old as the last
            // manual visit reads as "not updating", which is exactly how this
            // looked while nothing wrote it at all.
            actions.runTrafficScan(),
            // And the ad library, for the same reason: an "active campaigns" count
            // is only meaningful if it is re-read, since campaigns start and stop
            // between visits.
            actions.runAdsScan(),
            // And the buy list, which reads no provider at all: it is derived from
            // the catalogue reads and tracked terms already on file, so it costs
            // nothing and is the one live scan that still works when a provider is
            // refusing us.
            actions.runBuyList(),
            // And the connected review pages, which the Social & reviews page used
            // to sync with a button of its own. It is a no-op when no profile is
            // connected, so a workspace that tracks no reviews pays nothing for it.
            actions.runReviewScan(),
          ];
      // One read per competitor, bounded rather than all at once: each is an actor
      // job, the account caps how many may run together, and a whole workspace fired
      // in parallel is refused. Each is still bounded by the same per-run page and
      // dollar caps, and the pull re-reads the workspace once at the end rather than
      // after every one of them.
      const siteReads = collecting
        ? waitingCompetitors.map((competitor) => () => actions.scanCompetitorSite(competitor.id))
        : competitors.map((competitor) => () => actions.scanCompetitorSite(competitor.id));

      const [liveSettled, siteSettled] = await Promise.all([
        Promise.allSettled(live),
        mapSettled(siteReads, SITE_SCAN_CONCURRENCY, (read) => read()),
      ]);
      const liveOutcome = tally(liveSettled);
      const siteOutcome = tally(siteSettled);

      // Stamped before the re-read, and on purpose: the provider spend has already
      // happened by now, so a reload that then fails must not hand the user a free
      // retry that bills every source a second time.
      //
      // A collection is not stamped: it started nothing, and moving the clock would
      // push the next real sweep a whole window further out every time a crawl arrives.
      if (!collecting) {
        const at = new Date().toISOString();
        setLastRefreshedAt(at);
        try {
          window.localStorage.setItem(STORAGE_KEY, at);
        } catch {
          // A blocked localStorage only costs the cap its persistence.
        }
      }

      // Silent, so the pages keep the version on screen while this lands — and it
      // is what actually puts the scans' writes on screen.
      await refresh({ silent: true });
      return {
        status: "refreshed",
        mode: collecting ? "collect" : "sweep",
        live: { ran: liveOutcome.ran, attempted: live.length },
        site: { ran: siteOutcome.ran, attempted: siteReads.length },
        running: siteOutcome.running,
        failed: liveOutcome.failed + siteOutcome.failed,
        // The catalogue reads are the ones the user just asked to collect, so
        // their reason is the one worth naming when both halves failed.
        error: siteOutcome.error || liveOutcome.error || undefined,
      };
    } finally {
      running.current = false;
      setRefreshing(false);
    }
  }, [actions, data, lastRefreshedAt, refresh]);

  const value = useMemo<RefreshContextValue>(
    () => ({ refreshing, lastRefreshedAt, pull }),
    [refreshing, lastRefreshedAt, pull],
  );

  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}
