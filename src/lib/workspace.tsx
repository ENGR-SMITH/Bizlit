import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useAuth, useUser } from "@clerk/clerk-react";
import { Matrix, loader } from "@/components/ui/matrix";
import { authEnabled, dbEnabled } from "./env";
import { sampleProfile, sampleWorkspace } from "../data/sample";
import {
  addBuyListItem,
  createClientRow,
  createCompetitorRow,
  createInventoryItem,
  createPromotionBrief,
  createWorkspaceFromOnboarding,
  deleteBrandLogo,
  deleteClientRow,
  deleteCompetitorRow,
  deleteCompetitorSocialHandle,
  deleteInventoryItem,
  deletePromotionBrief,
  deleteReviewConnection,
  fetchBusiness,
  loadWorkspace,
  logSentMessages,
  markReviewScanComplete,
  removeBuyListItem,
  saveKeywordIdea as saveTrackedKeyword,
  saveMailAccountRow,
  saveManualReviewReply,
  saveCompetitorSocialHandle,
  saveCompetitorSocialHandles,
  saveReviewConnection,
  saveSocialHandles,
  setCompetitorCadence,
  updateBrandLogo,
  updateClientRow,
  updateCompetitorRow,
  updateInventoryItem,
  updatePromotionBrief,
  uploadBrandLogo,
  uploadInventoryImage as uploadInventoryImageFile,
} from "./repo";
import {
  invokeGateway,
  type AngleDraftResult,
  type ClusterDraftResult,
  type CompetitorBenchmarkResult,
  type MailSendResult,
  type PublishAdResult,
  type ReplyDraftResult,
  type ReviewSyncResult,
  type SerpScanResult,
  type SiteScanResult,
  type SocialAccountsResult,
  type SocialScanResult,
  type AdsScanResult,
  type BuyListResult,
  type TrafficScanResult,
} from "./integrations";
import { subjectFor } from "./options";
import {
  sampleAdAngles,
  sampleKeywordClusters,
  sampleKeywordIdeas,
  sampleReplyDraft,
  sampleSocialSuggestions,
} from "../data/business";
import { sampleSocialAccounts } from "../data/commerce";
import { setAccessTokenProvider } from "./supabase";
import { nextSendFrom } from "./schedule";
import type {
  BusinessProfile,
  Cadence,
  Client,
  Competitor,
  CompetitorInput,
  CompetitorSocialInput,
  ContactDiscoveryResult,
  DiscountKind,
  InventoryItem,
  KeywordIdea,
  MailAccount,
  MessageType,
  OnboardingInput,
  PromotionBriefStatus,
  PromotionComponent,
  PromotionTemplate,
  ReviewConnection,
  SendFrequency,
  SocialChannel,
  SocialPublishJob,
  WorkspaceData,
} from "./types";
import {
  mergeSocialChannel,
  normaliseSocialHandle,
  socialPlatformKey,
  socialPlatformOf,
} from "./social";

/**
 * A competitor channel added in demo mode: the real handle the user typed, with
 * none of the measured numbers invented — a scan that never ran has nothing to
 * report, and sample data would make the page look like it had.
 */
function demoSocialChannel(
  platform: string,
  handle: string,
  source: SocialChannel["source"] = "manual",
  followers = 0,
): SocialChannel {
  const normalised = normaliseSocialHandle(handle);
  if (!normalised) {
    throw new Error("Add the competitor's handle or their full profile URL.");
  }
  return {
    platform: socialPlatformOf(platform) ?? platform.trim().toLowerCase(),
    handle: normalised,
    followers: Number.isFinite(followers) && followers > 0 ? followers : 0,
    engagementRate: 0,
    postsPerWeek: 0,
    adsRunning: 0,
    source,
  };
}

/**
 * A competitor added in demo mode (or before the database is reachable).
 *
 * Every measured field starts empty on purpose: a source that has never been
 * scanned has no traffic, keywords, ads or reviews, and inventing sample numbers
 * for it would make the page claim data that does not exist.
 */
function demoCompetitor(input: CompetitorInput): Competitor {
  return {
    id: `cmp-${Date.now()}`,
    name: input.name.trim(),
    website: input.website.trim(),
    cadence: input.cadence,
    notes: input.notes?.trim() || undefined,
    lastScan: new Date().toISOString(),
    monthlyVisits: 0,
    visitsChange: 0,
    traffic: [],
    trafficSources: [],
    seoScore: 0,
    geoScore: 0,
    social: [],
    adPlatforms: [],
    rating: 0,
    previousRating: 0,
    reviewCount: 0,
    reviewsThisMonth: 0,
    reviewTrend: [],
    reviews: [],
    audience: [],
    ads: [],
    newItems: [],
    keywordGap: [],
  };
}

/**
 * What the database's upsert does to a competitor's channels: one row per
 * platform, so saving a platform that is already tracked replaces its handle
 * rather than stacking a second scrape target.
 */
function withSocialChannels(
  competitors: Competitor[],
  competitorId: string,
  channels: SocialChannel[],
): Competitor[] {
  if (!channels.length) return competitors;
  return competitors.map((c) =>
    c.id === competitorId
      ? { ...c, social: channels.reduce(mergeSocialChannel, c.social) }
      : c,
  );
}

/** The demo-mode equivalent of the bulk upsert: normalise, then merge. */
function demoSocialChannels(
  handles: CompetitorSocialInput[],
  source: SocialChannel["source"],
): SocialChannel[] {
  return handles.flatMap((row) => {
    try {
      // A row may carry its own provenance — onboarding records an accepted
      // proposal as `discovered` and a corrected one as `manual` in the same save.
      return [demoSocialChannel(row.platform, row.handle, row.source ?? source)];
    } catch {
      // A row we cannot address is dropped rather than thrown on: the form
      // reports the problem, and one bad row must not lose the good ones.
      return [];
    }
  });
}

/** Removes a competitor and everything the database cascade would take with it. */
function withoutCompetitor(data: WorkspaceData, competitorId: string): WorkspaceData {
  return {
    ...data,
    competitors: data.competitors.filter((c) => c.id !== competitorId),
    socialPosts: data.socialPosts.filter((p) => p.competitorId !== competitorId),
    socialMonitorTargets: data.socialMonitorTargets.filter((t) => t.competitorId !== competitorId),
    competitorReviewGaps: data.competitorReviewGaps.filter((g) => g.competitorId !== competitorId),
    shareOfVoice: data.shareOfVoice.filter((s) => s.competitorId !== competitorId),
  };
}

