import { useState } from "react";
import {
  BarChart3,
  Bot,
  CheckCircle2,
  Download,
  FileText,
  Globe2,
  Lightbulb,
  MapPin,
  Plus,
  Search,
  ShoppingCart,
  Sparkles,
  Target,
  TrendingUp,
  XCircle,
} from "lucide-react";
import {
  Badge,
  Card,
  CardHead,
  EmptyState,
  ScoreRing,
  Segmented,
  Tabs,
  Td,
  Th,
  btnGhost,
  btnPrimary,
  inputClass,
} from "../components/primitives";
import { BarChart, BarList, DeltaPill } from "../components/charts";
import { MetricTile, ScoreRadialCard, TrafficTrendCard } from "../components/insights";
import { Modal } from "../components/Modal";
import { useActionToast, useToast } from "../components/Toast";
import { compact, money, relativeTime, titleCase } from "../lib/format";
import type { KeywordCluster, KeywordIdea, SearchDevice } from "../lib/types";
import { useWorkspace, useWorkspaceData } from "../lib/workspace";

type BusinessTab = "overview" | "search" | "local" | "stock";

/** Percent change that survives a missing previous value. */
function deltaPct(current: number, previous: number): number {
  if (!previous) return 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

/**
 * How the covered-terms count moved since the previous scan, or "" when it did not.
 *
 * A count is stated in terms rather than percent — "up 2 terms" — because a jump
 * from 1 to 3 is not a 200% improvement of anything a user reads, and the scan's
 * own wording should not imply precision the number does not have.
 */
function termsMoved(delta: number): string {
  if (!delta) return "";
  const noun = Math.abs(delta) === 1 ? "term" : "terms";
  return ` — ${delta > 0 ? "up" : "down"} ${Math.abs(delta)} ${noun} since the last scan`;
}

function downloadText(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function BusinessPage() {
  const toast = useToast();
  const actionToast = useActionToast();
  const workspace = useWorkspaceData();
  const { actions, mode } = useWorkspace();

  const {
    metrics: myBusiness,
    profile,
    inventoryRecommendations,
    topSeoKeywords,
    topGeoKeywords,
    serpRankings,
    localPackRankings,
    localProfileHealth,
    keywordIdeas,
    shareOfVoice,
    geoVisibility,
    weeklyReports,
    buyList,
    // Needed for what "Industry rank" is measured against: the tracked set.
    competitors,
  } = workspace;

  const [tab, setTab] = useState<BusinessTab>("overview");
  const [inventoryFilter, setInventoryFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [device, setDevice] = useState<SearchDevice>("desktop");
  const [ideaOpen, setIdeaOpen] = useState(false);
  const [ideaSeed, setIdeaSeed] = useState("");
  const [ideas, setIdeas] = useState<KeywordIdea[] | null>(null);
  const [ideasLoading, setIdeasLoading] = useState(false);
  /** Themes the current suggestions were grouped into; empty until asked. */
  const [clusters, setClusters] = useState<KeywordCluster[]>([]);
  const [clustering, setClustering] = useState(false);
  /** Building the buy list from what rivals have newly listed. */
  const [suggesting, setSuggesting] = useState(false);

  // One row per keyword for the chosen device, plus a keyword → pack lookup.
  const deviceRankings = serpRankings.filter((row) => row.device === device);
  const packByKeyword = new Map(localPackRankings.map((row) => [row.keyword, row]));
  const inPackCount = localPackRankings.filter((row) => row.inPack).length;
  const richCount = deviceRankings.filter((row) => row.isRichResult).length;
  // Share of Voice is the same for the tenant across competitors; take the first row.
  const sov = shareOfVoice[0];

  async function findIdeas() {
    const seed = ideaSeed.trim();
    if (seed.length < 2) {
      toast("Type at least two characters to search for ideas.");
      return;
    }
    setIdeasLoading(true);
    try {
      const found = await actions.findKeywordIdeas(seed);
      // A new seed means the old grouping no longer describes what is on screen.
      setClusters([]);
      setIdeas(found.length ? found : keywordIdeas.filter((idea) => idea.seed === seed));
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "Keyword ideas could not be loaded.");
      setIdeas([]);
    } finally {
      setIdeasLoading(false);
    }
  }

  /**
   * Groups the suggestions we are showing into intent themes.
   *
   * Safe to call on a list that is not saved yet: the gateway refuses when it
   * cannot find the seed's suggestions, and that refusal is what the toast says.
   */
  async function groupIdeas() {
    const seed = ideaSeed.trim();
    setClustering(true);
    try {
      const result = await actions.clusterKeywordIdeas(seed);
      if (!result) {
        toast("AI drafting is not configured — add GROQ_API_KEY to the function secrets.");
        return;
      }
      setClusters(result.clusters);
      // Mirror the labels the gateway just wrote, so a "Tracked" row keeps its
      // theme after the page reloads.
      setIdeas((prev) =>
        prev
          ? prev.map((idea) => {
              const cluster = result.clusters.find((entry) =>
                entry.keywords.some(
                  (keyword) => keyword.toLowerCase() === idea.suggestion.toLowerCase(),
                ),
              );
              return { ...idea, cluster: cluster?.name ?? "" };
            })
          : prev,
      );
      toast(`Grouped into ${result.clusters.length} theme${result.clusters.length === 1 ? "" : "s"}.`);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "Those keywords could not be grouped.");
    } finally {
      setClustering(false);
    }
  }

  /** One suggestion row, shared by the flat list and the grouped view. */
  function ideaRow(idea: KeywordIdea) {
    return (
      <li key={idea.id} className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium text-slate-800">
            {idea.suggestion}
          </span>
          <span className="text-[10px] text-slate-500">
            relevance {idea.relevance} · {idea.source}
          </span>
        </span>
        {idea.savedAsKeyword ? (
          <Badge tone="good">Tracked</Badge>
        ) : (
          <button type="button" className={btnGhost} onClick={() => void trackIdea(idea)}>
            <Plus size={13} /> Track
          </button>
        )}
      </li>
    );
  }

  /**
   * Rebuilds the buy list from the competitor catalogue we already hold.
   *
   * No provider is called: the suggestions are derived from what each rival has
   * newly listed, matched against the tracked terms. The gateway skips anything
   * already on file, so pressing this twice adds nothing the second time.
   */
  async function findSuggestions() {
    setSuggesting(true);
    try {
      const result = await actions.runBuyList();
      if (!result) {
        toast("Buy-list suggestions need a live workspace.");
        return;
      }
      toast(result.message ?? result.reason ?? "Buy list updated.");
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "Suggestions could not be built.");
    } finally {
      setSuggesting(false);
    }
  }

  async function trackIdea(idea: KeywordIdea) {
    try {
      await actions.saveKeywordIdea(idea);
      setIdeas((prev) =>
        prev ? prev.map((row) => (row.id === idea.id ? { ...row, savedAsKeyword: true } : row)) : prev,
      );
      toast(`“${idea.suggestion}” added to your tracked keywords.`);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "That keyword could not be saved.");
    }
  }

  const seoDelta = deltaPct(myBusiness.seoScore, myBusiness.previousSeoScore);
  const geoDelta = deltaPct(myBusiness.geoScore, myBusiness.previousGeoScore);
  // "Cited" is a GEO row with a position: the answer named us or linked a page.
  const geoCited = topGeoKeywords.filter((keyword) => keyword.position >= 1).length;
  const industryDelta = myBusiness.industryRankPrevious - myBusiness.industryRank;
  // The health card's search figures come from `serp-scan`, which derives them from
  // the rankings it stores. Worded against the previous scan, so a number is never
  // shown without what it moved from — and a workspace that has never been scanned
  // says so instead of showing the same figure twice.
  const top10Movement = termsMoved(profile.top10Count - profile.previousTop10Count);
  const averagePositionMoved =
    profile.avgPosition && profile.previousAvgPosition !== profile.avgPosition
      ? ` (was ${profile.previousAvgPosition})`
      : "";
  const rankingsChecked = profile.rankingsCheckedAt
    ? ` · checked ${relativeTime(profile.rankingsCheckedAt)}`
    : " · not scanned yet";

  const recommendations = inventoryRecommendations.filter((r) =>
    inventoryFilter === "all" ? true : r.priority === inventoryFilter,
  );

  function downloadReport() {
    const report = weeklyReports[0];
    if (!report) {
      toast("No weekly report has been generated yet — the first one lands after your first scan.");
      return;
    }
    downloadText(
      `weekly-seo-geo-report-${new Date().toISOString().slice(0, 10)}.txt`,
      [
        `${profile.brandName} — SEO & GEO weekly report`,
        report.week,
        "",
        `SEO score: ${report.seoScore} (prev ${myBusiness.previousSeoScore || "n/a"})`,
        `GEO score: ${report.geoScore} (prev ${myBusiness.previousGeoScore || "n/a"})`,
        `Visits: ${report.visits.toLocaleString()}`,
        `Conversions: ${report.conversions.toLocaleString()}`,
        `Industry rank: #${myBusiness.industryRank || "unranked"} (moved ${industryDelta})`,
        "",
        `Highlight: ${report.highlight}`,
        "",
        "Actions for next week:",
        ...report.actions.map((a, i) => `${i + 1}. ${a}`),
        "",
        "Top SEO keywords:",
        ...topSeoKeywords
          .slice(0, 5)
          .map(
            (k) =>
              `  ${k.position === null ? "not ranked" : `#${k.position}`} ${k.keyword} (${k.volume.toLocaleString()} searches)`,
          ),
        "",
        "Top GEO prompts:",
        ...topGeoKeywords
          .slice(0, 5)
          .map((k) => `  #${k.position} "${k.prompt}" via ${k.engine}`),
      ].join("\n"),
    );
    toast("Weekly SEO & GEO report downloaded.");
  }

  function exportBuyList() {
    const rows = recommendations.map((r) =>
      [
        r.product,
        r.category,
        r.suggestedQty,
        r.estimatedPrice,
        r.marginPct,
        r.trafficPotential,
        r.priority,
        r.competitorRef,
      ].join(","),
    );
    downloadText(
      `inventory-to-buy-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "product,category,qty,est_price,margin_pct,traffic_potential,priority,competitor",
        ...rows,
      ].join("\n"),
    );
    toast("Buy list exported.");
  }

  /**
   * The suggestions in each theme, plus whatever was left out.
   *
   * Derived from the rows on screen rather than from the cluster response, so
   * every suggestion appears exactly once: a theme can never repeat a row, and
   * one the model did not place stays visible under "Not grouped" instead of
   * disappearing the moment the list is grouped.
   */
  const groupedIdeas = (() => {
    if (!ideas || !clusters.length) return null;
    const claimed = new Set<string>();
    const groups = clusters
      .map((cluster) => ({
        name: cluster.name,
        intent: cluster.intent,
        ideas: ideas.filter((idea) => {
          const key = idea.suggestion.toLowerCase();
          if (claimed.has(key)) return false;
          if (!cluster.keywords.some((keyword) => keyword.toLowerCase() === key)) return false;
          claimed.add(key);
          return true;
        }),
      }))
      .filter((group) => group.ideas.length);

    const rest = ideas.filter((idea) => !claimed.has(idea.suggestion.toLowerCase()));
    if (rest.length) groups.push({ name: "Not grouped", intent: "", ideas: rest });
    return groups;
  })();

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ScoreRadialCard
          label="SEO score"
          value={myBusiness.seoScore}
          icon={<Search size={16} />}
          color="var(--chart-1)"
          hint={
            <span className="flex items-center gap-2">
              {seoDelta >= 0 ? `+${seoDelta}%` : `${seoDelta}%`}
              <span className="text-xs font-normal text-muted-foreground">
                {myBusiness.previousSeoScore
                  ? `was ${myBusiness.previousSeoScore} at the last scan`
                  : "first baseline pending"}
              </span>
            </span>
          }
        />
        <ScoreRadialCard
          label="GEO / AI visibility"
          value={myBusiness.geoScore}
          icon={<Bot size={16} />}
          color="var(--chart-3)"
          hint={
            <span className="flex items-center gap-2">
              {geoDelta >= 0 ? `+${geoDelta}%` : `${geoDelta}%`}
              <span className="text-xs font-normal text-muted-foreground">
                of your tracked terms cite you
              </span>
            </span>
          }
        />
        <TrafficTrendCard
          className="sm:col-span-2 xl:col-span-2"
          label="Website traffic"
          points={myBusiness.traffic}
          total={myBusiness.monthlyVisits}
          changePct={myBusiness.visitsChange}
          icon={<BarChart3 size={16} />}
          caption="Estimated visits in the latest month"
        />
        <MetricTile
          className="sm:col-span-2 xl:col-span-4"
          label="Industry rank"
          value={myBusiness.industryRank ? `#${myBusiness.industryRank}` : "—"}
          icon={<TrendingUp size={16} />}
          // Says what it is measured against. The old wording — "up N places in
          // your industry" — described a movement in a column no scan wrote, so
          // the figure it explained was always absent.
          hint={
            myBusiness.industryRank
              ? `of ${competitors.length + 1} you track, by measured monthly visits${
                  industryDelta ? ` · ${industryDelta > 0 ? "up" : "down"} ${Math.abs(industryDelta)}` : ""
                }`
              : "ranked once your monthly traffic is measured"
          }
        />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "overview", label: "Overview", icon: <TrendingUp size={13} /> },
          {
            value: "search",
            label: "SEO & GEO",
            icon: <Search size={13} />,
            count: topSeoKeywords.length + topGeoKeywords.length,
          },
          {
            value: "local",
            label: "Local",
            icon: <MapPin size={13} />,
            count: localPackRankings.length,
          },
          {
            value: "stock",
            label: "Buy list",
            icon: <ShoppingCart size={13} />,
            count: buyList.length,
          },
        ]}
      />

      {tab === "overview" ? (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card>
            <CardHead
              icon={<Sparkles size={16} />}
              title="Search & AI visibility health"
              // Domain authority and indexed pages have no producer — the columns
              // are null — so printing them as "0" read as measured zeros on the
              // same card as the scores that *are* measured. They are named only
              // when something has actually filled them.
              subtitle={[
                profile.primaryDomain || "your domain",
                myBusiness.domainAuthority ? `domain authority ${myBusiness.domainAuthority}` : "",
                myBusiness.indexedPages ? `${myBusiness.indexedPages.toLocaleString()} pages` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            />
            <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-xl bg-slate-50 p-3">
                <ScoreRing score={myBusiness.seoScore} label="SEO score" tone="good" />
                <p className="mt-2 text-[11px] text-slate-600">
                  Ranking for {profile.top10Count} of {topSeoKeywords.length} tracked terms in the
                  top 10{top10Movement}.
                </p>
                <p className="mt-1 text-[11px] text-slate-600">
                  {/* Backlinks have no producer either, so the count is shown only
                      when it exists — never as a bare "0 backlinks". */}
                  {myBusiness.backlinks ? `${myBusiness.backlinks} backlinks · ` : ""}
                  average position {profile.avgPosition ? profile.avgPosition : "—"}
                  {averagePositionMoved}
                  {rankingsChecked}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <ScoreRing score={myBusiness.geoScore} label="GEO score" tone="warn" />
                <p className="mt-2 text-[11px] text-slate-600">
                  {/* Read from the GEO rows themselves. This used to be worded off
                      `topServers` — the *search surface* series, which nothing
                      writes — so the live "cited in X of Y" figure could never
                      appear however well the AI-overview pass had done. */}
                  {geoCited
                    ? `Cited in ${geoCited} of ${topGeoKeywords.length} AI answer${topGeoKeywords.length === 1 ? "" : "s"} checked.`
                    : topGeoKeywords.length
                      ? `Not cited in any of the ${topGeoKeywords.length} AI answers checked yet.`
                      : "No AI answer checked yet — the GEO pass runs with your keyword scan."}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {/* What the ring measures, now that it is coverage over every
                      scanned term rather than a ratio over whichever overviews we
                      managed to read. */}
                  Scored across every tracked term the scan checked for an AI answer —
                  a term the answer leaves you out of scores nothing, and a term whose
                  answer the monthly budget stopped us reading counts as not cited
                  rather than being dropped — and a listed source counts for more than
                  a passing mention in the prose.
                </p>
              </div>
            </div>
            <div className="border-t border-slate-100 px-4 py-3">
              <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                AI answer visibility trend
              </p>
              <BarChart
                data={geoVisibility}
                color="#0d9488"
                valueFormat={(n) => `${n}/100`}
                height={110}
              />
            </div>
          </Card>

          <Card className="xl:col-span-2">
            <CardHead
              icon={<Globe2 size={16} />}
              title="Traffic on your platform"
              subtitle="Estimated monthly visits and the channels they came through"
            />
            <div className="grid gap-5 px-4 py-4 md:grid-cols-2">
              <div>
                {myBusiness.traffic.length ? (
                  <BarChart data={myBusiness.traffic} color="#4f46e5" />
                ) : (
                  <p className="py-6 text-center text-[11px] text-slate-500">
                    No traffic series yet — run a refresh to read your visits.
                  </p>
                )}
                {/* Conversion is deliberately absent until something measures it:
                    no provider we hold reports it, and a stored 0 would read as
                    "nobody converts" rather than "nobody has looked". */}
                {myBusiness.conversionRate > 0 ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                    <span>Conversion rate {myBusiness.conversionRate}%</span>
                    <span>·</span>
                    <span>
                      {Math.round(
                        myBusiness.monthlyVisits * (myBusiness.conversionRate / 100),
                      ).toLocaleString()}{" "}
                      orders last month
                    </span>
                  </div>
                ) : (
                  <p className="mt-3 text-[11px] text-slate-500">
                    Visits are estimates. Conversion rate is not measured yet, so no order
                    count is shown.
                  </p>
                )}
              </div>
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Channels
                  </p>
                  {myBusiness.trafficSources.length ? (
                    <BarList
                      data={myBusiness.trafficSources.map((s) => ({ label: s.label, value: s.share }))}
                      valueFormat={(n) => `${n}%`}
                    />
                  ) : (
                    <p className="text-[11px] text-slate-500">No channel data yet.</p>
                  )}
                </div>
                {myBusiness.topServers.length ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                      Search surfaces
                    </p>
                    <BarList
                      data={myBusiness.topServers.map((s) => ({ label: s.name, value: s.share }))}
                      valueFormat={(n) => `${n}%`}
                      color="#0d9488"
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "search" ? (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHead
                icon={<Search size={16} />}
                title="Top ranking SEO keywords this week"
                subtitle="Live desktop position from your last Google scan, and the movement since the one before"
                action={<Badge tone="brand">{topSeoKeywords.length} tracked</Badge>}
              />
              {topSeoKeywords.length === 0 ? (
                <EmptyState
                  title="No keyword data yet"
                  hint="Your tracked terms appear after the first domain scan."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px]">
                    <thead className="bg-slate-50">
                      <tr>
                        <Th>Keyword</Th>
                        <Th className="text-right">Volume</Th>
                        <Th className="text-center">Position</Th>
                        <Th className="text-right">Change</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {topSeoKeywords.map((k) => (
                        <tr key={k.keyword} className="hover:bg-slate-50/70">
                          <Td className="font-medium text-slate-900">{k.keyword}</Td>
                          <Td className="text-right">{k.volume.toLocaleString()}</Td>
                          <Td className="text-center">
                            {k.position === null ? (
                              // Could be "not ranked" or "not scanned yet" — either way
                              // we have no position to show.
                              <Badge tone="neutral">Not ranked</Badge>
                            ) : (
                              <Badge
                                tone={k.position <= 3 ? "good" : k.position <= 10 ? "info" : "warn"}
                              >
                                #{k.position}
                              </Badge>
                            )}
                          </Td>
                          <Td className="text-right">
                            <DeltaPill value={k.change} suffix=" pos" />
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card>
              <CardHead
                icon={<Bot size={16} />}
                title="AI answers for your tracked terms"
                subtitle="Google's AI Overview, and whether it cites you"
                action={<Badge tone="brand">{topGeoKeywords.length} checked</Badge>}
              />
              {topGeoKeywords.length === 0 ? (
                <EmptyState
                  title="No AI answer checked yet"
                  hint="Your tracked terms are checked for a Google AI Overview on every scan."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px]">
                    <thead className="bg-slate-50">
                      <tr>
                        <Th>Term</Th>
                        <Th>Answer engine</Th>
                        <Th className="text-center">In the answer</Th>
                        <Th className="text-right">Sources cited</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {topGeoKeywords.map((k) => (
                        <tr key={k.prompt} className="hover:bg-slate-50/70">
                          <Td className="font-medium text-slate-900">"{k.prompt}"</Td>
                          <Td className="text-xs text-slate-600">{k.engine}</Td>
                          <Td className="text-center">
                            {k.position >= 1 ? (
                              <Badge tone="good">Cited</Badge>
                            ) : (
                              <Badge tone="neutral">Not cited</Badge>
                            )}
                          </Td>
                          <Td className="text-right text-xs text-slate-500">{k.sources}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
                “Cited” means the answer named you or linked one of your pages. A term Google
                answered without an AI Overview is listed as “no answer”. This reads Google's
                AI Overview only — no other assistant is claimed.
              </div>
            </Card>
          </div>

          <Card>
            <CardHead
              icon={<FileText size={16} />}
              title="SEO & GEO weekly report"
              subtitle="What changed, what it cost you and what to do next week"
              action={
                <button type="button" className={btnGhost} onClick={downloadReport}>
                  <Download size={14} /> Download report
                </button>
              }
            />
            {weeklyReports.length === 0 ? (
              <EmptyState
                title="No weekly report yet"
                hint="Your first SEO & GEO report is generated after the domain scan completes."
              />
            ) : (
              <div className="grid gap-4 px-4 py-4 lg:grid-cols-3">
                {weeklyReports.map((r, i) => (
                  <div
                    key={r.week}
                    className={`rounded-xl border p-3 ${
                      i === 0 ? "border-indigo-200 bg-indigo-50/40" : "border-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-900">{r.week}</p>
                      {i === 0 ? <Badge tone="brand">Current</Badge> : null}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                      <span>SEO {r.seoScore}</span>
                      <span>GEO {r.geoScore}</span>
                      <span>{compact(r.visits)} visits</span>
                      <span>{r.conversions.toLocaleString()} orders</span>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-700">{r.highlight}</p>
                    <ul className="mt-2 space-y-1">
                      {r.actions.map((a) => (
                        <li key={a} className="flex gap-1.5 text-[11px] text-slate-600">
                          <Target size={11} className="mt-0.5 shrink-0 text-indigo-500" /> {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "local" ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <ScoreRadialCard
              label="Profile health"
              value={localProfileHealth?.score ?? 0}
              icon={<MapPin size={16} />}
              color="var(--chart-1)"
              hint={
                localProfileHealth
                  ? `${localProfileHealth.reviewsCount.toLocaleString()} reviews · ${localProfileHealth.averageRating.toFixed(1)} rating`
                  : "no Google listing scanned yet"
              }
            />
            <MetricTile
              label="In the map 3-pack"
              value={`${inPackCount}/${localPackRankings.length}`}
              icon={<Target size={16} />}
              hint="local keywords held"
            />
            <MetricTile
              label="Rich results"
              value={String(richCount)}
              icon={<Sparkles size={16} />}
              hint={`of ${deviceRankings.length} tracked terms`}
            />
            <MetricTile
              label="Tracked terms"
              value={String(deviceRankings.length)}
              icon={<Search size={16} />}
              hint={`${device} results`}
            />
            <MetricTile
              label="Share of voice"
              value={sov ? `${sov.ourShare}%` : "—"}
              icon={<Target size={16} />}
              hint={sov ? `top-10 share of ${sov.termCount} terms` : "run a competitor benchmark"}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
            <button
              type="button"
              className={btnGhost}
              onClick={() => {
                setIdeas(null);
                setIdeaOpen(true);
              }}
            >
              <Lightbulb size={14} /> Find keywords
            </button>
            <span className="ml-auto flex items-center gap-2">
              <span className="text-[11px] text-slate-500">Device</span>
              <Segmented
                size="sm"
                value={device}
                onChange={setDevice}
                options={[
                  { value: "desktop", label: "Desktop" },
                  { value: "mobile", label: "Mobile" },
                ]}
              />
            </span>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHead
                icon={<Search size={16} />}
                title="Google rankings on your platform"
                subtitle={`Organic position per tracked keyword · ${device} results`}
                action={<Badge tone="brand">{deviceRankings.length} terms</Badge>}
              />
              {deviceRankings.length === 0 ? (
                <EmptyState
                  title="No rankings yet"
                  hint="Run a scan to pull your live Google positions for the tracked keywords."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px]">
                    <thead className="bg-slate-50">
                      <tr>
                        <Th>Keyword</Th>
                        <Th className="text-center">Position</Th>
                        <Th>Rich result</Th>
                        <Th>Map 3-pack</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {deviceRankings.map((row) => {
                        const pack = packByKeyword.get(row.keyword);
                        return (
                          <tr key={`${row.keyword}-${row.device}`} className="hover:bg-slate-50/70">
                            <Td className="font-medium text-slate-900">{row.keyword}</Td>
                            <Td className="text-center">
                              {row.position === null ? (
                                <Badge tone="bad">Not in top 100</Badge>
                              ) : (
                                <Badge
                                  tone={row.position <= 3 ? "good" : row.position <= 10 ? "info" : "warn"}
                                >
                                  #{row.position}
                                </Badge>
                              )}
                            </Td>
                            <Td>
                              {row.isRichResult ? (
                                <Badge tone="good">{titleCase(row.snippetType || "rich")}</Badge>
                              ) : (
                                <span className="text-xs text-slate-400">none</span>
                              )}
                            </Td>
                            <Td>
                              {pack ? (
                                pack.inPack ? (
                                  <Badge tone="good">#{pack.packPosition} in pack</Badge>
                                ) : (
                                  <Badge tone="warn">not in pack</Badge>
                                )
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
                Positions and rich results come straight from Google. Last scan{" "}
                {localProfileHealth ? relativeTime(localProfileHealth.checkedAt) : "has not run yet"}.
              </div>
            </Card>

            <Card>
              <CardHead
                icon={<MapPin size={16} />}
                title="Google Business profile health"
                subtitle={
                  localProfileHealth
                    ? localProfileHealth.address || localProfileHealth.category
                    : "Your Maps listing"
                }
              />
              {!localProfileHealth ? (
                <EmptyState
                  title="No profile scanned yet"
                  hint="Run a scan to score your Google Business Profile and see what is missing."
                />
              ) : (
                <div className="space-y-3 px-4 py-4">
                  <ScoreRing
                    score={localProfileHealth.score}
                    label="Profile health"
                    tone={
                      localProfileHealth.score >= 70
                        ? "good"
                        : localProfileHealth.score >= 45
                          ? "warn"
                          : "bad"
                    }
                  />
                  <ul className="space-y-1.5">
                    {localProfileHealth.checks.map((check) => (
                      <li key={check.label} className="flex items-start gap-2 text-[11px]">
                        {check.ok ? (
                          <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-600" />
                        ) : (
                          <XCircle size={13} className="mt-0.5 shrink-0 text-rose-500" />
                        )}
                        <span className="min-w-0">
                          <span className="font-medium text-slate-700">{check.label}</span>
                          <span className="block text-slate-500">{check.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          </div>

          <Card>
            <CardHead
              icon={<Target size={16} />}
              title="Local map 3-pack tracker"
              subtitle="Who holds the pack for each local keyword, and where you sit"
            />
            {localPackRankings.length === 0 ? (
              <EmptyState
                title="Nothing tracked locally yet"
                hint="Run a scan to see which of your keywords put you in the map pack."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {localPackRankings.map((row) => (
                  <li key={`${row.keyword}-${row.location}`} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-900">{row.keyword}</span>
                      <span className="flex items-center gap-2">
                        {row.location ? (
                          <span className="text-[11px] text-slate-500">{row.location}</span>
                        ) : null}
                        {row.inPack ? (
                          <Badge tone="good">In the pack · #{row.packPosition}</Badge>
                        ) : (
                          <Badge tone="warn">Not in the pack</Badge>
                        )}
                      </span>
                    </div>
                    <ol className="mt-2 grid gap-1.5 sm:grid-cols-3">
                      {row.pack.map((entry) => {
                        const ours = Boolean(row.placeId) && entry.placeId === row.placeId;
                        return (
                          <li
                            key={`${row.keyword}-${entry.position}-${entry.name}`}
                            className={`rounded-lg px-2.5 py-1.5 text-[11px] ${
                              ours ? "bg-indigo-50 ring-1 ring-indigo-200" : "bg-slate-50"
                            }`}
                          >
                            <span className="font-medium text-slate-700">
                              #{entry.position} {entry.name}
                            </span>
                            <span className="block text-slate-500">
                              {entry.rating ? `${entry.rating.toFixed(1)}★` : "—"} ·{" "}
                              {entry.reviews.toLocaleString()} reviews
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
              The map 3-pack is the block of local businesses Google shows above the organic
              results. Holding a slot there is worth more than ranking first organically.
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "stock" ? (
        <Card>
          <CardHead
            icon={<ShoppingCart size={16} />}
            title="Inventory you should get next"
            // Says what it is actually built from. The old line named competitor
            // traffic and competitor price moves, neither of which this window ever
            // read — which is why it stayed empty in every workspace.
            subtitle="Built from what your rivals have newly listed, matched against your tracked terms"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  size="sm"
                  value={inventoryFilter}
                  onChange={setInventoryFilter}
                  options={[
                    { value: "all", label: "All" },
                    { value: "high", label: "High" },
                    { value: "medium", label: "Medium" },
                    { value: "low", label: "Low" },
                  ]}
                />
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={() => void findSuggestions()}
                  disabled={suggesting}
                >
                  <Sparkles size={14} />
                  {suggesting ? "Building…" : "Find suggestions"}
                </button>
                <button type="button" className={btnGhost} onClick={exportBuyList}>
                  <Download size={14} /> Export buy list
                </button>
              </div>
            }
          />
          {inventoryRecommendations.length === 0 ? (
            <EmptyState
              title="No suggestions yet"
              hint="They are built from what the rivals you track have newly listed. Add a competitor and run a catalogue scan on Competition, then refresh this page."
            />
          ) : recommendations.length === 0 ? (
            <EmptyState title="Nothing at this priority" hint="Switch the priority filter." />
          ) : (
            <div className="grid gap-4 px-4 py-4 md:grid-cols-2 xl:grid-cols-3">
              {recommendations.map((r) => {
                const added = buyList.includes(r.id);
                return (
                  <div key={r.id} className="flex flex-col rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{r.product}</p>
                        <p className="text-[11px] text-slate-500">{r.category}</p>
                      </div>
                      <Badge
                        tone={
                          r.priority === "high"
                            ? "bad"
                            : r.priority === "medium"
                              ? "warn"
                              : "neutral"
                        }
                      >
                        {r.priority}
                      </Badge>
                    </div>

                    <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                        <dt className="text-slate-500">Suggested buy</dt>
                        {/* We hold no sales data, so a quantity would be invented.
                            The renderer prints an em dash rather than "null units". */}
                        <dd className="font-semibold text-slate-900">
                          {r.suggestedQty ? `${r.suggestedQty} units` : "—"}
                        </dd>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                        <dt className="text-slate-500">Retail</dt>
                        <dd className="font-semibold text-slate-900">{money(r.estimatedPrice)}</dd>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                        <dt className="text-slate-500">Margin</dt>
                        {/* No cost data exists on the server, so there is no margin
                            to calculate — "0%" would read as a calculation. */}
                        <dd className="font-semibold text-emerald-700">
                          {r.marginPct ? `${r.marginPct}%` : "—"}
                        </dd>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                        <dt className="text-slate-500">Traffic potential</dt>
                        {/* Our own search volume for the term this product answers,
                            or nothing when no tracked term matched it. */}
                        <dd className="font-semibold text-slate-900">
                          {r.trafficPotential ? `${compact(r.trafficPotential)}/mo` : "—"}
                        </dd>
                      </div>
                    </dl>

                    <p className="mt-2 text-[11px] text-slate-600">{r.reason}</p>
                    <p className="mt-1 text-[11px] text-slate-400">Signal from {r.competitorRef}</p>

                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                      <button
                        type="button"
                        className={added ? btnGhost : btnPrimary}
                        onClick={() => {
                          void actionToast(() => actions.toggleBuyList(r.id, !added), {
                            success: added
                              ? `${r.product} removed from the buy list.`
                              : `${r.product} added to the buy list.`,
                            failure: "The buy list could not be updated.",
                          });
                        }}
                      >
                        {added ? "On buy list" : "Add to buy list"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
            {buyList.length} of {inventoryRecommendations.length} recommendations marked for purchase.
          </div>
        </Card>
      ) : null}

      {/* ---- Keyword finder ------------------------------------------------ */}
      <Modal
        open={ideaOpen}
        onClose={() => setIdeaOpen(false)}
        title="Find keywords"
        subtitle="Google Autocomplete suggestions you can add to your tracked terms"
        icon={<Lightbulb size={16} />}
        width="lg"
        footer={
          <button type="button" className={btnGhost} onClick={() => setIdeaOpen(false)}>
            Done
          </button>
        }
      >
        <div className="space-y-3 px-4 py-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-600">Seed term</label>
              <input
                className={inputClass}
                placeholder="e.g. velvet lip kit"
                value={ideaSeed}
                onChange={(e) => setIdeaSeed(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void findIdeas();
                }}
              />
            </div>
            <button
              type="button"
              className={btnPrimary}
              onClick={() => void findIdeas()}
              disabled={ideasLoading || ideaSeed.trim().length < 2}
            >
              <Search size={14} /> {ideasLoading ? "Searching…" : "Find ideas"}
            </button>
            {(ideas?.length ?? 0) > 1 ? (
              <button
                type="button"
                className={btnGhost}
                disabled={clustering}
                onClick={() => void groupIdeas()}
              >
                <Sparkles size={13} /> {clustering ? "Grouping…" : "Group into themes"}
              </button>
            ) : null}
          </div>

          {ideas === null ? (
            <p className="rounded-lg bg-slate-50 px-3 py-3 text-[11px] text-slate-500">
              Type a product or service and we will pull the searches Google suggests around it.
              Add any that matter to your tracked keywords.
            </p>
          ) : ideas.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-3 text-[11px] text-slate-500">
              No suggestions came back for that term — try something broader.
            </p>
          ) : groupedIdeas ? (
            <div className="space-y-3">
              {groupedIdeas.map((group) => (
                <div key={group.name}>
                  <p className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                    {group.name}
                    {group.intent ? <Badge tone="neutral">{group.intent}</Badge> : null}
                  </p>
                  <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                    {group.ideas.map(ideaRow)}
                  </ul>
                </div>
              ))}
              <p className="text-[11px] text-slate-500">
                Grouped by what each search is actually asking for. Every suggestion you had is
                still here — nothing was added.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
              {ideas.map(ideaRow)}
            </ul>
          )}

          <p className="text-[11px] text-slate-500">
            {mode === "demo"
              ? "Demo mode: sample suggestions. Add SERPAPI_KEY on the server for live Google data."
              : `${keywordIdeas.filter((idea) => idea.savedAsKeyword).length} suggestion(s) already tracked.`}
          </p>
        </div>
      </Modal>
    </div>
  );
}
