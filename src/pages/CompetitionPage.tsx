import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Binoculars,
  Check,
  ExternalLink,
  Globe2,
  Image as ImageIcon,
  Loader2,
  MapPin,
  MessageSquareQuote,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Target,
  Trash2,
  Trophy,
} from "lucide-react";
import {
  Badge,
  Card,
  CardHead,
  ConfirmButton,
  EmptyState,
  Field,
  Notice,
  ScoreRing,
  Segmented,
  SiteLogo,
  Tabs,
  Td,
  Th,
  btnGhost,
  btnPrimary,
  changeTone,
  inputClass,
} from "../components/primitives";
import { Modal } from "../components/Modal";
import { SocialSuggestions, useSuggestionChoices } from "../components/SocialSuggestions";
import { BarChart, BarList, Stars } from "../components/charts";
import { StatusStatGrid, type StatStatus } from "../components/insights";
import { useActionToast, useToast } from "../components/Toast";
import {
  compact,
  itemKindLabel,
  money,
  normaliseWebsite,
  relativeTime,
  titleCase,
} from "../lib/format";
import {
  SOCIAL_PLATFORMS,
  isRecentPost,
  normaliseSocialHandle,
  parseFollowerCount,
  platformLabel,
  socialPlatformKey,
  summariseChannelSocial,
  type ChannelSocialInsight,
} from "../lib/social";
import { useWorkspace, useWorkspaceData } from "../lib/workspace";
import type {
  Cadence,
  ChangeType,
  Competitor,
  CompetitorInput,
  CompetitorItem,
  ContactDiscoveryResult,
  KeywordGap,
} from "../lib/types";

type CompetitionTab = "overview" | "keywords" | "inventory" | "social" | "local";

const CADENCE_OPTIONS = [
  { value: "daily" as Cadence, label: "Daily" },
  { value: "weekly" as Cadence, label: "Weekly" },
  { value: "monthly" as Cadence, label: "Monthly" },
];

type KeywordFilter = "all" | "high" | "none";

const KEYWORD_TABS: { value: KeywordFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "high", label: "Top opportunity" },
  { value: "none", label: "We already rank" },
];

const ITEM_TABS: { value: ChangeType | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new_product", label: "New" },
  { value: "price_change", label: "Price moves" },
  { value: "stock_change", label: "Stock moves" },
];

/**
 * The move behind a competitor's price change, or null when there is none to show.
 *
 * A `previousPrice` of 0 is a first-seen product (its own price is stored as the
 * previous one) or a wholesale page that publishes no price at all — neither is a
 * move, and dividing by it would print an infinite percentage.
 */
function itemPriceMove(item: CompetitorItem): { pct: number; down: boolean } | null {
  if (item.previousPrice <= 0 || item.previousPrice === item.price) return null;
  const diff = item.price - item.previousPrice;
  return { pct: (diff / item.previousPrice) * 100, down: diff < 0 };
}

function opportunity(k: KeywordGap) {
  const gap = k.ourRank === null ? 100 : k.ourRank - k.theirRank;
  return Math.round((k.volume / 1000) * Math.max(0, gap) * (1 - k.difficulty / 130));
}

/**
 * What removing a competitor takes with it, counted from what is on screen.
 *
 * The database cascades every child table, so this is not a warning about the
 * obvious row — it is the work that disappears with it, named before the user
 * confirms. Nothing here is a number we cannot see.
 */