export interface WorkspaceActions {
  setCompetitorCadence: (competitorId: string, cadence: Cadence) => Promise<void>;
  /** The same read for a competitor's own shopfront. */
  scanCompetitorSite: (competitorId: string) => Promise<SiteScanResult | null>;
  /**
   * Adds a competitor to the watched list. Resolves with the created source so the
   * page can select it straight away.
   */
  addCompetitor: (input: CompetitorInput) => Promise<Competitor>;
  /** Edits the columns the competitor form owns. */
  updateCompetitor: (competitorId: string, patch: Partial<CompetitorInput>) => Promise<void>;
  /**
   * Stops watching a competitor. Everything that hangs off it goes too — metrics,
   * handles, keywords, ads, reviews and scraped posts. There is no undo.
   */
  removeCompetitor: (competitorId: string) => Promise<void>;
  /**
   * Saves a competitor's whole set of social profiles at once — the onboarding
   * path, where one competitor can arrive with several. One row per platform, so
   * re-saving a platform replaces its handle.
   */
  saveCompetitorSocials: (input: {
    competitorId: string;
    handles: CompetitorSocialInput[];
    source?: "manual" | "discovered" | "imported";
  }) => Promise<void>;
  /**
   * Reads a competitor's stored website through the contacts actor and proposes
   * the social profiles it mentions. Writes nothing to `competitor_social`: the
   * proposals come back for a person to accept, because every accepted handle
   * becomes a billed scrape target.
   */
  findCompetitorSocials: (input: {
    competitorId: string;
  }) => Promise<ContactDiscoveryResult | null>;
  /**
   * The same read for a website that is not a stored competitor yet — onboarding
   * happens before the competitor row exists, so there is nothing to write state
   * onto. Authors nothing at all.
   */
  previewCompetitorSocials: (input: {
    url: string;
    label?: string;
  }) => Promise<ContactDiscoveryResult | null>;
  addClient: (input: {
    name: string;
    email: string;
    company: string;
    industry: string;
    tier: Client["tier"];
    frequency: SendFrequency;
    messageTypes: MessageType[];
  }) => Promise<void>;
  updateClient: (clientId: string, patch: Partial<Client>) => Promise<void>;
  removeClient: (clientId: string) => Promise<void>;
  sendMessages: (clientIds: string[]) => Promise<MailSendResult>;
  saveMailAccount: (account: MailAccount) => Promise<void>;
  toggleBuyList: (recommendationId: string, on: boolean) => Promise<void>;
  /**
   * Syncs reviews from the connected profiles. Resolves with the gateway's
   * summary (null in demo mode or when no review reader is configured).
   */
  runReviewScan: () => Promise<ReviewSyncResult | null>;
  /** Connects a review profile by its public handle or URL. */
  connectReviewProfile: (input: { platform: string; handle: string; label?: string }) => Promise<void>;
  /** Disconnects a review profile and removes it from the sync list. */
  removeReviewConnection: (connectionId: string) => Promise<void>;
  /** Sends a reply to one review through the gateway. */
  replyToReview: (reviewId: string, reply: string) => Promise<void>;
  /**
   * Records a reply the user posted on the review platform by hand. Used when the
   * deployment cannot post replies itself, so the draft the app produced still
   * counts as handled instead of the review sitting in "needs a reply" forever.
   */
  recordManualReviewReply: (reviewId: string, reply: string) => Promise<void>;
  /**
   * Re-runs the Google search/local scan for the tracked keywords. Resolves with
   * the gateway's summary (null in demo mode), which reports a budget-capped run.
   */
  runSerpScan: () => Promise<SerpScanResult | null>;
  /**
   * Benchmarks Share of Voice and the Competitor Review Gap vs tracked rivals.
   * Resolves with the gateway's summary (null in demo mode).
   */
  runCompetitorBenchmark: () => Promise<CompetitorBenchmarkResult | null>;
  /**
   * Pulls competitors' recent public posts via the Apify gateway. Resolves with
   * the gateway's summary (null in demo mode).
   */
  runSocialScan: () => Promise<SocialScanResult | null>;
  /**
   * Measures estimated monthly visits and the channel mix for our own site and
   * every rival's, one provider run for the lot. This is the only producer of the
   * traffic panels on Competition and My Business — nothing else writes
   * `monthly_visits`, the `traffic`/`channel` series or the traffic sources.
   * Resolves with the gateway's summary (null in demo mode).
   */
  runTrafficScan: () => Promise<TrafficScanResult | null>;
  /**
   * Reads Meta's Ad Library for every competitor whose Facebook page is saved.
   * This is the only producer of `competitor_ads`, so it is the only thing that
   * can make *Active ad campaigns* anything but zero. Resolves with the gateway's
   * summary (null in demo mode).
   */
  runAdsScan: () => Promise<AdsScanResult | null>;
  /**
   * Rebuilds the buy list from the competitor catalogue already on file. Calls no
   * provider, so it is free and safe to run on any pull; the gateway skips what is
   * already suggested, so pressing it twice adds nothing the second time.
   */
  runBuyList: () => Promise<BuyListResult | null>;
  /**
   * Declares a competitor's social handle. The scan scrapes exactly the handles
   * saved here, so this is what gives it a target — there is no other place a
   * competitor's profile is registered.
   */
  saveCompetitorSocial: (input: {
    competitorId: string;
    platform: string;
    handle: string;
    /**
     * The profile's follower count, when the person knows it. The dataset is
     * authoritative and overwrites this on the next scan; supplying it here is
     * what gives engagement a denominator before that scan has run.
     */
    followers?: number;
  }) => Promise<void>;
  /** Stops monitoring one competitor handle. */
  removeCompetitorSocial: (input: { competitorId: string; platform: string }) => Promise<void>;
  /**
   * Publishes a delivered design to the chosen connected accounts. Resolves with
   * the gateway's summary (null in demo mode is never returned — demo publishes
   * against sample accounts).
   */
  publishAd: (input: PublishAdInput) => Promise<PublishAdResult | null>;
  /**
   * Refreshes the connected social accounts from Mallary. Resolves to whether
   * any accounts are connected afterwards.
   */
  connectSocialAccounts: () => Promise<boolean>;
  /**
   * Replaces the user's own social handles. These are what the Social tab lists
   * and what a channel's score is checked against, so this is the only way to add
   * or remove one after onboarding. A platform omitted from the map is removed.
   */
  saveOwnSocialHandles: (handles: Record<string, string>) => Promise<void>;
  /** Fetches Google Autocomplete ideas for a seed term and stores them. */
  findKeywordIdeas: (seed: string) => Promise<KeywordIdea[]>;
  /** Promotes an autocomplete suggestion into the tracked keyword list. */
  saveKeywordIdea: (idea: KeywordIdea) => Promise<void>;
  /**
   * Drafts a reply to one review, for the composer to edit. Nothing is sent:
   * `sendReviewReply` is still the only way a reply leaves the app.
   */
  draftReviewReply: (reviewId: string) => Promise<ReplyDraftResult | null>;
  /**
   * Drafts original ad angles from one of a competitor's posts, for the user to
   * pick from. Creating the brief from a chosen angle is a separate action.
   */
  draftAdAngles: (postId: string) => Promise<AngleDraftResult | null>;
  /**
   * Groups a seed's suggestions into intent themes. Labels the stored rows, so
   * the grouping survives a reload rather than living only in the response.
   */
  clusterKeywordIdeas: (seed: string) => Promise<ClusterDraftResult | null>;
  uploadLogo: (file: File) => Promise<void>;
  removeLogo: () => Promise<void>;
  /** Creates when `id` is omitted, updates otherwise. */
  saveInventoryItem: (input: InventoryItemInput & { id?: string }) => Promise<void>;
  removeInventoryItem: (itemId: string) => Promise<void>;
  /** Uploads an item image and resolves to its URL (data URL in demo mode). */
  uploadInventoryImage: (file: File) => Promise<string>;
  savePromotionBrief: (input: PromotionBriefInput & { id?: string }) => Promise<void>;
  removePromotionBrief: (briefId: string) => Promise<void>;
}

/** Everything the inventory form collects, minus the server-owned fields. */
export type InventoryItemInput = Omit<InventoryItem, "id" | "createdAt">;

/** What the Post-ad modal submits to the publishing gateway. */
export interface PublishAdInput {
  /** The delivered design to post. */
  deliveredAdId: string | null;
  briefId: string | null;
  accountIds: string[];
  caption: string;
  /** Absolute ISO timestamp, or null to post now. */
  scheduledFor: string | null;
  timezone: string;
  /** A browser-exported PNG as a data URL, when the design has no hosted file. */
  mediaBase64?: string;
  mediaType?: string;
  mediaFilename?: string;
}

