import { useState } from "react";
import {
  Check,
  Copy,
  Link2,
  MessageSquareQuote,
  Plus,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  Store,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import {
  Badge,
  Card,
  CardHead,
  EmptyState,
  Field,
  Stat,
  Tabs,
  Td,
  Th,
  btnGhost,
  btnPrimary,
  inputClass,
} from "../components/primitives";
import { Modal } from "../components/Modal";
import { BarChart, DeltaPill, Stars } from "../components/charts";
import { useToast } from "../components/Toast";
import { platformLabel, summariseChannelSocial, summariseSocial } from "../lib/social";
import { compact, relativeTime, reviewPlatformLabel, shortDate } from "../lib/format";
import { useWorkspace, useWorkspaceData } from "../lib/workspace";
import type { MyReview } from "../lib/types";

type SocialTab = "reviews" | "social";

/**
 * Platforms the connect form offers, in the order it lists them. Google and
 * TripAdvisor are read through SerpApi; the rest need an Apify actor id for that
 * platform, and a sync says so rather than failing silently.
 */
const REVIEW_PLATFORMS = ["google", "yelp", "g2", "trustpilot", "capterra", "tripadvisor"] as const;

/**
 * Suggestions for the "add your own handle" form. Free text is allowed too, so a
 * platform that is not listed can still be added — these only save typing.
 */
const OWN_SOCIAL_PLATFORMS = [
  "Instagram",
  "TikTok",
  "Facebook",
  "X (Twitter)",
  "YouTube",
  "LinkedIn",
  "Pinterest",
] as const;

/** Percent change that survives a missing previous value. */
function deltaPct(current: number, previous: number): number {
  if (!previous) return 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

export function SocialPage() {
  const workspace = useWorkspaceData();
  const { actions } = useWorkspace();

  const { reviewSources, reviewConnections, latestReviewScan, socialScores, competitors, profile } =
    workspace;
  const socialPosts = workspace.socialPosts;
  const [tab, setTab] = useState<SocialTab>("reviews");
  const [replyTarget, setReplyTarget] = useState<MyReview | null>(null);
  const [replyText, setReplyText] = useState("");
  /** Set once a draft has been written, so the composer can say what it was. */
  const [draftTone, setDraftTone] = useState("");
  const [drafting, setDrafting] = useState(false);
  /**
   * Why the last send failed, when the platform will not accept a reply from
   * here. Set only after a real attempt, so the manual fallback is offered for
   * the actual reason rather than shown on every deployment.
   */
  const [sendError, setSendError] = useState("");
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectPlatform, setConnectPlatform] = useState<string>("google");
  const [connectHandle, setConnectHandle] = useState("");
  const [handlePlatform, setHandlePlatform] = useState("");
  const [handleValue, setHandleValue] = useState("");
  const toast = useToast();

  // Sorted so the list does not reshuffle as a map is rebuilt on every save.
  const handleEntries = Object.entries(profile.socialHandles).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  // Whether the active tab has anything behind it. Until a review page is connected
  // or a handle is added there is nothing to analyse, so the tab shows its connect
  // card alone instead of panels that would all read empty.
  const reviewsConnected = reviewConnections.length > 0;
  const socialConnected = handleEntries.length > 0;
  const tabConnected = tab === "reviews" ? reviewsConnected : socialConnected;

  // Measured from the posts we actually scraped, so the declared numbers on the
  // channel rows can be checked against behaviour.
  const socialInsights = new Map(
    competitors.map((c) => [c.id, summariseSocial(socialPosts, c.id)]),
  );

  const lastScan = latestReviewScan.scannedAt;
  const decliningSource = reviewSources.find((s) => s.score < s.previousScore);
  const totalReviews = reviewSources.reduce((sum, s) => sum + s.reviews, 0);

  /** Opens the reply composer, seeded with the suggested action text. */
  function openReply(review: MyReview) {
    setReplyTarget(review);
    setReplyText(review.action || "");
    setDraftTone("");
    setSendError("");
  }

  /** Puts the reply on the clipboard so it can be pasted onto the review page. */
  async function copyReply() {
    const body = replyText.trim();
    if (!body) {
      toast("Write a reply before copying it.");
      return;
    }
    try {
      await navigator.clipboard.writeText(body);
      toast("Reply copied — paste it on the review platform.");
    } catch {
      toast("Could not copy automatically — select the text and copy it by hand.");
    }
  }

  /**
   * Records a reply the user posted on the platform themselves. This is the path
   * that works without a platform business API: the review stops asking for a
   * reply and keeps the text that was posted.
   */
  async function markReplied() {
    if (!replyTarget) return;
    const target = replyTarget;
    const body = replyText.trim();
    if (!body) {
      toast("Write a reply before marking it handled.");
      return;
    }
    try {
      await actions.recordManualReviewReply(target.id, body);
      toast(`Marked ${target.author}'s review as replied.`);
      setReplyTarget(null);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "That review could not be marked as replied.");
    }
  }

  /**
   * Asks the model for a reply and puts it in the box. The reply still has to be
   * sent by hand — drafting never sends anything, which is the whole guardrail.
   */
  async function draftReply() {
    if (!replyTarget) return;
    setDrafting(true);
    try {
      const draft = await actions.draftReviewReply(replyTarget.id);
      if (!draft) {
        toast("AI drafting is not configured — add GROQ_API_KEY to the function secrets.");
        return;
      }
      setReplyText(draft.reply);
      setDraftTone(draft.tone);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "A draft could not be written.");
    } finally {
      setDrafting(false);
    }
  }

  async function sendReply() {
    if (!replyTarget) return;
    const target = replyTarget;
    const body = replyText.trim();
    if (!body) {
      toast("Write a reply before sending it.");
      return;
    }
    try {
      await actions.replyToReview(target.id, body);
      toast(`Reply sent to ${target.author}.`);
      setReplyTarget(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The reply could not be sent.";
      setSendError(message);
      toast(message);
    }
  }

  async function removeProfile(connectionId: string) {
    try {
      await actions.removeReviewConnection(connectionId);
      toast("Review profile disconnected.");
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "That profile could not be removed.");
    }
  }

  /**
   * Saves one handle into the workspace's own map. One handle per platform,
   * matched case-insensitively, so "instagram" and "Instagram" cannot become two
   * rows — the later one replaces the earlier.
   */
  async function addHandle() {
    const platform = handlePlatform.trim();
    const value = handleValue.trim();
    if (!platform) {
      toast("Name the platform you are adding.");
      return;
    }
    if (!value) {
      toast("Add the handle or the profile URL.");
      return;
    }
    const next = { ...profile.socialHandles };
    for (const key of Object.keys(next)) {
      if (key.trim().toLowerCase() === platform.toLowerCase()) delete next[key];
    }
    next[platform] = value;
    try {
      await actions.saveOwnSocialHandles(next);
      setHandlePlatform("");
      setHandleValue("");
      toast(`${platformLabel(platform)} handle saved.`);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "That handle could not be saved.");
    }
  }

  async function removeHandle(platform: string) {
    const next = { ...profile.socialHandles };
    delete next[platform];
    try {
      await actions.saveOwnSocialHandles(next);
      toast(`${platformLabel(platform)} handle removed.`);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "That handle could not be removed.");
    }
  }

  async function connectProfile() {
    const handle = connectHandle.trim();
    if (!handle) {
      toast("Add the profile's public URL or handle.");
      return;
    }
    try {
      await actions.connectReviewProfile({
        platform: connectPlatform,
        handle,
        label: platformLabel(connectPlatform),
      });
      toast(`${platformLabel(connectPlatform)} profile connected.`);
      setConnectOpen(false);
      setConnectHandle("");
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "That profile could not be connected.");
    }
  }

  return (
    <div className="space-y-5">
      {/* The summary numbers only mean something once the tab they describe has a
          connection behind it; before that the connect card is the whole page. */}
      {tabConnected ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Average rating"
          value={latestReviewScan.averageRating || "—"}
          icon={<MessageSquareQuote size={16} />}
          hint={`${latestReviewScan.newReviews} new this scan`}
        />
        <Stat
          label="Reviews tracked"
          value={compact(totalReviews)}
          icon={<ThumbsUp size={16} />}
          hint={`${reviewSources.length} sources`}
        />
        <Stat
          label="Need a reply"
          value={latestReviewScan.flagged}
          icon={<ThumbsDown size={16} />}
          hint="flagged by the last scan"
        />
        <Stat
          label="Social channels"
          value={socialScores.length}
          icon={<Share2 size={16} />}
          hint={profile.socialHandles ? "handles connected" : "add handles in settings"}
        />
        </div>
      ) : null}

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "reviews", label: "My reviews", icon: <MessageSquareQuote size={13} />, count: reviewSources.length },
          { value: "social", label: "Social media", icon: <Share2 size={13} />, count: socialScores.length },
        ]}
      />

      {/* ------------------------------------------------ my reviews */}
      {tab === "reviews" && !reviewsConnected ? (
        <Card>
          <CardHead
            icon={<Link2 size={16} />}
            title="Connect your review pages"
            subtitle="Add the public review pages you are on and their reviews sync here"
          />
          <EmptyState
            title="No review pages connected yet"
            hint="Connect at least one public review page — Google, Trustpilot, Yelp or another — and its reviews, scores and reply queue appear here. Nothing is read from a page you have not added."
            action={
              <button type="button" className={btnPrimary} onClick={() => setConnectOpen(true)}>
                <Plus size={14} /> Connect a review profile
              </button>
            }
          />
        </Card>
      ) : null}

      {tab === "reviews" && reviewsConnected ? (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHead
              icon={<MessageSquareQuote size={16} />}
              title="Review page analysis — last 2 months"
              subtitle="Every review source you are tracked on, its score trend and how it is moving"
            />
            {reviewSources.length === 0 ? (
              <EmptyState
                title="No review data yet"
                hint="Review sources are added automatically once the first review scan runs."
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {reviewSources.map((s) => (
                  <div key={s.source} className="grid gap-3 px-4 py-4 md:grid-cols-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{s.source}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <Stars rating={s.score} size={14} />
                        <span className="text-sm font-semibold text-slate-900">
                          {s.score.toFixed(1)}
                        </span>
                        <DeltaPill value={deltaPct(s.score, s.previousScore)} />
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {s.reviews.toLocaleString()} reviews · {s.newThisMonth} new this month
                      </p>
                    </div>
                    <div className="md:col-span-2">
                      <BarChart
                        data={s.series}
                        color={s.score < s.previousScore ? "#e11d48" : "#059669"}
                        valueFormat={(n) => n.toFixed(2)}
                        height={110}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
              {decliningSource
                ? `${decliningSource.source} is trending down (${decliningSource.score} from ${decliningSource.previousScore}). Most complaints mention delivery timing, not product quality.`
                : "Every review source is stable or improving over the last two months."}
            </div>
          </Card>

          <Card>
            <CardHead
              icon={<RefreshCw size={16} />}
              title="Latest review scan"
              subtitle={`Scanned ${relativeTime(lastScan)} · next ${shortDate(latestReviewScan.nextScanAt)} — pull down to refresh`}
            />
            <div className="grid grid-cols-3 gap-2 border-b border-slate-100 px-4 py-3 text-center">
              <div>
                <p className="text-lg font-semibold text-slate-900">{latestReviewScan.newReviews}</p>
                <p className="text-[10px] text-slate-500 uppercase">New reviews</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-rose-600">{latestReviewScan.flagged}</p>
                <p className="text-[10px] text-slate-500 uppercase">Need reply</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-900">
                  {latestReviewScan.averageRating}
                </p>
                <p className="text-[10px] text-slate-500 uppercase">Avg rating</p>
              </div>
            </div>
            {latestReviewScan.items.length === 0 ? (
              <EmptyState
                title="No reviews captured yet"
                hint="Run the scan once your review pages are connected."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {latestReviewScan.items.map((r) => {
                  /*
                   * The tag names the exact platform this one review came from,
                   * so a mixed list reads Google / Trustpilot / Yelp at a glance
                   * instead of hiding the platform in the meta line. The stored
                   * key is preferred because it is the platform itself; `source`
                   * is the label the sync wrote beside it, and covers a row
                   * saved before `platform` existed.
                   */
                  const platformTag = reviewPlatformLabel(r.platform) || r.source;
                  return (
                    <li key={r.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-xs font-semibold text-slate-800">
                            {r.author}
                          </span>
                          {platformTag ? (
                            <Badge tone="info" className="shrink-0">
                              {platformTag}
                            </Badge>
                          ) : null}
                        </span>
                        <Stars rating={r.rating} />
                      </div>
                      <p className="mt-1 text-[11px] text-slate-600">{r.text}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-400">
                        <span>{relativeTime(r.postedAt)}</span>
                        {r.language && r.language !== "en" ? (
                          <Badge tone="neutral">{r.language.toUpperCase()}</Badge>
                        ) : null}
                        {r.replied ? (
                          <Badge tone="good">Replied</Badge>
                        ) : r.sentiment === "negative" ? (
                          <Badge tone="bad">Needs reply</Badge>
                        ) : null}
                      </p>
                      {r.replied ? (
                        <p className="mt-1.5 rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800">
                          {r.replyText || "Reply sent."}
                        </p>
                      ) : (
                        <p className="mt-1.5 rounded bg-indigo-50 px-2 py-1 text-[11px] text-indigo-700">
                          {r.action}
                        </p>
                      )}
                      {r.replied ? null : (
                        <div className="mt-2 flex justify-end">
                          <button type="button" className={btnGhost} onClick={() => openReply(r)}>
                            <Send size={12} /> Reply
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="border-t border-slate-100 px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  Review profiles
                </p>
                <button type="button" className={btnGhost} onClick={() => setConnectOpen(true)}>
                  <Plus size={13} /> Connect
                </button>
              </div>
              {reviewConnections.length === 0 ? (
                <p className="text-[11px] text-slate-500">
                  No review pages connected yet. Add one to sync its reviews and reply from here.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {reviewConnections.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-medium text-slate-800">
                          {c.label || c.handle}
                        </p>
                        <p className="truncate text-[10px] text-slate-400">
                          {c.handle}
                          {c.lastSyncedAt
                            ? ` · synced ${relativeTime(c.lastSyncedAt)}`
                            : " · not synced yet"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {c.status === "needs_reauth" ? <Badge tone="warn">Reconnect</Badge> : null}
                        <button
                          type="button"
                          onClick={() => void removeProfile(c.id)}
                          className="text-[10px] text-slate-400 transition hover:text-rose-600"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      ) : null}

      {/* ------------------------------------------------ social */}
      {tab === "social" ? (
        <div className="space-y-5">
          <Card>
            <CardHead
              icon={<Share2 size={16} />}
              title="Your social handles"
              subtitle="Add or remove the profiles you run — your channel rows are checked against these"
              action={<Badge tone="brand">{handleEntries.length} saved</Badge>}
            />
            <div className="px-4 py-4">
              {handleEntries.length === 0 ? (
                <p className="text-[11px] text-slate-500">
                  No handles yet. Add the profiles you post from below and they appear on your
                  channel rows.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {handleEntries.map(([platform, handle]) => (
                    <li
                      key={platform}
                      className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-1 pr-1.5 pl-3"
                    >
                      <span className="text-[11px] font-medium text-slate-800">
                        {platformLabel(platform)}
                      </span>
                      <span className="text-[11px] text-slate-500">{handle}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${platformLabel(platform)}`}
                        onClick={() => void removeHandle(platform)}
                        className="rounded-full p-0.5 text-slate-400 transition hover:bg-white hover:text-rose-600"
                      >
                        <X size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Platform</span>
                  <input
                    className={`${inputClass} w-44`}
                    list="own-social-platforms"
                    placeholder="Instagram"
                    value={handlePlatform}
                    onChange={(event) => setHandlePlatform(event.target.value)}
                  />
                  <datalist id="own-social-platforms">
                    {OWN_SOCIAL_PLATFORMS.map((platform) => (
                      <option key={platform} value={platform} />
                    ))}
                  </datalist>
                </label>
                <label className="block min-w-[12rem] flex-1">
                  <span className="mb-1 block text-xs font-medium text-slate-600">
                    Handle or URL
                  </span>
                  <input
                    className={inputClass}
                    placeholder="@yourbrand or a full profile URL"
                    value={handleValue}
                    onChange={(event) => setHandleValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void addHandle();
                    }}
                  />
                </label>
                <button type="button" className={btnPrimary} onClick={() => void addHandle()}>
                  <Plus size={14} /> Save handle
                </button>
              </div>
            </div>
          </Card>

          {/* The scores and benchmarks only exist once a handle is declared, so they
              sit behind the handles card rather than beside an empty one. */}
          {socialConnected ? (
          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2">
            <CardHead
              icon={<Share2 size={16} />}
              title="Social media score & where to focus"
              subtitle="Your score per platform next to the best competitor on that platform"
            />
            {socialScores.length === 0 ? (
              <EmptyState
                title="No social scores yet"
                hint="Add your social handles in business settings and the next scan will score them."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <Th>Platform</Th>
                      <Th className="text-center">Your score</Th>
                      <Th className="text-right">Followers</Th>
                      <Th className="text-right">Growth</Th>
                      <Th className="text-right">Gap to best</Th>
                      <Th>Focus</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {socialScores.map((s) => (
                      <tr key={s.platform} className="hover:bg-slate-50/70">
                        <Td>
                          <span className="block font-medium text-slate-900">{s.platform}</span>
                          <span className="text-[11px] text-slate-500">{s.handle}</span>
                        </Td>
                        <Td className="text-center">
                          <span className="text-sm font-semibold text-slate-900">{s.score}</span>
                          <div className="mx-auto mt-1 h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-full rounded-full ${
                                s.score >= 65
                                  ? "bg-emerald-500"
                                  : s.score >= 45
                                    ? "bg-amber-500"
                                    : "bg-rose-500"
                              }`}
                              style={{ width: `${s.score}%` }}
                            />
                          </div>
                        </Td>
                        <Td className="text-right text-xs text-slate-600">
                          {compact(s.followers)}
                        </Td>
                        <Td className="text-right text-xs text-emerald-600">
                          +{s.growth.toFixed(1)}%
                        </Td>
                        <Td className="text-right text-xs text-rose-600">{s.benchmarkGap}</Td>
                        <Td>
                          <Badge
                            tone={
                              s.focus === "high" ? "bad" : s.focus === "medium" ? "warn" : "neutral"
                            }
                          >
                            {s.focus} priority
                          </Badge>
                          <span className="mt-1 block max-w-64 text-[11px] text-slate-500">
                            {s.reason}
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-600">
              Focus first on{" "}
              <span className="font-medium">
                {socialScores
                  .filter((s) => s.focus === "high")
                  .map((s) => s.platform)
                  .join(" and ") || "the channels flagged high"}
              </span>{" "}
              — those are the channels where competitors pull the most extra traffic and where your
              scores are furthest behind.
            </div>
          </Card>

          <Card>
            <CardHead
              icon={<Store size={16} />}
              title="Competitor social channels"
              subtitle="Where they post, their following, and what their scraped posts measure"
            />
            {competitors.length === 0 ? (
              <EmptyState
                title="No competitors tracked"
                hint="Add competitor websites during setup to benchmark their social."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {competitors.map((c) => (
                  <li key={c.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-900">{c.name}</span>
                      <Badge tone={c.monthlyVisits > 0 ? "neutral" : "neutral"}>
                        {c.social.length} channel{c.social.length === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    {(() => {
                      const insight = socialInsights.get(c.id);
                      if (!insight || insight.posts === 0) return null;
                      return (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Measured from {insight.posts} scraped post{insight.posts === 1 ? "" : "s"}: ~
                          {insight.postsPerWeek}/week · {insight.averageEngagement}% average engagement
                          {insight.postsLast24Hours > 0
                            ? ` · ${insight.postsLast24Hours} in the last 24h`
                            : ""}
                          {insight.topHashtags.length
                            ? ` · leans on #${insight.topHashtags.slice(0, 2).map((t) => t.tag).join(" #")}`
                            : ""}
                        </p>
                      );
                    })()}
                    {c.social.length === 0 ? (
                      <p className="mt-1 text-[11px] text-slate-500">No social data captured yet.</p>
                    ) : (
                      <ul className="mt-1.5 space-y-1.5">
                        {c.social.map((ch) => {
                          // Derived exactly as the Competition cards and the
                          // summary line above are: the channel row's stored rate
                          // and cadence are never written, and reading them here
                          // made this line contradict the one two rows up.
                          const channel = summariseChannelSocial(socialPosts, c.id, ch.platform);
                          return (
                            <li
                              key={`${c.id}-${ch.platform}`}
                              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600"
                            >
                              <span className="font-medium text-slate-800">{ch.platform}</span>
                              <span>{ch.followers ? `${compact(ch.followers)} followers` : "— followers"}</span>
                              <span>
                                {ch.followers && channel.posts
                                  ? `${channel.averageEngagement}% eng.`
                                  : "— eng."}
                              </span>
                              <span>
                                {channel.posts ? `${channel.postsPerWeek} posts/wk` : "— posts/wk"}
                              </span>
                              {ch.adsRunning > 0 ? (
                                <Badge tone="warn">{ch.adsRunning} ads</Badge>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
              Your best lever is SEO: you are already close on traffic but two competitors still beat
              your SEO and GEO scores.
            </div>
          </Card>
          </div>
          ) : null}
        </div>
      ) : null}

      {/* ------------------------------------------------ reply composer */}
      <Modal
        open={Boolean(replyTarget)}
        onClose={() => setReplyTarget(null)}
        title="Reply to this review"
        subtitle={
          replyTarget
            ? `${replyTarget.author} · ${replyTarget.rating}★ on ${replyTarget.source}`
            : undefined
        }
        icon={<Send size={16} />}
        footer={
          <>
            <button
              type="button"
              className={btnGhost}
              disabled={drafting}
              onClick={() => void draftReply()}
            >
              <Sparkles size={13} /> {drafting ? "Drafting…" : "Draft with AI"}
            </button>
            <button type="button" className={btnGhost} onClick={() => void copyReply()}>
              <Copy size={13} /> Copy
            </button>
            <button type="button" className={btnGhost} onClick={() => setReplyTarget(null)}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} onClick={() => void sendReply()}>
              <Send size={13} /> Send reply
            </button>
          </>
        }
      >
        {replyTarget ? (
          <div className="space-y-4 px-4 py-4">
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
              “{replyTarget.text}”
            </p>
            <Field
              label="Your reply"
              hint="Edit the suggestion before it goes out — nothing is posted automatically."
            >
              <textarea
                className={`${inputClass} min-h-28`}
                value={replyText}
                onChange={(event) => setReplyText(event.target.value)}
              />
            </Field>
            {draftTone ? (
              <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <Sparkles size={12} /> Drafted with a {draftTone} tone. Sending is still yours to do.
              </p>
            ) : null}
            {sendError ? (
              <div className="space-y-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                <p>{sendError}</p>
                {/* The fallback for a platform this deployment cannot post to:
                    copy the reply across, then record it here by hand. */}
                <button type="button" className={btnGhost} onClick={() => void markReplied()}>
                  <Check size={13} /> I posted it myself — mark as replied
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* ------------------------------------------------ connect a profile */}
      <Modal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        title="Connect a review profile"
        subtitle="Any public review page — no login on that platform is required"
        icon={<Link2 size={16} />}
        footer={
          <>
            <button type="button" className={btnGhost} onClick={() => setConnectOpen(false)}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} onClick={() => void connectProfile()}>
              Connect profile
            </button>
          </>
        }
      >
        <div className="space-y-4 px-4 py-4">
          <Field label="Platform">
            <select
              className={inputClass}
              value={connectPlatform}
              onChange={(event) => setConnectPlatform(event.target.value)}
            >
              {REVIEW_PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {platformLabel(platform)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Public URL or handle"
            hint="e.g. yourretailbrand.com, or the full Trustpilot profile URL"
          >
            <input
              className={inputClass}
              placeholder="e.g. yourretailbrand.com"
              value={connectHandle}
              onChange={(event) => setConnectHandle(event.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