function competitorRemovalNote(competitor: Competitor, posts: number): string {
  const parts = [
    competitor.social.length
      ? `${competitor.social.length} monitored social profile${competitor.social.length === 1 ? "" : "s"}`
      : "",
    competitor.newItems.length
      ? `${competitor.newItems.length} detected product${competitor.newItems.length === 1 ? "" : "s"}`
      : "",
    competitor.keywordGap.length
      ? `${competitor.keywordGap.length} tracked keyword${competitor.keywordGap.length === 1 ? "" : "s"}`
      : "",
    posts ? `${posts} scraped post${posts === 1 ? "" : "s"}` : "",
  ].filter(Boolean);

  if (!parts.length) {
    return "Nothing else is stored against them yet, so only the competitor goes. This cannot be undone.";
  }
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Removing them also deletes ${list}. Nothing is kept, and this cannot be undone.`;
}

export function CompetitionPage() {
  const toast = useToast();
  const actionToast = useActionToast();
  const workspace = useWorkspaceData();
  const { actions } = useWorkspace();
  const competitors = workspace.competitors;
  const myBusiness = workspace.metrics;
  const shareOfVoice = workspace.shareOfVoice;
  const reviewGaps = workspace.competitorReviewGaps;
  const localPackRankings = workspace.localPackRankings;
  const socialPosts = workspace.socialPosts;
  const socialTargets = workspace.socialMonitorTargets;
  const [activeId, setActiveId] = useState<string>(competitors[0]?.id ?? "");
  const [tab, setTab] = useState<CompetitionTab>("overview");
  const [keywordFilter, setKeywordFilter] = useState<KeywordFilter>("all");
  const [itemFilter, setItemFilter] = useState<ChangeType | "all">("all");
  const [benchmarking, setBenchmarking] = useState(false);
  const [socialScanning, setSocialScanning] = useState(false);
  const [handleOpen, setHandleOpen] = useState(false);
  const [handlePlatform, setHandlePlatform] = useState<string>(SOCIAL_PLATFORMS[0]);
  const [handleValue, setHandleValue] = useState("");
  /** Optional follower count, so engagement has a denominator before the first scan. */
  const [handleFollowers, setHandleFollowers] = useState("");
  /** The add/edit form: closed, adding a competitor, or editing the active one. */
  const [formMode, setFormMode] = useState<"add" | "edit" | null>(null);
  const [form, setForm] = useState<CompetitorInput>({
    name: "",
    website: "",
    cadence: "daily",
    notes: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  /** The website read for the active competitor, and the review of what it found. */
  const [discovery, setDiscovery] = useState<ContactDiscoveryResult | null>(null);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discoveryNote, setDiscoveryNote] = useState<string | null>(null);
  const {
    choices: discoveryChoices,
    toggle: toggleChoice,
    edit: editChoice,
    accepted,
  } = useSuggestionChoices(discovery);

  const competitor = competitors.find((c) => c.id === activeId) ?? competitors[0];
  const cadence = competitor?.cadence ?? "daily";

  const keywords = useMemo(() => {
    if (!competitor) return [];
    const rows = [...competitor.keywordGap].sort((a, b) => opportunity(b) - opportunity(a));
    return rows.filter((k) => {
      if (keywordFilter === "high") return opportunity(k) > 20;
      if (keywordFilter === "none") return k.ourRank !== null;
      return true;
    });
  }, [competitor, keywordFilter]);

  /**
   * The add/edit form, built once and rendered by both branches of the page. The
   * empty state has to be able to add the first competitor, or it is a dead end.
   */
  const competitorForm = (
    <Modal
      open={formMode !== null}
      onClose={() => setFormMode(null)}
      title={formMode === "edit" ? "Edit competitor" : "Add a competitor"}
      subtitle={
        formMode === "edit"
          ? "Changes apply from the next scan — what we have already measured stays attached."
          : "We compare their traffic, keywords, ads, socials and reviews against yours."
      }
      icon={<Binoculars size={16} />}
      footer={
        <>
          <button type="button" className={btnGhost} onClick={() => setFormMode(null)}>
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={saving}
            onClick={() => void submitCompetitor()}
          >
            {formMode === "edit" ? <Check size={13} /> : <Plus size={13} />}
            {formMode === "edit" ? "Save changes" : "Add competitor"}
          </button>
        </>
      }
    >
      <div className="space-y-4 px-4 py-4">
        <Field label="Name">
          <input
            className={inputClass}
            placeholder="e.g. GlowMart Beauty"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
        <Field label="Website" hint="Their own site. A pasted URL is reduced to its domain.">
          <input
            className={inputClass}
            placeholder="glowmart.com"
            value={form.website}
            onChange={(event) => setForm({ ...form, website: event.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Check cadence">
            <select
              className={inputClass}
              value={form.cadence}
              onChange={(event) =>
                setForm({ ...form, cadence: event.target.value as CompetitorInput["cadence"] })
              }
            >
              {CADENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes" hint="For you and your team — never sent anywhere.">
            <input
              className={inputClass}
              placeholder="Anything worth remembering"
              value={form.notes ?? ""}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </Field>
        </div>
        {formMode === "edit" ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            Changing the website does not wipe their history: existing scans, posts and reviews stay
            attached to this competitor.
          </p>
        ) : null}
        {formError ? <p className="text-[11px] text-amber-600">{formError}</p> : null}
      </div>
    </Modal>
  );

  if (!competitor) {
    return (
      <div className="space-y-5">
        <Card>
          <CardHead
            icon={<Binoculars size={16} />}
            title="No competitors yet"
            subtitle="Add the businesses you track and we will compare their traffic, keywords, ads, socials and reviews against yours"
            action={
              <button type="button" className={btnPrimary} onClick={openAddCompetitor}>
                <Plus size={13} /> Add competitor
              </button>
            }
          />
          <EmptyState
            title="Nothing is being monitored"
            hint="Add a competitor's website and we will start comparing them from the first scan."
          />
        </Card>
        {competitorForm}
      </div>
    );
  }

  const activeAds = competitor.ads.filter((a) => a.status === "active").length;
  /**
   * Whether their ad library can be read at all.
   *
   * The library resolves an advertiser by Facebook page and not by name, so
   * without one saved there is nothing to read and a count of 0 would mean "we
   * have not looked", not "they are not advertising" — the two must not share a
   * tile. Their page is saved on this page's own Social tab.
   */
  const facebookPage = competitor.social.find((channel) =>
    channel.platform.toLowerCase().startsWith("facebook"),
  );
  const negativeReviews = competitor.reviews.filter((r) => r.sentiment === "negative").length;
  const mySocial = myBusiness.trafficSources.find((s) => /social|instagram|paid/i.test(s.label));
  const theirSocial = competitor.trafficSources.find((s) =>
    /social|instagram|paid/i.test(s.label),
  );
  const trafficShare = myBusiness.monthlyVisits / Math.max(1, competitor.monthlyVisits);
  const trafficStatus: StatStatus =
    trafficShare >= 0.9 ? "within" : trafficShare >= 0.5 ? "observe" : "critical";

  // Local benchmark rows for the active competitor.
  const sov = shareOfVoice.find((row) => row.competitorId === competitor.id);
  const reviewGap = reviewGaps.find((row) => row.competitorId === competitor.id);
  const competitorLocals = localPackRankings.filter((row) =>
    row.pack.some((entry) => entry.name.toLowerCase().includes(competitor.name.toLowerCase())),
  );
  // Competitor social, derived from the posts we actually scraped.
  const theirPosts = socialPosts.filter((post) => post.competitorId === competitor.id);
  // Their product changes, filtered by kind. A change feed, so there is no
  // "current catalogue" to show here — only what moved since the previous read.
  const theirItems = competitor.newItems.filter(
    (item) => itemFilter === "all" || item.change === itemFilter,
  );

  /**
   * The follower count behind one platform's engagement rate, or 0 when it is
   * not known yet. Engagement is a ratio against this figure, so a 0 here means
   * "not measured" rather than "none" — and the two are shown differently.
   */
  function followersFor(platform: string): number {
    const key = socialPlatformKey(platform);
    return competitor.social.find((s) => socialPlatformKey(s.platform) === key)?.followers ?? 0;
  }

  // Volume and engagement per monitored platform, derived from the scraped posts
  // once so every card reads the same figures the Cadence panel does.
  const channelInsights = useMemo(() => {
    const map = new Map<string, ChannelSocialInsight>();
    for (const channel of competitor.social) {
      map.set(
        socialPlatformKey(channel.platform),
        summariseChannelSocial(socialPosts, competitor.id, channel.platform),
      );
    }
    return map;
  }, [competitor.id, competitor.social, socialPosts]);
  const socialTarget = socialTargets.find((target) => target.competitorId === competitor.id);

  const sovComparison = [
    { label: "You", value: sov?.ourShare ?? 0 },
    ...shareOfVoice.map((row) => ({ label: row.competitorName, value: row.theirShare })),
  ];

  async function runBenchmark() {
    setBenchmarking(true);
    try {
      const result = await actions.runCompetitorBenchmark();
      if (workspace.isSample) {
        toast("Demo mode — showing the sample benchmark. Add SERPAPI_KEY to run a live one.");
      } else if (result?.capped) {
        toast(
          `Benchmarked ${result.keywords} keyword${result.keywords === 1 ? "" : "s"} — this workspace has used its SerpApi budget for the month.`,
        );
      } else {
        toast("Local competitor benchmark finished.");
      }
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "The competitor benchmark could not be run.");
    } finally {
      setBenchmarking(false);
    }
  }

  async function saveHandle() {
    if (!competitor) return;
    const parsed = parseFollowerCount(handleFollowers);
    if (parsed.error) {
      toast(parsed.error);
      return;
    }
    await actionToast(
      () =>
        actions.saveCompetitorSocial({
          competitorId: competitor.id,
          platform: handlePlatform,
          handle: handleValue,
          followers: parsed.followers,
        }),
      {
        success: `${platformLabel(handlePlatform)} handle saved — the next social scan will pull it.`,
        failure: "That handle could not be saved.",
      },
    );
    setHandleOpen(false);
    setHandleValue("");
    setHandleFollowers("");
  }

  /** Opens the form on a blank competitor, starting from the cadence in view. */
  function openAddCompetitor() {
    setForm({ name: "", website: "", cadence, notes: "" });
    setFormError(null);
    setFormMode("add");
  }

  function openEditCompetitor() {
    if (!competitor) return;
    setForm({
      name: competitor.name,
      website: competitor.website,
      cadence: competitor.cadence,
      notes: competitor.notes ?? "",
    });
    setFormError(null);
    setFormMode("edit");
  }

  /**
   * Saves the add/edit form.
   *
   * A failure keeps the dialog open with what was typed and the reason inline. A
   * closed dialog plus an error toast loses the input and reads like a success.
   */
  async function submitCompetitor() {
    const name = form.name.trim();
    const website = normaliseWebsite(form.website);
    if (!name || !website) {
      setFormError("Add a name and a website address — that is what gets scanned.");
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      if (formMode === "edit" && competitor) {
        await actions.updateCompetitor(competitor.id, {
          name,
          website,
          cadence: form.cadence,
          notes: form.notes,
        });
        toast(`${name} updated — the next scan uses the new details.`);
      } else {
        const created = await actions.addCompetitor({
          name,
          website,
          cadence: form.cadence,
          notes: form.notes,
        });
        // Show the new row straight away rather than leaving the page on someone else.
        setActiveId(created.id);
        setTab("overview");
        toast(`${created.name} is now being watched.`);
      }
      setFormMode(null);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "That competitor could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Reads the active competitor's own website and proposes the profiles on it.
   *
   * Stored mode: the gateway reads `competitors.website` and records what the run
   * is doing on the row. Nothing is written to `competitor_social` — accepting a
   * proposal is the separate save below, which is the whole point of the split.
   * A run still working is reported as such rather than as an empty result.
   */
  async function findSocials() {
    if (!competitor) return;
    const target = competitor;

    setDiscoveryBusy(true);
    setDiscoveryNote(null);
    try {
      const result = await actions.findCompetitorSocials({ competitorId: target.id });
      if (!result) {
        setDiscoveryNote("Discovery is not available in this mode — add their handles by hand.");
        return;
      }
      if (result.status === "unavailable") {
        setDiscoveryNote(result.reason ?? "Discovery is not configured on this deployment.");
        return;
      }
      if (result.status === "running") {
        setDiscoveryNote(
          "Their site is still being read. Try again in a moment — the same run is collected, not a new one.",
        );
        return;
      }
      if (result.status === "failed") {
        setDiscoveryNote(result.reason ?? "Their website could not be read.");
        return;
      }
      setDiscovery(result);
    } catch (cause) {
      setDiscoveryNote(cause instanceof Error ? cause.message : "Their website could not be read.");
    } finally {
      setDiscoveryBusy(false);
    }
  }

  /** Saves the ticked proposals, each with the provenance the review gave it. */
  async function saveFound() {
    if (!competitor) return;
    const target = competitor;
    const handles = accepted
      .map((row) => ({ ...row, handle: normaliseSocialHandle(row.handle) }))
      .filter((row) => row.handle);
    if (!handles.length) {
      setDiscoveryNote("That handle does not look like a profile — check it and try again.");
      return;
    }

    try {
      await actions.saveCompetitorSocials({ competitorId: target.id, handles });
      toast(
        `Saved ${handles.length} discovered profile${handles.length === 1 ? "" : "s"} for ${target.name}.`,
      );
      setDiscovery(null);
      setDiscoveryNote(null);
    } catch (cause) {
      setDiscoveryNote(cause instanceof Error ? cause.message : "Those profiles could not be saved.");
    }
  }

  /** Removes the active competitor, then moves the page to whoever is left. */
  async function removeCompetitor() {
    if (!competitor) return;
    const target = competitor;
    const index = competitors.findIndex((c) => c.id === target.id);
    const next = competitors[index + 1] ?? competitors[index - 1] ?? null;

    setRemoving(true);
    try {
      await actions.removeCompetitor(target.id);
      // Re-point before the re-render: `activeId` still names a row that is gone.
      setActiveId(next?.id ?? "");
      setConfirmRemove(false);
      toast(`Stopped watching ${target.name} and cleared what we held on them.`);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "That competitor could not be removed.");
    } finally {
      setRemoving(false);
    }
  }

  async function scanSocial() {
    setSocialScanning(true);
    try {
      const result = await actions.runSocialScan();
      if (workspace.isSample) {
        toast("Demo mode — showing the sample posts. Add APIFY_TOKEN to pull live ones.");
      } else if (result?.message) {
        toast(result.message);
      } else if (result) {
        toast(
          `Scanned ${result.scanned} handle${result.scanned === 1 ? "" : "s"} — ${result.posts} post${result.posts === 1 ? "" : "s"} refreshed${result.running ? `, ${result.running} still running (scan again to collect)` : ""}.`,
        );
      }
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "The social scan could not be run.");
    } finally {
      setSocialScanning(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Pick who you are comparing against, then manage that competitor. */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Binoculars size={16} className="text-indigo-600" /> Watching
          </span>

          {competitors.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveId(c.id)}
              className={`flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-xs font-medium ring-1 transition ${
                c.id === competitor.id
                  ? "bg-indigo-600 text-white ring-indigo-600"
                  : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50"
              }`}
            >
              <SiteLogo website={c.website} name={c.name} size={22} />
              {c.name}
            </button>
          ))}

          <button type="button" className={btnGhost} onClick={openAddCompetitor}>
            <Plus size={13} /> Add competitor
          </button>

          <span className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" className={btnGhost} onClick={openEditCompetitor}>
              <Pencil size={13} /> Edit
            </button>
            <button type="button" className={btnGhost} onClick={() => setConfirmRemove(true)}>
              <Trash2 size={13} /> Remove
            </button>
          </span>
        </div>
      </Card>

      <StatusStatGrid
        items={[
          {
            name: "Their monthly traffic",
            stat: compact(competitor.monthlyVisits),
            meta: `yours: ${compact(myBusiness.monthlyVisits)}`,
            progressLabel: "Your share of their traffic",
            progress: myBusiness.monthlyVisits / Math.max(1, competitor.monthlyVisits),
            status: trafficStatus,
          },
          {
            name: "SEO score",
            stat: competitor.seoScore,
            meta: `yours: ${myBusiness.seoScore} · GEO ${competitor.geoScore} vs ${myBusiness.geoScore}`,
            progressLabel: "Their tracked-term coverage",
            progress: competitor.seoScore / 100,
            status: myBusiness.seoScore >= competitor.seoScore ? "within" : "observe",
          },
          {
            name: "Active ad campaigns",
            // An em dash, not a zero, when their page is not on file: the number
            // is unknown rather than absent.
            stat: facebookPage ? activeAds : "—",
            // Where the campaigns actually run, read from the campaigns we
            // collected — the competitor row's own `ad_platforms` is setup input
            // and stays empty for a rival added without it.
            meta: facebookPage
              ? [...new Set(competitor.ads.map((ad) => ad.platform))].join(", ") ||
                competitor.adPlatforms.join(", ") ||
                "no live campaigns in the ad library"
              : "add their Facebook page on the Social tab to read their ads",
            progressLabel: "Campaign feed coverage",
            progress: activeAds / 8,
            status: facebookPage && activeAds > 0 ? "observe" : "within",
          },
          {
            name: "Rating (2 months)",
            stat: competitor.rating.toFixed(1),
            meta: `${competitor.reviewsThisMonth} new · ${negativeReviews} negative`,
            progressLabel: "Rating out of 5",
            progress: competitor.rating / 5,
            status: competitor.rating >= 4.3 ? "within" : "critical",
          },
        ]}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "overview", label: "Overview", icon: <Globe2 size={13} /> },
          {
            value: "keywords",
            label: "Keywords",
            icon: <Search size={13} />,
            count: competitor.keywordGap.length,
          },
          {
            value: "inventory",
            label: "New inventory",
            icon: <Package size={13} />,
            count: competitor.newItems.length,
          },
          { value: "social", label: "Social", icon: <Share2 size={13} /> },
          { value: "local", label: "Local", icon: <MapPin size={13} /> },
        ]}
      />

      {tab === "overview" ? (
        <div className="grid gap-5">
          <Card>
            <CardHead
              icon={<Globe2 size={16} />}
              title={`${competitor.name} traffic and where it comes from`}
              subtitle={`Last scan ${relativeTime(competitor.lastScan)} · ${competitor.website.replace(/^https?:\/\//, "")}`}
              action={
                <a href={competitor.website} target="_blank" rel="noreferrer" className={btnGhost}>
                  Visit site <ExternalLink size={13} />
                </a>
              }
            />
            <div className="grid gap-5 px-4 py-4 md:grid-cols-2">
              <BarChart data={competitor.traffic} color="#4f46e5" />
              <div>
                <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Traffic sources
                </p>
                <BarList
                  data={competitor.trafficSources.map((s) => ({ label: s.label, value: s.share }))}
                  valueFormat={(n) => `${n}%`}
                  color="#0ea5e9"
                />
                <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  You lead on paid social ({mySocial?.share ?? 0}% vs {theirSocial?.share ?? 0}%).
                  {competitor.trafficSources[0]
                    ? ` Their strength is ${competitor.trafficSources[0].label.toLowerCase()} at ${competitor.trafficSources[0].share}% — that is where new stock content pays back fastest.`
                    : " Run a scan to see where their traffic comes from."}
                </div>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "inventory" ? (
        <Card>
          <CardHead
            icon={<Package size={16} />}
            title={`What changed on ${competitor.name}'s site`}
            subtitle="Products, services and price plans read from their own site that were listed, repriced or restocked since the previous scan"
            action={<Badge tone="brand">{competitor.newItems.length} changes</Badge>}
          />
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
            <Segmented size="sm" options={ITEM_TABS} value={itemFilter} onChange={setItemFilter} />
            <span className="ml-auto text-[11px] text-slate-500">
              Read from {competitor.website.replace(/^https?:\/\//, "")}
            </span>
          </div>
          {theirItems.length === 0 ? (
            <EmptyState
              title={competitor.newItems.length ? "Nothing in this filter" : "No catalogue changes yet"}
              hint={
                competitor.newItems.length
                  ? "Switch to “All” to see every change we detected."
                  : "Pull down to read their site — an item lands here only when a product, a service or a price plan is newly listed, repriced or restocked."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px]">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Product</Th>
                    <Th>Change</Th>
                    <Th className="text-right">Their price</Th>
                    <Th>Availability</Th>
                    <Th>Detected</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {theirItems.map((item) => {
                    const move = itemPriceMove(item);
                    return (
                      <tr key={item.id} className="align-top hover:bg-slate-50/70">
                        <Td>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-slate-900">{item.product}</span>
                            {/* A product is the default reading, so only the kinds
                                that were previously dropped are labelled. */}
                            {item.kind && item.kind !== "product" ? (
                              <Badge tone="neutral">{itemKindLabel(item.kind)}</Badge>
                            ) : null}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {[item.sku, item.category].filter(Boolean).join(" · ") ||
                              "no SKU published"}
                          </span>
                        </Td>
                        <Td>
                          <Badge tone={changeTone[item.change]}>{titleCase(item.change)}</Badge>
                        </Td>
                        <Td className="text-right">
                          <span className="block font-semibold text-slate-900">
                            {money(item.price)}
                          </span>
                          {move ? (
                            <span
                              className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${
                                move.down ? "text-emerald-600" : "text-rose-600"
                              }`}
                            >
                              {move.down ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />}
                              {Math.abs(move.pct).toFixed(1)}%
                            </span>
                          ) : null}
                        </Td>
                        <Td>
                          <span className="block text-xs text-slate-700">
                            {item.stock === item.previousStock
                              ? titleCase(item.stock)
                              : `${titleCase(item.previousStock)} → ${titleCase(item.stock)}`}
                          </span>
                        </Td>
                        <Td>
                          <span className="block text-xs text-slate-700">
                            {relativeTime(item.detectedAt)}
                          </span>
                        </Td>
                        <Td>
                          {item.url ? (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                            >
                              Their page <ExternalLink size={12} />
                            </a>
                          ) : null}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
            Only changes are listed: something we read again unchanged is not a row, so an empty list
            means their catalogue held still since the last scan. Each row is labelled with what
            their site published it as — a product, a service they render, or one of their price
            plans.
          </div>
        </Card>
      ) : null}

      {tab === "keywords" ? (
        <Card>
          <CardHead
            icon={<Search size={16} />}
            title="Keyword & SEO gap vs your platform"
            subtitle="Terms they rank for that you do not — ranked by traffic you could win"
            action={
              <Segmented
                size="sm"
                options={KEYWORD_TABS}
                value={keywordFilter}
                onChange={setKeywordFilter}
              />
            }
          />
          {keywords.length === 0 ? (
            <EmptyState
              title="No keywords in this filter"
              hint="Switch to “All” to see every tracked term."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Keyword</Th>
                    <Th className="text-right">Volume</Th>
                    <Th className="text-center">Them</Th>
                    <Th className="text-center">You</Th>
                    <Th className="text-center">Difficulty</Th>
                    <Th className="text-right">Opportunity</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {keywords.map((k) => {
                    const score = opportunity(k);
                    return (
                      <tr key={k.keyword} className="hover:bg-slate-50/70">
                        <Td>
                          <span className="block font-medium text-slate-900">{k.keyword}</span>
                          <span className="text-[11px] text-slate-500">{titleCase(k.intent)}</span>
                        </Td>
                        <Td className="text-right">{k.volume.toLocaleString()}</Td>
                        <Td className="text-center font-medium text-slate-900">#{k.theirRank}</Td>
                        <Td className="text-center">
                          {k.ourRank === null ? (
                            <span className="text-xs font-medium text-rose-600">not ranking</span>
                          ) : (
                            <span className="text-slate-700">#{k.ourRank}</span>
                          )}
                        </Td>
                        <Td className="text-center text-xs text-slate-500">{k.difficulty}</Td>
                        <Td className="text-right">
                          <Badge tone={score > 40 ? "bad" : score > 20 ? "warn" : "neutral"}>
                            {score > 40 ? "Act now" : score > 20 ? "Worth a page" : "Watch"}
                          </Badge>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
            Opportunity score = monthly volume × ranking gap ÷ keyword difficulty. Highest scores are
            the pages to publish this week.
          </div>
        </Card>
      ) : null}

      {tab === "local" ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <MapPin size={16} className="text-indigo-600" />
              Google local &amp; share of voice
            </span>
            <span className="ml-auto flex items-center gap-2">
              {sov ? (
                <span className="text-[11px] text-slate-500">
                  Benchmarked {relativeTime(sov.checkedAt)} · {sov.termCount} tracked terms
                </span>
              ) : null}
              <button
                type="button"
                className={btnPrimary}
                onClick={() => void runBenchmark()}
                disabled={benchmarking}
              >
                <RefreshCw size={14} className={benchmarking ? "animate-spin" : ""} />
                {benchmarking ? "Benchmarking…" : "Run benchmark"}
              </button>
            </span>
          </div>

          {!sov && !reviewGap ? (
            <Card>
              <CardHead
                icon={<Trophy size={16} />}
                title="No local benchmark yet"
                subtitle="Compare your Google share of voice and review counts against this competitor"
              />
              <EmptyState
                title="Nothing to compare yet"
                hint="Run the benchmark to pull your top-10 share and both Maps ratings from Google."
              />
            </Card>
          ) : (
            <div className="grid gap-5 xl:grid-cols-2">
              <Card>
                <CardHead
                  icon={<Trophy size={16} />}
                  title="Share of Voice"
                  subtitle={`How often each business appears in the Google top 10 for your ${sov?.termCount ?? 0} tracked terms`}
                />
                <div className="space-y-4 px-4 py-4">
                  {sov ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-indigo-50 px-3 py-2">
                        <p className="text-[11px] text-indigo-700">Your share</p>
                        <p className="text-xl font-semibold text-indigo-900">{sov.ourShare}%</p>
                        <p className="text-[11px] text-indigo-700">
                          top 10 for {sov.ourTop10}/{sov.termCount} terms
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-3 py-2">
                        <p className="text-[11px] text-slate-500">{sov.competitorName}</p>
                        <p className="text-xl font-semibold text-slate-900">{sov.theirShare}%</p>
                        <p className="text-[11px] text-slate-500">
                          top 10 for {sov.theirTop10}/{sov.termCount} terms
                        </p>
                      </div>
                    </div>
                  ) : null}
                  <BarList
                    data={sovComparison}
                    valueFormat={(n) => `${n}%`}
                    color="#4f46e5"
                  />
                  {sov ? (
                    <p className="text-[11px] text-slate-500">
                      {sov.ourShare >= sov.theirShare
                        ? `You lead ${competitor.name} on share of voice by ${(sov.ourShare - sov.theirShare).toFixed(1)} points.`
                        : `${competitor.name} leads you on share of voice by ${(sov.theirShare - sov.ourShare).toFixed(1)} points — publish comparison pages for the terms they hold.`}
                    </p>
                  ) : null}
                </div>
              </Card>

              <Card>
                <CardHead
                  icon={<MessageSquareQuote size={16} />}
                  title="Competitor review gap"
                  subtitle="Reviews and average rating pulled from both Google Maps listings"
                />
                {!reviewGap ? (
                  <EmptyState
                    title="No review gap yet"
                    hint="Run the benchmark to compare your Maps rating and review count."
                  />
                ) : (
                  <div className="space-y-4 px-4 py-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-slate-50 px-3 py-2">
                        <p className="text-[11px] text-slate-500">Your reviews</p>
                        <p className="text-xl font-semibold text-slate-900">
                          {reviewGap.ourReviews.toLocaleString()}
                        </p>
                        <Stars rating={reviewGap.ourRating} size={14} />
                      </div>
                      <div className="rounded-lg bg-slate-50 px-3 py-2">
                        <p className="text-[11px] text-slate-500">{reviewGap.competitorName}</p>
                        <p className="text-xl font-semibold text-slate-900">
                          {reviewGap.theirReviews.toLocaleString()}
                        </p>
                        <Stars rating={reviewGap.theirRating} size={14} />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={reviewGap.reviewGap > 0 ? "bad" : "good"}>
                        {reviewGap.reviewGap > 0
                          ? `They have ${reviewGap.reviewGap.toLocaleString()} more reviews`
                          : `You have ${Math.abs(reviewGap.reviewGap).toLocaleString()} more reviews`}
                      </Badge>
                      <Badge tone={reviewGap.ratingGap >= 0 ? "good" : "bad"}>
                        {reviewGap.ratingGap >= 0
                          ? `You rate +${reviewGap.ratingGap.toFixed(1)}`
                          : `They rate +${Math.abs(reviewGap.ratingGap).toFixed(1)}`}
                      </Badge>
                    </div>
                    <div className="flex justify-around">
                      <ScoreRing
                        score={Math.round((reviewGap.ourRating / 5) * 100)}
                        label="You"
                        tone="good"
                      />
                      <ScoreRing
                        score={Math.round((reviewGap.theirRating / 5) * 100)}
                        label={competitor.name}
                        tone={reviewGap.ratingGap >= 0 ? "warn" : "bad"}
                      />
                    </div>
                  </div>
                )}
              </Card>
            </div>
          )}

          <Card>
            <CardHead
              icon={<Target size={16} />}
              title="Local pack positions"
              subtitle={`Where you and ${competitor.name} sit in the map 3-pack for local keywords`}
            />
            {competitorLocals.length === 0 ? (
              <EmptyState
                title="They are not in any tracked pack"
                hint="Run a local scan to see which map packs they hold."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {competitorLocals.map((row) => {
                  const theirs = row.pack.find(
                    (entry) => entry.name.toLowerCase().includes(competitor.name.toLowerCase()),
                  );
                  return (
                    <li key={row.keyword} className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-900">{row.keyword}</span>
                        <span className="flex items-center gap-2">
                          {row.inPack ? (
                            <Badge tone="good">You hold #{row.packPosition}</Badge>
                          ) : (
                            <Badge tone="warn">You are not in the pack</Badge>
                          )}
                          {theirs ? <Badge tone="bad">They hold #{theirs.position}</Badge> : null}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "social" ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Share2 size={16} className="text-indigo-600" />
              Recent posts they published
            </span>
            <span className="ml-auto flex items-center gap-2">
              <span className="text-[11px] text-slate-500">
                {socialTarget?.lastScrapedAt
                  ? `Last scanned ${relativeTime(socialTarget.lastScrapedAt)}`
                  : "Not scanned yet"}
              </span>
              <button
                type="button"
                className={btnPrimary}
                onClick={() => void scanSocial()}
                disabled={socialScanning}
              >
                <RefreshCw size={14} className={socialScanning ? "animate-spin" : ""} />
                {socialScanning ? "Scanning…" : "Scan posts now"}
              </button>
            </span>
          </div>

          {socialTarget?.lastError ? (
            <Notice
              tone="warn"
              title={`Last scan problem — ${socialTarget.platform} ${socialTarget.handle}`}
            >
              {socialTarget.lastError}
            </Notice>
          ) : null}

          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHead
                icon={<ImageIcon size={16} />}
                title="Recent posts"
                subtitle={`Their public posts, newest first — captions and engagement, never their artwork`}
                action={<Badge tone="brand">{theirPosts.length} tracked</Badge>}
              />
              {theirPosts.length === 0 ? (
                <EmptyState
                  title="No posts captured yet"
                  hint="Run a social scan to pull their most recent public posts."
                />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {theirPosts.slice(0, 8).map((post) => (
                    <li key={post.id} className="flex gap-3 px-4 py-3">
                      {post.mediaUrl ? (
                        <img
                          src={post.mediaUrl}
                          alt=""
                          className="h-16 w-16 shrink-0 rounded-lg bg-slate-100 object-cover"
                        />
                      ) : (
                        <div className="h-16 w-16 shrink-0 rounded-lg bg-slate-100" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="neutral">{platformLabel(post.platform)}</Badge>
                          {isRecentPost(post) ? <Badge tone="good">New</Badge> : null}
                          <span className="text-[11px] text-slate-500">
                            {post.postedAt ? relativeTime(post.postedAt) : "date unknown"}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-700">
                          {post.caption || "No caption"}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                          {followersFor(post.platform) ? (
                            <span className="font-medium text-slate-700">
                              {post.engagementRate}% engagement
                            </span>
                          ) : null}
                          <span>{compact(post.likes)} likes</span>
                          <span>{compact(post.comments)} comments</span>
                          {post.views > 0 ? <span>{compact(post.views)} views</span> : null}
                          {post.url ? (
                            <a
                              href={post.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
                            >
                              View <ExternalLink size={11} />
                            </a>
                          ) : null}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
                Their posts are a signal, never artwork. Every "build our own" action writes an
                original brief for your brand.
              </div>
            </Card>

            <Card>
              <CardHead
                icon={<Share2 size={16} />}
                title="Social presence"
                subtitle="Where they publish and how much they engage"
                action={
                  <>
                    <button
                      type="button"
                      className={btnGhost}
                      disabled={discoveryBusy || competitor.contactsStatus === "running"}
                      onClick={() => void findSocials()}
                    >
                      {discoveryBusy || competitor.contactsStatus === "running" ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Globe2 size={13} />
                      )}
                      {discoveryBusy || competitor.contactsStatus === "running"
                        ? "Checking their site…"
                        : "Find socials from their site"}
                    </button>
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => {
                        setHandleValue("");
                        setHandleOpen(true);
                      }}
                    >
                      <Plus size={13} /> Add handle
                    </button>
                  </>
                }
              />

              {/* What the last read of their site did, and the review of what it found.
                  A finding is never applied on its own. */}
              {discovery || discoveryNote || competitor.contactsScannedAt ? (
                <div className="space-y-2.5 border-b border-slate-100 px-4 py-3">
                  {discovery ? (
                    <>
                      <SocialSuggestions
                        result={discovery}
                        choices={discoveryChoices}
                        onToggle={toggleChoice}
                        onEdit={editChoice}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className={btnPrimary}
                          disabled={!accepted.length}
                          onClick={() => void saveFound()}
                        >
                          <Plus size={13} /> Save {accepted.length} profile
                          {accepted.length === 1 ? "" : "s"}
                        </button>
                        <button type="button" className={btnGhost} onClick={() => setDiscovery(null)}>
                          Discard
                        </button>
                      </div>
                    </>
                  ) : competitor.contactsScannedAt ? (
                    <p className="text-[11px] text-slate-500">
                      Last checked {relativeTime(competitor.contactsScannedAt)}.
                      {competitor.social.length
                        ? ""
                        : " Nothing we can monitor was found on their site — add their handles by hand."}
                    </p>
                  ) : null}
                  {discoveryNote ? (
                    <p className="text-[11px] text-amber-600">{discoveryNote}</p>
                  ) : null}
                </div>
              ) : null}

              {competitor.social.length === 0 ? (
                <EmptyState
                  title="No social channels monitored yet"
                  hint="Add their Instagram, TikTok, Facebook or X handle and the next scan pulls their recent posts."
                />
              ) : (
                <ul className="grid gap-3 px-4 py-4 md:grid-cols-2 xl:grid-cols-3">
                  {competitor.social.map((s) => {
                    // Derived from the scraped posts, not read off the channel row:
                    // its stored rate and cadence are never written, so a card built
                    // on them shows 0% however much engagement the posts have.
                    const insight = channelInsights.get(socialPlatformKey(s.platform));
                    const posts = insight?.posts ?? 0;
                    return (
                      <li key={s.platform} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                            {platformLabel(s.platform)}
                            {s.source === "discovered" ? (
                              <Badge tone="info">found on their site</Badge>
                            ) : null}
                          </span>
                          <span className="flex min-w-0 items-center gap-1">
                            <span className="truncate text-xs text-slate-500">{s.handle}</span>
                            <button
                              type="button"
                              className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-rose-600"
                              title={`Stop monitoring ${platformLabel(s.platform)}`}
                              aria-label={`Stop monitoring ${platformLabel(s.platform)}`}
                              onClick={() =>
                                void actionToast(
                                  () =>
                                    actions.removeCompetitorSocial({
                                      competitorId: competitor.id,
                                      platform: s.platform,
                                    }),
                                  {
                                    success: `Stopped monitoring ${platformLabel(s.platform)}.`,
                                    failure: "That handle could not be removed.",
                                  },
                                )
                              }
                            >
                              <Trash2 size={13} />
                            </button>
                          </span>
                        </div>
                        <dl className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                          <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                            <dt className="text-slate-500">Followers</dt>
                            <dd
                              className="font-semibold text-slate-900"
                              title={
                                s.followers
                                  ? undefined
                                  : "Not measured yet — the next scan reads it from the profile, or you can add it with the handle."
                              }
                            >
                              {s.followers ? compact(s.followers) : "—"}
                            </dd>
                          </div>
                          <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                            <dt className="text-slate-500">Engagement</dt>
                            <dd
                              className="font-semibold text-slate-900"
                              title={
                                s.followers && posts
                                  ? undefined
                                  : "Engagement is (likes + comments) ÷ followers, so it needs a follower count and at least one scraped post."
                              }
                            >
                              {s.followers && posts ? `${insight?.averageEngagement ?? 0}%` : "—"}
                            </dd>
                          </div>
                          <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                            <dt className="text-slate-500">Posts / week</dt>
                            <dd className="font-semibold text-slate-900">
                              {posts ? (insight?.postsPerWeek ?? 0) : "—"}
                            </dd>
                          </div>
                          <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                            <dt className="text-slate-500">Ads live</dt>
                            <dd
                              className={`font-semibold ${s.adsRunning ? "text-indigo-700" : "text-slate-900"}`}
                            >
                              {s.adsRunning}
                            </dd>
                          </div>
                        </dl>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------ add a social handle */}
      <Modal
        open={handleOpen}
        onClose={() => setHandleOpen(false)}
        title="Add a social handle"
        subtitle={competitor ? `So their public posts can be monitored` : undefined}
        icon={<Share2 size={16} />}
        footer={
          <>
            <button type="button" className={btnGhost} onClick={() => setHandleOpen(false)}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} onClick={() => void saveHandle()}>
              <Plus size={13} /> Save handle
            </button>
          </>
        }
      >
        <div className="space-y-4 px-4 py-4">
          <Field label="Platform">
            <select
              className={inputClass}
              value={handlePlatform}
              onChange={(event) => setHandlePlatform(event.target.value)}
            >
              {SOCIAL_PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {platformLabel(platform)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Their handle or profile URL"
            hint="e.g. @glowmartbeauty, or the full profile URL. Only their public posts are read."
          >
            <input
              className={inputClass}
              placeholder="@glowmartbeauty"
              value={handleValue}
              onChange={(event) => setHandleValue(event.target.value)}
            />
          </Field>
          <Field
            label="Followers (optional)"
            hint="Their follower count, e.g. 184000, 184k or 1.2m. Engagement is a share of this, so leaving it blank shows a dash until a scan measures it."
          >
            <input
              className={inputClass}
              placeholder="184k"
              inputMode="numeric"
              value={handleFollowers}
              onChange={(event) => setHandleFollowers(event.target.value)}
            />
          </Field>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            Their posts are treated as a market signal — never republished as your own creative.
          </p>
        </div>
      </Modal>

      {competitorForm}

      {/* ------------------------------------------------ stop watching a competitor */}
      <Modal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={`Stop watching ${competitor.name}?`}
        subtitle="Their row goes, and everything measured from it goes with it"
        icon={<Trash2 size={16} />}
        footer={
          <>
            <button
              type="button"
              className={btnGhost}
              disabled={removing}
              onClick={() => setConfirmRemove(false)}
            >
              Keep watching
            </button>
            <ConfirmButton
              label="Remove competitor"
              confirmLabel="Delete permanently"
              icon={<Trash2 size={13} />}
              busy={removing}
              onConfirm={() => void removeCompetitor()}
            />
          </>
        }
      >
        <div className="space-y-3 px-4 py-4">
          <p className="text-sm text-slate-700">
            {competitor.name} stops being compared on this page and its card disappears.
          </p>
          <p className="rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2 text-[12px] text-rose-900">
            {competitorRemovalNote(competitor, theirPosts.length)}
          </p>
        </div>
      </Modal>
    </div>
  );
}