/** Everything the ad-brief form collects, minus the server-owned fields. */
export interface PromotionBriefInput {
  name: string;
  itemId: string | null;
  serviceId: string | null;
  priceItemId: string | null;
  contactInfo: string;
  template: PromotionTemplate;
  accentColor: string;
  components: PromotionComponent[];
  discountKind: DiscountKind;
  discountValue: number;
  dealText: string;
  couponCode: string;
  headline: string;
  notes: string;
  status: PromotionBriefStatus;
}

/** Reads a picked image as a data URL — used when no storage bucket is configured. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read that image file."));
    reader.readAsDataURL(file);
  });
}

export interface WorkspaceContextValue {
  data: WorkspaceData | null;
  profile: BusinessProfile | null;
  loading: boolean;
  error: string | null;
  needsOnboarding: boolean;
  mode: "demo" | "live";
  /**
   * Re-reads the workspace. `silent` leaves the current screens mounted while it
   * runs, which is what lets a page keep showing the version it already has until
   * the new one lands instead of dropping back to the loading screen.
   */
  refresh: (options?: { silent?: boolean }) => Promise<void>;
  completeOnboarding: (input: OnboardingInput) => Promise<void>;
  actions: WorkspaceActions;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside a WorkspaceProvider");
  return ctx;
}

/** Convenience for pages: these only render once a workspace is loaded. */
export function useWorkspaceData(): WorkspaceData {
  const { data } = useWorkspace();
  if (!data) throw new Error("Workspace data is not loaded yet");
  return data;
}

/* ------------------------------------------------------------ demo (no keys) */

function useSampleState() {
  const [data, setData] = useState<WorkspaceData>(() => sampleWorkspace());
  return [data, setData] as const;
}

function DemoWorkspaceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useSampleState();

  const patchData = useCallback(
    (updater: (current: WorkspaceData) => WorkspaceData) => {
      setData((current) => updater(current));
    },
    [setData],
  );

  const actions = useMemo<WorkspaceActions>(
    () => ({
      async setCompetitorCadence(competitorId, cadence) {
        patchData((current) => ({
          ...current,
          competitors: current.competitors.map((c) => (c.id === competitorId ? { ...c, cadence } : c)),
        }));
      },
      async scanCompetitorSite(competitorId) {
        const now = new Date().toISOString();
        patchData((current) => ({
          ...current,
          competitors: current.competitors.map((c) =>
            c.id === competitorId ? { ...c, lastScan: now } : c,
          ),
        }));
        return null;
      },
      async addCompetitor(input) {
        const created = demoCompetitor(input);
        patchData((current) => ({ ...current, competitors: [...current.competitors, created] }));
        return created;
      },
      async updateCompetitor(competitorId, patch) {
        patchData((current) => ({
          ...current,
          competitors: current.competitors.map((c) =>
            c.id === competitorId ? { ...c, ...patch } : c,
          ),
        }));
      },
      async removeCompetitor(competitorId) {
        patchData((current) => withoutCompetitor(current, competitorId));
      },
      async saveCompetitorSocials(input) {
        const channels = demoSocialChannels(input.handles, input.source ?? "manual");
        if (!channels.length) return;
        patchData((current) => ({
          ...current,
          competitors: withSocialChannels(current.competitors, input.competitorId, channels),
        }));
      },
      async findCompetitorSocials(input) {
        // Demo mode proposes the canned set for the competitor's own website and
        // writes nothing to `competitor_social`: no actor, no key, no spend — but
        // the accept flow, and the last-checked line, are the real ones.
        const competitor = data.competitors.find((c) => c.id === input.competitorId);
        const scannedAt = new Date().toISOString();
        patchData((current) => ({
          ...current,
          competitors: current.competitors.map((c) =>
            c.id === input.competitorId
              ? { ...c, contactsStatus: "done", contactsScannedAt: scannedAt }
              : c,
          ),
        }));
        return sampleSocialSuggestions(competitor?.website ?? "competitor.com");
      },
      async previewCompetitorSocials(input) {
        return sampleSocialSuggestions(input.url);
      },
      async addClient(input) {
        const now = new Date().toISOString();
        patchData((current) => ({
          ...current,
          clients: [
            {
              id: `cl-${Date.now()}`,
              name: input.name,
              email: input.email,
              company: input.company,
              industry: input.industry,
              status: "active",
              tier: input.tier,
              joinedAt: now,
              lastContacted: now,
              nextSendAt: nextSendFrom(input.frequency, input.messageTypes),
              frequency: input.frequency,
              messageTypes: input.messageTypes,
              openRate: 0,
              monthlyFee: { starter: 180, growth: 320, premium: 480 }[input.tier],
            },
            ...current.clients,
          ],
        }));
      },
      async updateClient(clientId, patch) {
        patchData((current) => ({
          ...current,
          clients: current.clients.map((c) =>
            c.id === clientId
              ? {
                  ...c,
                  ...patch,
                  nextSendAt:
                    patch.frequency !== undefined
                      ? nextSendFrom(patch.frequency, patch.messageTypes ?? c.messageTypes)
                      : (patch.nextSendAt ?? c.nextSendAt),
                }
              : c,
          ),
        }));
      },
      async removeClient(clientId) {
        patchData((current) => ({
          ...current,
          clients: current.clients.filter((c) => c.id !== clientId),
        }));
      },
      async sendMessages(clientIds) {
        const now = new Date().toISOString();
        let count = 0;
        patchData((current) => {
          const messages = clientIds
            .map((id) => current.clients.find((c) => c.id === id))
            .filter((c): c is Client => Boolean(c));
          count = messages.length;
          return {
            ...current,
            sentMessages: [
              ...messages.map((c, i) => ({
                id: `sm-${Date.now()}-${i}`,
                clientId: c.id,
                clientName: c.name,
                subject: subjectFor(c.company || c.name, c.messageTypes),
                types: c.messageTypes,
                sentAt: now,
                status: "delivered" as const,
              })),
              ...current.sentMessages,
            ],
            clients: current.clients.map((c) =>
              clientIds.includes(c.id)
                ? { ...c, lastContacted: now, nextSendAt: nextSendFrom(c.frequency, c.messageTypes) }
                : c,
            ),
          };
        });
        // Demo mode has no mail server, so the batch is recorded as sent — the
        // same preview the live desk gives, without the transport.
        return { sent: count, failed: 0 };
      },
      async saveMailAccount(account) {
        // One cadence and one set of message types for the whole list — saving the
        // configuration aligns every customer so the batch goes out together.
        patchData((current) => ({
          ...current,
          mailAccount: account,
          clients: current.clients.map((c) => ({
            ...c,
            frequency: account.sendFrequency,
            messageTypes: account.messageTypes,
            nextSendAt: nextSendFrom(account.sendFrequency, account.messageTypes),
          })),
        }));
      },
      async toggleBuyList(recommendationId, on) {
        patchData((current) => ({
          ...current,
          buyList: on
            ? [...current.buyList, recommendationId]
            : current.buyList.filter((id) => id !== recommendationId),
        }));
      },
      async runReviewScan() {
        // No provider credentials in demo mode — the sample reviews already stand
        // in, so a scan just refreshes the timestamp.
        patchData((current) => ({
          ...current,
          latestReviewScan: { ...current.latestReviewScan, scannedAt: new Date().toISOString() },
        }));
        return null;
      },
      async connectReviewProfile(input) {
        const now = new Date().toISOString();
        patchData((current) => {
          const exists = current.reviewConnections.some(
            (c) => c.platform === input.platform && c.handle === input.handle,
          );
          if (exists) return current;
          const connection: ReviewConnection = {
            id: `rc-${Date.now()}`,
            provider: "reviews",
            platform: input.platform,
            handle: input.handle,
            label: (input.label ?? "").trim() || `${input.platform} profile`,
            status: "active",
            lastSyncedAt: null,
            lastError: "",
            createdAt: now,
          };
          return { ...current, reviewConnections: [...current.reviewConnections, connection] };
        });
      },
      async removeReviewConnection(connectionId) {
        patchData((current) => ({
          ...current,
          reviewConnections: current.reviewConnections.filter((c) => c.id !== connectionId),
        }));
      },
      async replyToReview(reviewId, reply) {
        const now = new Date().toISOString();
        patchData((current) => ({
          ...current,
          latestReviewScan: {
            ...current.latestReviewScan,
            items: current.latestReviewScan.items.map((r) =>
              r.id === reviewId ? { ...r, replied: true, replyText: reply, repliedAt: now } : r,
            ),
          },
        }));
      },
      async recordManualReviewReply(reviewId, reply) {
        const now = new Date().toISOString();
        patchData((current) => ({
          ...current,
          latestReviewScan: {
            ...current.latestReviewScan,
            items: current.latestReviewScan.items.map((r) =>
              r.id === reviewId ? { ...r, replied: true, replyText: reply, repliedAt: now } : r,
            ),
          },
        }));
      },
      async runSerpScan() {
        // No provider credentials in demo mode — the sample scan already stands in,
        // so the panel has something to show without inventing new numbers.
        return null;
      },
      async runCompetitorBenchmark() {
        // Sample benchmarks already stand in for a live benchmark in demo mode.
        return null;
      },
      async runSocialScan() {
        // Sample competitor posts already stand in, and no actor credentials exist
        // in demo mode.
        return null;
      },
      async runTrafficScan() {
        // Sample traffic already stands in, and no actor credentials exist in demo
        // mode.
        return null;
      },
      async runAdsScan() {
        // Sample campaigns already stand in, and no actor credentials exist in demo
        // mode.
        return null;
      },
      async runBuyList() {
        // The sample workspace already ships a filled buy list, so there is
        // nothing to derive in demo mode.
        return null;
      },
      async saveCompetitorSocial(input) {
        const channel = demoSocialChannel(input.platform, input.handle, "manual", input.followers ?? 0);
        patchData((current) => ({
          ...current,
          competitors: current.competitors.map((c) =>
            c.id === input.competitorId
              ? { ...c, social: mergeSocialChannel(c.social, channel) }
              : c,
          ),
        }));
      },
      async removeCompetitorSocial(input) {
        const platform = socialPlatformKey(input.platform);
        patchData((current) => ({
          ...current,
          competitors: current.competitors.map((c) =>
            c.id === input.competitorId
              ? {
                  ...c,
                  social: c.social.filter((s) => socialPlatformKey(s.platform) !== platform),
                }
              : c,
          ),
        }));
      },
      async publishAd(input) {
        const now = new Date().toISOString();
        const jobId = `job-${Date.now()}`;
        const scheduled = Boolean(input.scheduledFor);
        let platforms: string[] = [];
        patchData((current) => {
          platforms = [
            ...new Set(
              current.socialAccounts
                .filter((account) => input.accountIds.includes(account.id))
                .map((account) => account.platform),
            ),
          ];
          const job: SocialPublishJob = {
            id: jobId,
            briefId: input.briefId,
            deliveredAdId: input.deliveredAdId,
            accountIds: input.accountIds,
            platforms,
            caption: input.caption,
            scheduledFor: input.scheduledFor,
            timezone: input.timezone,
            status: scheduled ? "queued" : "published",
            providerJobId: jobId,
            permalink: scheduled ? "" : "https://social.example.com/p/demo-ad",
            error: "",
            createdAt: now,
            updatedAt: now,
          };
          return { ...current, publishJobs: [job, ...current.publishJobs] };
        });
        return {
          ok: true,
          jobId,
          batchId: "demo-batch",
          status: scheduled ? "queued" : "published",
          permalink: scheduled ? "" : "https://social.example.com/p/demo-ad",
          platforms,
          scheduledFor: input.scheduledFor,
        };
      },
      async connectSocialAccounts() {
        // No Mallary key in demo mode — seed the sample accounts so the Post-ad
        // modal has something to post to.
        patchData((current) =>
          current.socialAccounts.length
            ? current
            : { ...current, socialAccounts: sampleSocialAccounts },
        );
        return true;
      },
      async saveOwnSocialHandles(handles) {
        patchData((current) => ({
          ...current,
          profile: { ...current.profile, socialHandles: handles },
        }));
      },
      async findKeywordIdeas(seed) {
        const ideas = sampleKeywordIdeas(seed);
        patchData((current) => {
          const known = new Set(current.keywordIdeas.map((k) => k.suggestion));
          return {
            ...current,
            keywordIdeas: [...ideas.filter((i) => !known.has(i.suggestion)), ...current.keywordIdeas],
          };
        });
        return ideas;
      },
      async saveKeywordIdea(idea) {
        patchData((current) => ({
          ...current,
          keywordIdeas: current.keywordIdeas.map((k) =>
            k.id === idea.id ? { ...k, savedAsKeyword: true } : k,
          ),
          topSeoKeywords: current.topSeoKeywords.some((k) => k.keyword === idea.suggestion)
            ? current.topSeoKeywords
            : [
                ...current.topSeoKeywords,
                { keyword: idea.suggestion, volume: 0, position: null, change: 0 },
              ],
        }));
      },
      // The three drafting actions answer with sample copy rather than null, so
      // every drafting surface renders without a provider key. Nothing is spent
      // and nothing is sent: `model: "demo"` and zero tokens say so plainly.
      async draftReviewReply(reviewId) {
        const review = data.latestReviewScan.items.find((item) => item.id === reviewId);
        return {
          reviewId,
          ...sampleReplyDraft({ author: review?.author ?? "", rating: review?.rating ?? 5 }),
          sent: false,
          model: "demo",
          tokens: 0,
          costUsd: 0,
        };
      },
      async draftAdAngles(postId) {
        const post = data.socialPosts.find((candidate) => candidate.id === postId);
        return {
          angles: sampleAdAngles(),
          competitor:
            data.competitors.find((candidate) => candidate.id === post?.competitorId)?.name ?? "",
          source: {
            postId,
            platform: post?.platform ?? "",
            caption: post?.caption ?? "",
            likes: post?.likes ?? 0,
            comments: post?.comments ?? 0,
            engagementRate: post?.engagementRate ?? 0,
          },
          model: "demo",
          tokens: 0,
          costUsd: 0,
        };
      },
      async clusterKeywordIdeas(seed) {
        const clean = seed.trim().toLowerCase();
        // Derived from the same helper the demo search uses, rather than from
        // state: these actions are memoised against `patchData` alone, so `data`
        // here is the workspace as it was when the provider first rendered — and
        // the suggestions just added by a search would not be in it.
        const ideas = sampleKeywordIdeas(clean);
        const clusters = sampleKeywordClusters(ideas);
        // Label the rows as the gateway does, so the grouped view survives a
        // reload instead of existing only in this response.
        patchData((current) => ({
          ...current,
          keywordIdeas: current.keywordIdeas.map((idea) => {
            if (idea.seed !== clean) return idea;
            const cluster = clusters.find((entry) => entry.keywords.includes(idea.suggestion));
            return { ...idea, cluster: cluster?.name ?? "" };
          }),
        }));
        return { seed: clean, clusters, grouped: ideas.length, model: "demo", tokens: 0, costUsd: 0 };
      },
      async uploadLogo(file) {
        const logoUrl = await fileToDataUrl(file);
        patchData((current) => ({ ...current, profile: { ...current.profile, logoUrl } }));
      },
      async removeLogo() {
        patchData((current) => ({ ...current, profile: { ...current.profile, logoUrl: "" } }));
      },
      async saveInventoryItem(input) {
        const { id, ...fields } = input;
        patchData((current) => ({
          ...current,
          inventory: id
            ? current.inventory.map((item) => (item.id === id ? { ...item, ...fields } : item))
            : [
                { ...fields, id: `inv-${Date.now()}`, createdAt: new Date().toISOString() },
                ...current.inventory,
              ],
        }));
      },
      async removeInventoryItem(itemId) {
        patchData((current) => ({
          ...current,
          inventory: current.inventory.filter((item) => item.id !== itemId),
          promotionBriefs: current.promotionBriefs.map((p) =>
            p.itemId === itemId || p.serviceId === itemId || p.priceItemId === itemId
              ? {
                  ...p,
                  itemId: p.itemId === itemId ? null : p.itemId,
                  serviceId: p.serviceId === itemId ? null : p.serviceId,
                  priceItemId: p.priceItemId === itemId ? null : p.priceItemId,
                }
              : p,
          ),
        }));
      },
      async uploadInventoryImage(file) {
        return fileToDataUrl(file);
      },
      async savePromotionBrief(input) {
        const { id, ...fields } = input;
        const now = new Date().toISOString();
        patchData((current) => ({
          ...current,
          promotionBriefs: id
            ? current.promotionBriefs.map((p) =>
                p.id === id ? { ...p, ...fields, updatedAt: now } : p,
              )
            : [{ ...fields, id: `brief-${Date.now()}`, submittedAt: now, updatedAt: now },
                ...current.promotionBriefs],
        }));
      },
      async removePromotionBrief(briefId) {
        patchData((current) => ({
          ...current,
          promotionBriefs: current.promotionBriefs.filter((p) => p.id !== briefId),
          deliveredAds: current.deliveredAds.filter((a) => a.briefId !== briefId),
        }));
      },
    }),
    // `data` is a dependency because discovery reads the competitor's own stored
    // website rather than taking it from the caller, so the proposal cannot drift
    // from what is on screen.
    [data, patchData],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      data,
      profile: data.profile,
      loading: false,
      error: null,
      needsOnboarding: false,
      mode: "demo",
      refresh: async () => {},
      completeOnboarding: async () => {},
      actions,
    }),
    [data, actions],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/* --------------------------------------------------------- live (Clerk + DB) */

function LiveWorkspaceProvider({ children }: { children: ReactNode }) {
  const { userId, getToken, isLoaded } = useAuth();
  const { user } = useUser();

  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Every Supabase request carries a fresh Clerk session token.
  useEffect(() => {
    setAccessTokenProvider(() => getToken());
    return () => setAccessTokenProvider(null);
  }, [getToken]);

  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  const bootstrap = useCallback(async (options?: { silent?: boolean }) => {
    if (!userId) return;
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      if (!dbEnabled) {
        // Auth without a database: sign in works, data stays sample.
        setProfile(sampleProfile);
        setData(sampleWorkspace(sampleProfile));
        return;
      }
      const business = await fetchBusiness(userId);
      setProfile(business);
      if (business?.onboardingComplete) {
        setData(await loadWorkspace(business));
      } else {
        setData(null);
      }
    } catch (cause) {
      // A silent reload belongs to its caller: the screens are still on show, so
      // there is no error panel to put this in, and the pull reports it itself.
      if (silent) {
        throw cause instanceof Error ? cause : new Error("Your workspace could not be reloaded.");
      }
      setError(cause instanceof Error ? cause.message : "Could not load your workspace.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!userId) {
      setLoading(false);
      return;
    }
    void bootstrap();
  }, [isLoaded, userId, bootstrap]);

  const completeOnboarding = useCallback(
    async (input: OnboardingInput) => {
      if (!userId) throw new Error("You need to be signed in.");
      const created = await createWorkspaceFromOnboarding(userId, email, input);
      setProfile(created);
      setData(await loadWorkspace(created));
    },
    [userId, email],
  );

  const withBusiness = useCallback(
    async <T,>(run: (profile: BusinessProfile) => Promise<T>): Promise<T | undefined> => {
      if (!profile) return undefined;
      try {
        return await run(profile);
      } catch (cause) {
        // Resync first — the optimistic patch that ran before this write is now
        // wrong — then record the failure (bootstrap resets the error state) and
        // rethrow so the caller can report it instead of announcing a save that
        // never happened.
        await bootstrap();
        setError(cause instanceof Error ? cause.message : "Something went wrong.");
        throw cause;
      }
    },
    [profile, bootstrap],
  );

  const patchData = useCallback((updater: (current: WorkspaceData) => WorkspaceData) => {
    setData((current) => (current ? updater(current) : current));
  }, []);

  /**
   * One catalogue read against `site-scan`.
   *
   * Deliberately reloads nothing: a pull runs one of these per watched source, so
   * reloading the workspace after each would be N full reads for a single gesture.
   * The pull re-reads once, after every scan has settled — and a failure is left to
   * propagate, because the pull counts it rather than swallowing it here.
   */
  const scanSite = useCallback(
    async (sourceId: string): Promise<SiteScanResult | null> => {
      if (!dbEnabled || !profile) return null;
      return await invokeGateway<SiteScanResult>("site-scan", {
        businessId: profile.id,
        sourceId,
      });
    },
    [profile],
  );

  const actions = useMemo<WorkspaceActions>(
    () => ({
      async setCompetitorCadence(competitorId, cadence) {
        patchData((current) => ({
          ...current,
          competitors: current.competitors.map((c) => (c.id === competitorId ? { ...c, cadence } : c)),
        }));
        if (dbEnabled) await withBusiness(() => setCompetitorCadence(competitorId, cadence));
      },
      async scanCompetitorSite(competitorId) {
        return await scanSite(competitorId);
      },
      async addCompetitor(input) {
        // Without a database (signed in, keys absent) the sample workspace is
        // what is on screen, so the write happens against it — the same thing the
        // demo provider does — instead of silently doing nothing.
        const created = dbEnabled
          ? await withBusiness((business) => createCompetitorRow(business.id, input))
          : demoCompetitor(input);
        if (!created) throw new Error("Your workspace is still loading — try again.");
        patchData((current) => ({ ...current, competitors: [...current.competitors, created] }));
        return created;
      },
      async updateCompetitor(competitorId, patch) {
        patchData((current) => ({
          ...current,
          competitors: current.competitors.map((c) =>
            c.id === competitorId ? { ...c, ...patch } : c,
          ),
        }));
        if (dbEnabled) await withBusiness(() => updateCompetitorRow(competitorId, patch));
      },
      async removeCompetitor(competitorId) {
        // Drop the dependent rows locally too, so nothing is left rendering for a
        // competitor that no longer exists — which is what the cascade does for real.
        patchData((current) => withoutCompetitor(current, competitorId));
        if (dbEnabled) await withBusiness(() => deleteCompetitorRow(competitorId));
      },
      async saveCompetitorSocials(input) {
        if (!dbEnabled) {
          const channels = demoSocialChannels(input.handles, input.source ?? "manual");
          patchData((current) => ({
            ...current,
            competitors: withSocialChannels(current.competitors, input.competitorId, channels),
          }));
          return;
        }
        await withBusiness(async (business) => {
          const saved = await saveCompetitorSocialHandles(business.id, input);
          patchData((current) => ({
            ...current,
            competitors: withSocialChannels(current.competitors, input.competitorId, saved),
          }));
        });
      },
      async findCompetitorSocials(input) {
        if (!dbEnabled || !profile) return null;
        try {
          // Stored mode: the gateway reads the competitor's stored website and
          // records what the run is doing on the row. Accepting a proposal is a
          // separate, explicit `saveCompetitorSocials` call.
          const result = await invokeGateway<ContactDiscoveryResult>("web-contacts-scan", {
            businessId: profile.id,
            competitorId: input.competitorId,
          });
          await bootstrap();
          return result ?? null;
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Their website could not be read.");
          throw cause;
        }
      },
      async previewCompetitorSocials(input) {
        if (!dbEnabled) return null;
        try {
          // Called from onboarding, before the business row exists — so there is
          // no tenant to scope the run to and nothing to write its state onto.
          return await invokeGateway<ContactDiscoveryResult>("web-contacts-scan", {
            url: input.url,
            label: input.label,
          });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Their website could not be read.");
          throw cause;
        }
      },
      async addClient(input) {
        if (!dbEnabled) return;
        await withBusiness(async (business) => {
          const created = await createClientRow(business.id, { ...input, monthlyFee: 0 });
          patchData((current) => ({ ...current, clients: [created, ...current.clients] }));
        });
      },
      async updateClient(clientId, patch) {
        patchData((current) => ({
          ...current,
          clients: current.clients.map((c) => (c.id === clientId ? { ...c, ...patch } : c)),
        }));
        if (dbEnabled) await withBusiness(() => updateClientRow(clientId, patch));
      },
      async removeClient(clientId) {
        patchData((current) => ({
          ...current,
          clients: current.clients.filter((c) => c.id !== clientId),
        }));
        if (dbEnabled) await withBusiness(() => deleteClientRow(clientId));
      },
      async sendMessages(clientIds) {
        const targets = (data?.clients ?? []).filter((c) => clientIds.includes(c.id));
        if (!targets.length) return { sent: 0, failed: 0 };
        const now = new Date().toISOString();

        if (!dbEnabled) {
          // No database, no transport: record the batch locally, exactly as the
          // demo provider does, so the desk still shows what would go out.
          patchData((current) => ({
            ...current,
            sentMessages: [
              ...targets.map((c, i) => ({
                id: `sm-${Date.now()}-${i}`,
                clientId: c.id,
                clientName: c.name,
                subject: subjectFor(c.company || c.name, c.messageTypes),
                types: c.messageTypes,
                sentAt: now,
                status: "delivered" as const,
              })),
              ...current.sentMessages,
            ],
            clients: current.clients.map((c) =>
              clientIds.includes(c.id)
                ? { ...c, lastContacted: now, nextSendAt: nextSendFrom(c.frequency, c.messageTypes) }
                : c,
            ),
          }));
          return { sent: targets.length, failed: 0 };
        }
        if (!profile) throw new Error("Your workspace is still loading — try again in a moment.");

        // Real delivery: the gateway speaks SMTP itself (the mailbox credentials
        // are server-side secrets), sends customer by customer and reports what
        // each attempt actually did. The browser never sees the password.
        let result: MailSendResult;
        try {
          result = await invokeGateway<MailSendResult>("client-mail", {
            businessId: profile.id,
            clientIds: targets.map((c) => c.id),
          });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Those emails could not be sent.";
          setError(message);
          throw new Error(message);
        }

        const outcomes = new Map((result.results ?? []).map((r) => [r.clientId, r]));
        const subjectOf = (c: Client) =>
          outcomes.get(c.id)?.subject ?? subjectFor(c.company || c.name, c.messageTypes);

        // The activity log is written from the server's own report, so a send
        // the server refused is recorded as a failure instead of as delivered.
        await withBusiness(async (business) => {
          await logSentMessages(
            business.id,
            targets.map((c) => ({
              clientId: c.id,
              clientName: c.name,
              subject: subjectOf(c),
              types: c.messageTypes,
              status: outcomes.get(c.id)?.status ?? "failed",
            })),
          );
        });

        const delivered = new Set(
          targets.filter((c) => outcomes.get(c.id)?.status === "delivered").map((c) => c.id),
        );
        patchData((current) => ({
          ...current,
          sentMessages: [
            ...targets.map((c, i) => ({
              id: `sm-${Date.now()}-${i}`,
              clientId: c.id,
              clientName: c.name,
              subject: subjectOf(c),
              types: c.messageTypes,
              sentAt: now,
              status: outcomes.get(c.id)?.status ?? "failed",
            })),
            ...current.sentMessages,
          ],
          // Only an accepted send moves the schedule forward — the server has
          // already advanced `next_send_at` for these, and a failure stays due
          // so the next run retries it rather than skipping a cadence.
          clients: current.clients.map((c) =>
            delivered.has(c.id)
              ? { ...c, lastContacted: now, nextSendAt: nextSendFrom(c.frequency, c.messageTypes) }
              : c,
          ),
        }));

        if (result.sent === 0) {
          const reason = (result.results ?? []).find((r) => r.error)?.error;
          throw new Error(reason ?? "The mail server did not accept any of the messages.");
        }
        return { sent: result.sent, failed: result.failed };
      },
      async saveMailAccount(account) {
        // One cadence and one set of message types for the whole list — saving the
        // configuration aligns every customer so the batch goes out together.
        patchData((current) => ({
          ...current,
          mailAccount: account,
          clients: current.clients.map((c) => ({
            ...c,
            frequency: account.sendFrequency,
            messageTypes: account.messageTypes,
            nextSendAt: nextSendFrom(account.sendFrequency, account.messageTypes),
          })),
        }));
        if (dbEnabled) {
          await withBusiness(async (business) => {
            await saveMailAccountRow(business.id, account);
            await Promise.all(
              (data?.clients ?? []).map((c) =>
                updateClientRow(c.id, {
                  frequency: account.sendFrequency,
                  messageTypes: account.messageTypes,
                  nextSendAt: nextSendFrom(account.sendFrequency, account.messageTypes),
                }),
              ),
            );
          });
        }
      },
      async toggleBuyList(recommendationId, on) {
        patchData((current) => ({
          ...current,
          buyList: on
            ? [...current.buyList, recommendationId]
            : current.buyList.filter((id) => id !== recommendationId),
        }));
        if (dbEnabled) {
          await withBusiness((business) =>
            on
              ? addBuyListItem(business.id, recommendationId)
              : removeBuyListItem(business.id, recommendationId),
          );
        }
      },
      // When a review reader is configured (SerpApi or Apify), "Scan reviews
      // now" runs the real sync. Without one we keep the queued-scan behaviour,
      // so the button still does something honest (it logs a scan and refreshes
      // the timestamp).
      async runReviewScan() {
        if (!dbEnabled || !profile) return null;
        const configured =
          data?.providerStatus.find((p) => p.provider === "reviews")?.configured === true;
        if (!configured) {
          const now = new Date().toISOString();
          patchData((current) => ({
            ...current,
            latestReviewScan: { ...current.latestReviewScan, scannedAt: now },
          }));
          await withBusiness((business) => markReviewScanComplete(business.id));
          return null;
        }
        try {
          const result = await invokeGateway<ReviewSyncResult>("reviews-sync", {
            businessId: profile.id,
          });
          await bootstrap();
          return result ?? null;
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "The review sync could not be run.");
          throw cause;
        }
      },
      async connectReviewProfile(input) {
        if (!dbEnabled) return;
        await withBusiness(async (business) => {
          const created = await saveReviewConnection(business.id, input);
          patchData((current) => ({
            ...current,
            reviewConnections: current.reviewConnections.some((c) => c.id === created.id)
              ? current.reviewConnections.map((c) => (c.id === created.id ? created : c))
              : [...current.reviewConnections, created],
          }));
        });
      },
      async removeReviewConnection(connectionId) {
        patchData((current) => ({
          ...current,
          reviewConnections: current.reviewConnections.filter((c) => c.id !== connectionId),
        }));
        if (dbEnabled) await withBusiness(() => deleteReviewConnection(connectionId));
      },
      async replyToReview(reviewId, reply) {
        if (!dbEnabled || !profile) return;
        try {
          await invokeGateway("review-reply", {
            businessId: profile.id,
            reviewId,
            reply,
          });
          await bootstrap();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "That reply could not be sent.");
          throw cause;
        }
      },
      async recordManualReviewReply(reviewId, reply) {
        if (!dbEnabled || !profile) return;
        const body = reply.trim();
        if (!body) return;
        await withBusiness(async (business) => {
          const saved = await saveManualReviewReply(business.id, reviewId, body);
          patchData((current) => ({
            ...current,
            latestReviewScan: {
              ...current.latestReviewScan,
              items: current.latestReviewScan.items.map((r) =>
                r.id === reviewId
                  ? { ...r, replied: true, replyText: body, repliedAt: saved.repliedAt }
                  : r,
              ),
            },
          }));
        });
      },
      // The scan/benchmark calls report failures to the caller as well as the
      // workspace `error` state: that state is not rendered once data has loaded,
      // so swallowing the error here would leave the page free to show a success
      // toast for a scan that never ran.
      async runSerpScan() {
        if (!dbEnabled || !profile) return null;
        try {
          const result = await invokeGateway<SerpScanResult>("serp-scan", {
            businessId: profile.id,
          });
          // Silent: the caller shows its own spinner, and blanking the whole app to
          // a loading screen would throw away what the user is reading before the
          // new data has even arrived.
          await bootstrap({ silent: true });
          return result ?? null;
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "The search scan could not be run.");
          throw cause;
        }
      },
      async runTrafficScan() {
        if (!dbEnabled || !profile) return null;
        try {
          const result = await invokeGateway<TrafficScanResult>("traffic-scan", {
            businessId: profile.id,
          });
          await bootstrap({ silent: true });
          return result ?? null;
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "The traffic scan could not be run.");
          throw cause;
        }
      },
      async runBuyList() {
        if (!dbEnabled || !profile) return null;
        try {
          const result = await invokeGateway<BuyListResult>("buy-list", {
            businessId: profile.id,
          });
          await bootstrap({ silent: true });
          return result ?? null;
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "The buy list could not be built.");
          throw cause;
        }
      },
      async runAdsScan() {
        if (!dbEnabled || !profile) return null;
        try {
          const result = await invokeGateway<AdsScanResult>("ads-scan", {
            businessId: profile.id,
          });
          await bootstrap({ silent: true });
          return result ?? null;
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "The ad scan could not be run.");
          throw cause;
        }
      },
      async runCompetitorBenchmark() {
        if (!dbEnabled || !profile) return null;
        try {
          const result = await invokeGateway<CompetitorBenchmarkResult>("serp-competitors", {
            businessId: profile.id,
          });
          await bootstrap({ silent: true });
          return result ?? null;
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : "The competitor benchmark could not be run.",
          );
          throw cause;
        }
      },
      async runSocialScan() {
        if (!dbEnabled || !profile) return null;
        try {
          // A manual scan is explicit intent, so it bypasses the cadence window;
          // the per-run and monthly spend caps still apply server-side.
          const result = await invokeGateway<SocialScanResult>("social-scan", {
            businessId: profile.id,
            force: true,
          });
          await bootstrap({ silent: true });
          return result ?? null;
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "The social scan could not be run.");
          throw cause;
        }
      },
      async saveCompetitorSocial(input) {
        if (!dbEnabled) return;
        await withBusiness(async (business) => {
          const saved = await saveCompetitorSocialHandle(business.id, input);
          patchData((current) => ({
            ...current,
            competitors: current.competitors.map((c) =>
              c.id === input.competitorId ? { ...c, social: mergeSocialChannel(c.social, saved) } : c,
            ),
          }));
        });
      },
      async removeCompetitorSocial(input) {
        const platform = socialPlatformKey(input.platform);
        patchData((current) => ({
          ...current,
          competitors: current.competitors.map((c) =>
            c.id === input.competitorId
              ? {
                  ...c,
                  social: c.social.filter((s) => socialPlatformKey(s.platform) !== platform),
                }
              : c,
          ),
        }));
        if (dbEnabled) {
          await withBusiness((business) => deleteCompetitorSocialHandle(business.id, input));
        }
      },
      async publishAd(input) {
        if (!dbEnabled || !profile) return null;
        try {
          const result = await invokeGateway<PublishAdResult>("publish-ad", {
            businessId: profile.id,
            deliveredAdId: input.deliveredAdId ?? undefined,
            briefId: input.briefId ?? undefined,
            accountIds: input.accountIds,
            caption: input.caption,
            scheduledFor: input.scheduledFor ?? undefined,
            timezone: input.timezone,
            mediaBase64: input.mediaBase64,
            mediaType: input.mediaType,
            mediaFilename: input.mediaFilename,
          });
          await bootstrap();
          return result ?? null;
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "The ad could not be published.");
          throw cause;
        }
      },
      async connectSocialAccounts() {
        if (!dbEnabled || !profile) return false;
        try {
          const result = await invokeGateway<SocialAccountsResult>("social-accounts", {
            businessId: profile.id,
          });
          await bootstrap();
          return (result?.accounts ?? 0) > 0;
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not load your social accounts.");
          throw cause;
        }
      },
      async saveOwnSocialHandles(handles) {
        if (!dbEnabled) return;
        await withBusiness(async (business) => {
          const saved = await saveSocialHandles(business.id, handles);
          patchData((current) => ({
            ...current,
            profile: { ...current.profile, socialHandles: saved },
          }));
        });
      },
      async findKeywordIdeas(seed) {
        if (!dbEnabled || !profile) return sampleKeywordIdeas(seed);
        const result = await invokeGateway<{ ideas: KeywordIdea[] }>("keyword-ideas", {
          businessId: profile.id,
          seed,
          // Also probe the intent-word prefixes, so the list is not just variants
          // of the seed term.
          expand: true,
        });
        const ideas = result?.ideas ?? [];
        patchData((current) => {
          const known = new Set(current.keywordIdeas.map((k) => k.suggestion));
          return {
            ...current,
            keywordIdeas: [...ideas.filter((i) => !known.has(i.suggestion)), ...current.keywordIdeas],
          };
        });
        return ideas;
      },
      async saveKeywordIdea(idea) {
        // Optimistic, so the row flips to "Tracked" straight away; rolled back
        // below if the write fails so the UI never claims a keyword we did not
        // actually save.
        const markTracked = (on: boolean) =>
          patchData((current) => ({
            ...current,
            keywordIdeas: current.keywordIdeas.map((k) =>
              k.id === idea.id ? { ...k, savedAsKeyword: on } : k,
            ),
          }));
        markTracked(true);
        if (!dbEnabled || !profile) return;
        try {
          await saveTrackedKeyword(profile.id, { id: idea.id, suggestion: idea.suggestion });
          await bootstrap();
        } catch (cause) {
          markTracked(false);
          setError(cause instanceof Error ? cause.message : "That keyword could not be saved.");
          throw cause;
        }
      },
      // AI drafting. Every one of these returns a draft for the user to work on:
      // none of them sends a reply, publishes a post or creates a brief. Without
      // a configured model the gateway refuses with a 409 naming the key to add,
      // which the caller surfaces as-is.
      async draftReviewReply(reviewId) {
        if (!dbEnabled || !profile) return null;
        try {
          return await invokeGateway<ReplyDraftResult>("ai-draft", {
            businessId: profile.id,
            task: "reply",
            reviewId,
          });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "A reply draft could not be written.");
          throw cause;
        }
      },
      async draftAdAngles(postId) {
        if (!dbEnabled || !profile) return null;
        try {
          return await invokeGateway<AngleDraftResult>("ai-draft", {
            businessId: profile.id,
            task: "angles",
            postId,
          });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Angles could not be drafted.");
          throw cause;
        }
      },
      async clusterKeywordIdeas(seed) {
        if (!dbEnabled || !profile) return null;
        const wanted = seed.trim();
        try {
          const result = await invokeGateway<ClusterDraftResult>("ai-draft", {
            businessId: profile.id,
            task: "clusters",
            seed: wanted,
          });
          // The labels are already written server-side; mirror them here so the
          // grouped list is correct without refetching the workspace.
          patchData((current) => ({
            ...current,
            keywordIdeas: current.keywordIdeas.map((idea) => {
              if (idea.seed !== wanted) return idea;
              const cluster = result.clusters.find((entry) =>
                entry.keywords.some(
                  (keyword) => keyword.toLowerCase() === idea.suggestion.toLowerCase(),
                ),
              );
              return { ...idea, cluster: cluster?.name ?? "" };
            }),
          }));
          return result;
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Those keywords could not be grouped.");
          throw cause;
        }
      },
      async uploadLogo(file) {
        if (!dbEnabled) {
          const logoUrl = await fileToDataUrl(file);
          setProfile((current) => (current ? { ...current, logoUrl } : current));
          patchData((current) => ({ ...current, profile: { ...current.profile, logoUrl } }));
          return;
        }
        if (!userId) throw new Error("You need to be signed in to upload a logo.");
        try {
          const logoUrl = await uploadBrandLogo(userId, file);
          await updateBrandLogo(userId, logoUrl);
          setProfile((current) => (current ? { ...current, logoUrl } : current));
          patchData((current) => ({ ...current, profile: { ...current.profile, logoUrl } }));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not upload the logo.");
          throw cause;
        }
      },
      async removeLogo() {
        setProfile((current) => (current ? { ...current, logoUrl: "" } : current));
        patchData((current) => ({ ...current, profile: { ...current.profile, logoUrl: "" } }));
        if (dbEnabled && userId) await deleteBrandLogo(userId);
      },
      async saveInventoryItem(input) {
        const { id, ...fields } = input;
        if (!dbEnabled) {
          patchData((current) => ({
            ...current,
            inventory: id
              ? current.inventory.map((item) => (item.id === id ? { ...item, ...fields } : item))
              : [
                  { ...fields, id: `inv-${Date.now()}`, createdAt: new Date().toISOString() },
                  ...current.inventory,
                ],
          }));
          return;
        }
        await withBusiness(async (business) => {
          if (id) {
            await updateInventoryItem(id, fields);
            patchData((current) => ({
              ...current,
              inventory: current.inventory.map((item) =>
                item.id === id ? { ...item, ...fields } : item,
              ),
            }));
          } else {
            const created = await createInventoryItem(business.id, fields);
            patchData((current) => ({ ...current, inventory: [created, ...current.inventory] }));
          }
        });
      },
      async removeInventoryItem(itemId) {
        patchData((current) => ({
          ...current,
          inventory: current.inventory.filter((item) => item.id !== itemId),
          promotionBriefs: current.promotionBriefs.map((p) =>
            p.itemId === itemId || p.serviceId === itemId || p.priceItemId === itemId
              ? {
                  ...p,
                  itemId: p.itemId === itemId ? null : p.itemId,
                  serviceId: p.serviceId === itemId ? null : p.serviceId,
                  priceItemId: p.priceItemId === itemId ? null : p.priceItemId,
                }
              : p,
          ),
        }));
        if (dbEnabled) await withBusiness(() => deleteInventoryItem(itemId));
      },
      async uploadInventoryImage(file) {
        if (!userId) throw new Error("You need to be signed in to upload an image.");
        return uploadInventoryImageFile(userId, file);
      },
      async savePromotionBrief(input) {
        const { id, ...fields } = input;
        const now = new Date().toISOString();
        if (!dbEnabled) {
          patchData((current) => ({
            ...current,
            promotionBriefs: id
              ? current.promotionBriefs.map((p) =>
                  p.id === id ? { ...p, ...fields, updatedAt: now } : p,
                )
              : [{ ...fields, id: `brief-${Date.now()}`, submittedAt: now, updatedAt: now },
                  ...current.promotionBriefs],
          }));
          return;
        }
        await withBusiness(async (business) => {
          if (id) {
            await updatePromotionBrief(id, fields);
            patchData((current) => ({
              ...current,
              promotionBriefs: current.promotionBriefs.map((p) =>
                p.id === id ? { ...p, ...fields, updatedAt: now } : p,
              ),
            }));
          } else {
            const created = await createPromotionBrief(business.id, fields);
            patchData((current) => ({
              ...current,
              promotionBriefs: [created, ...current.promotionBriefs],
            }));
          }
        });
      },
      async removePromotionBrief(briefId) {
        patchData((current) => ({
          ...current,
          promotionBriefs: current.promotionBriefs.filter((p) => p.id !== briefId),
          deliveredAds: current.deliveredAds.filter((a) => a.briefId !== briefId),
        }));
        if (dbEnabled) await withBusiness(() => deletePromotionBrief(briefId));
      },
    }),
    [data, patchData, withBusiness, scanSite, userId, profile, bootstrap],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      data,
      profile,
      loading,
      error,
      // No profile at all means the user has never onboarded — the row is only
      // created by finishing the wizard, so send them there instead of the
      // error screen. A real load error still wins, otherwise connection
      // problems would be hidden behind the onboarding form.
      needsOnboarding: !error && profile?.onboardingComplete !== true,
      mode: "live",
      refresh: bootstrap,
      completeOnboarding,
      actions,
    }),
    [data, profile, loading, error, bootstrap, completeOnboarding, actions],
  );

  if (!isLoaded) {
    return <WorkspaceLoading label="Checking your session…" />;
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/* --------------------------------------------------------------- entry point */

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  if (!authEnabled) return <DemoWorkspaceProvider>{children}</DemoWorkspaceProvider>;
  return <LiveWorkspaceProvider>{children}</LiveWorkspaceProvider>;
}

export function WorkspaceLoading({ label = "Loading your workspace…" }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <Matrix
        rows={7}
        cols={7}
        frames={loader}
        size={9}
        gap={3}
        fps={16}
        ariaLabel={label}
        className="text-primary"
      />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}
