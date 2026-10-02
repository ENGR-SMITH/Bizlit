import { requireSupabase } from "./supabase";
import { nextScanFrom, nextSendFrom } from "./schedule";
import type {
  AdAsset,
  ApiUsage,
  BusinessMetrics,
  BusinessProfile,
  Client,
  Competitor,
  CompetitorInput,
  CompetitorItem,
  CompetitorReview,
  CompetitorReviewGap,
  CompetitorSocialInput,
  GeoRankRow,
  InventoryItem,
  IntegrationConnection,
  IntegrationProvider,
  InventoryRecommendation,
  ItemKind,
  KeywordIdea,
  LocalPackEntry,
  LocalPackRanking,
  LocalProfileCheck,
  LocalProfileHealth,
  MailAccount,
  MessageType,
  MyReview,
  OnboardingInput,
  DeliveredAd,
  PromotionBrief,
  ProviderStatus,
  RankRow,
  ReviewConnection,
  ReviewScan,
  ReviewSource,
  ScanRun,
  SendFrequency,
  SentMessage,
  SerpRanking,
  ShareOfVoice,
  SocialAccount,
  SocialMonitorTarget,
  SocialPost,
  SocialPublishJob,
  SocialChannel,
  SocialScore,
  TrafficPoint,
  WeeklyReport,
  WorkspaceData,
} from "./types";
import type { Cadence, KeywordGap, AdCreative, AudienceSlice } from "./types";
import { buildProviderStatus, fetchProviderConfig } from "./integrations";
import { mergeSeoRankings } from "./rankings";
import { normaliseSocialHandle, socialPlatformOf } from "./social";

/* ------------------------------------------------------------------ helpers */

type Row = Record<string, any>;

function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : value === null || value === undefined ? fallback : String(value);
}

function rows<T>(response: { data: unknown; error: { message: string } | null }): T[] {
  if (response.error) throw new Error(response.error.message);
  return (response.data ?? []) as T[];
}

function orderBySort(list: Row[]): Row[] {
  return [...list].sort((a, b) => num(a.sort_order) - num(b.sort_order));
}

/** A stored rank of 0 means "not ranked yet" — keep that distinct from "#0". */
function rankOrNull(value: unknown): number | null {
  const parsed = num(value);
  return parsed > 0 ? parsed : null;
}

const EMPTY_METRICS: BusinessMetrics = {
  seoScore: 0,
  previousSeoScore: 0,
  geoScore: 0,
  previousGeoScore: 0,
  domainAuthority: 0,
  indexedPages: 0,
  backlinks: 0,
  industryRank: 0,
  industryRankPrevious: 0,
  monthlyVisits: 0,
  visitsChange: 0,
  conversionRate: 0,
  traffic: [],
  trafficSources: [],
  topServers: [],
};

/* --------------------------------------------------------------- onboarding */

export async function fetchBusiness(ownerUserId: string): Promise<BusinessProfile | null> {
  const db = requireSupabase();
  const response = await db
    .from("businesses")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();
  if (response.error) throw new Error(response.error.message);
  return response.data ? mapProfile(response.data as Row) : null;
}

/**
 * Creates the tenant row plus every source the user listed during onboarding,
 * so the pages have their real competitors and clients from day one.
 */
export async function createWorkspaceFromOnboarding(
  ownerUserId: string,
  ownerEmail: string,
  input: OnboardingInput,
): Promise<BusinessProfile> {
  const db = requireSupabase();

  const { data: business, error } = await db
    .from("businesses")
    .insert({
      owner_user_id: ownerUserId,
      owner_email: ownerEmail,
      brand_name: input.brandName,
      legal_name: input.legalName,
      industry: input.industry,
      niche: input.niche,
      primary_domain: input.primaryDomain,
      secondary_domains: input.secondaryDomains,
      platform_type: input.platformType,
      country: input.country,
      currency: input.currency,
      timezone: input.timezone,
      team_size: input.teamSize,
      primary_goal: input.primaryGoal,
      goals: input.goals,
      ad_platforms: input.adPlatforms,
      social_handles: input.socialHandles,
      notification_email: input.notificationEmail || ownerEmail,
      report_day: input.reportDay,
      onboarding_complete: true,
      onboarding_completed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !business) throw new Error(error?.message ?? "Could not create the business profile.");

  const businessId = business.id as string;
  const now = new Date().toISOString();

  // Inserted one at a time, and read back, because a competitor's social profiles
  // have to hang off a row that exists — `competitor_social` carries a
  // `competitor_id`. A bulk insert would not tell us which id belongs to which
  // input row (PostgREST is not obliged to return them in input order), and
  // keying on the name would be wrong: two competitors may legitimately share one.
  // The list is a handful of rows, so the extra round trips are not worth avoiding.
  const competitorInputs = input.competitors.filter((c) => c.name.trim());
  for (const competitor of competitorInputs) {
    const { data: created, error: competitorError } = await db
      .from("competitors")
      .insert({
        business_id: businessId,
        name: competitor.name.trim(),
        website: competitor.website.trim(),
        cadence: competitor.cadence || "daily",
        notes: competitor.category ? `Category: ${competitor.category}` : null,
      })
      .select()
      .single();
    if (competitorError || !created) {
      throw new Error(competitorError?.message ?? "Could not add a competitor.");
    }

    // Written through the same function the Competition page and (in Phase 3)
    // discovery use, so there is one place that normalises a handle, drops rows it
    // cannot address, and upserts on `(business_id, competitor_id, platform)` —
    // adding the same platform twice replaces rather than stacking a target.
    if (competitor.socials?.length) {
      await saveCompetitorSocialHandles(businessId, {
        competitorId: created.id as string,
        handles: competitor.socials,
        source: "manual",
      });
    }
  }

  const clientPayload = input.seedClients
    .filter((c) => c.email.trim())
    .map((c) => ({
      business_id: businessId,
      name: c.name.trim() || c.email.split("@")[0],
      email: c.email.trim(),
      company: c.company.trim(),
      industry: input.industry,
      status: "active" as const,
      frequency: c.frequency || input.clientCadence,
      message_types: c.messageTypes.length ? c.messageTypes : input.clientMessageTypes,
      next_send_at: nextSendFrom(c.frequency || input.clientCadence, c.messageTypes),
    }));

  if (clientPayload.length) {
    const { error: clientError } = await db.from("clients").insert(clientPayload);
    if (clientError) throw new Error(clientError.message);
  }

  const { error: mailError } = await db.from("mail_accounts").insert({
    business_id: businessId,
    sender_name: input.brandName,
    login_email: input.loginEmail || ownerEmail,
    reply_to: input.loginEmail || ownerEmail,
    secondary_email: ownerEmail,
    signature: input.signature,
    timezone: input.timezone,
    daily_digest: true,
  });
  if (mailError) throw new Error(mailError.message);

  await db.from("scan_runs").insert({
    business_id: businessId,
    source_type: "competitor",
    source_name: "Onboarding baseline scan",
    status: "queued",
    started_at: now,
  });

  return mapProfile(business as Row);
}

/* ----------------------------------------------------------------- loading */

export async function loadWorkspace(profile: BusinessProfile): Promise<WorkspaceData> {
  const db = requireSupabase();
  const id = profile.id;

  const [
    competitorsRes,
    metricsRes,
    socialRes,
    keywordsRes,
    adsRes,
    reviewsRes,
    audienceRes,
    itemsRes,
    clientsRes,
    mailRes,
    sentRes,
    myKeywordsRes,
    myMetricsRes,
    reviewSourcesRes,
    reviewSeriesRes,
    myReviewsRes,
    adAssetsRes,
    socialScoresRes,
    recommendationsRes,
    buyListRes,
    reportsRes,
    scanRunsRes,
    inventoryRes,
    promotionsRes,
    deliveredAdsRes,
    integrationConnectionsRes,
    apiUsageRes,
    serpRankingsRes,
    localPackRes,
    localProfileRes,
    keywordIdeasRes,
    shareOfVoiceRes,
    competitorReviewGapRes,
    socialPostsRes,
    socialTargetsRes,
    reviewConnectionsRes,
    socialAccountsRes,
    publishJobsRes,
  ] = await Promise.all([
    db.from("competitors").select("*").eq("business_id", id).order("monthly_visits", { ascending: false }),
    db.from("competitor_metrics").select("*").eq("business_id", id),
    db.from("competitor_social").select("*").eq("business_id", id),
    db.from("competitor_keywords").select("*").eq("business_id", id),
    db.from("competitor_ads").select("*").eq("business_id", id).order("first_seen_at", { ascending: false }),
    db.from("competitor_reviews").select("*").eq("business_id", id).order("posted_at", { ascending: false }),
    db.from("competitor_audience").select("*").eq("business_id", id).order("share", { ascending: false }),
    db.from("competitor_items").select("*").eq("business_id", id).order("detected_at", { ascending: false }),
    db.from("clients").select("*").eq("business_id", id).order("name"),
    db.from("mail_accounts").select("*").eq("business_id", id).maybeSingle(),
    db.from("sent_messages").select("*").eq("business_id", id).order("sent_at", { ascending: false }).limit(100),
    db.from("my_keywords").select("*").eq("business_id", id),
    db.from("my_metrics").select("*").eq("business_id", id),
    db.from("my_review_sources").select("*").eq("business_id", id),
    db.from("my_review_series").select("*").eq("business_id", id),
    db.from("my_reviews").select("*").eq("business_id", id).order("posted_at", { ascending: false }).limit(100),
    db.from("ad_assets").select("*").eq("business_id", id).order("shoot_date", { ascending: false }),
    db.from("social_scores").select("*").eq("business_id", id).order("score", { ascending: false }),
    db.from("inventory_recommendations").select("*").eq("business_id", id).order("traffic_potential", { ascending: false }),
    db.from("buy_list_items").select("*").eq("business_id", id),
    db.from("weekly_reports").select("*").eq("business_id", id).order("week_start", { ascending: false }).limit(12),
    db.from("scan_runs").select("*").eq("business_id", id).order("started_at", { ascending: false }).limit(50),
    db.from("inventory_items").select("*").eq("business_id", id).order("created_at", { ascending: false }),
    db.from("promotion_briefs").select("*").eq("business_id", id).order("updated_at", { ascending: false }),
    db.from("delivered_ads").select("*").eq("business_id", id).order("delivered_at", { ascending: false }),
    db.from("integration_connections").select("*").eq("business_id", id).order("created_at", { ascending: false }),
    db.from("api_usage_log").select("*").eq("business_id", id).order("created_at", { ascending: false }).limit(1000),
    db.from("serp_rankings").select("*").eq("business_id", id).order("checked_at", { ascending: false }),
    db.from("local_pack_rankings").select("*").eq("business_id", id).order("checked_at", { ascending: false }),
    db.from("local_profile_health").select("*").eq("business_id", id).limit(1),
    db.from("keyword_ideas").select("*").eq("business_id", id).order("relevance", { ascending: false }).limit(50),
    db.from("competitor_share_of_voice").select("*").eq("business_id", id),
    db.from("competitor_review_gap").select("*").eq("business_id", id),
    db.from("social_posts").select("*").eq("business_id", id).order("posted_at", { ascending: false }).limit(300),
    db.from("social_monitor_targets").select("*").eq("business_id", id),
    db.from("review_connections").select("*").eq("business_id", id).order("created_at", { ascending: true }),
    db.from("social_accounts").select("*").eq("business_id", id).order("platform"),
    db.from("social_publish_jobs").select("*").eq("business_id", id).order("created_at", { ascending: false }).limit(100),
  ]);

  const competitorRows = rows<Row>(competitorsRes);
  const metricRows = rows<Row>(metricsRes);
  const socialRows = rows<Row>(socialRes);
  const keywordRows = rows<Row>(keywordsRes);
  const adRows = rows<Row>(adsRes);
  const reviewRows = rows<Row>(reviewsRes);
  const audienceRows = rows<Row>(audienceRes);
  const itemRows = rows<Row>(itemsRes);
  const clientRows = rows<Row>(clientsRes);
  const myKeywordRows = rows<Row>(myKeywordsRes);
  const myMetricRows = rows<Row>(myMetricsRes);
  const reviewSourceRows = rows<Row>(reviewSourcesRes);
  const reviewSeriesRows = rows<Row>(reviewSeriesRes);
  const myReviewRows = rows<Row>(myReviewsRes);
  const scanRows = rows<Row>(scanRunsRes);

  const integrationConnections = rows<Row>(integrationConnectionsRes).map(mapIntegrationConnection);
  const apiUsage = rows<Row>(apiUsageRes).map(mapApiUsageRow);
  const serpRankings = rows<Row>(serpRankingsRes).map(mapSerpRanking);
  const localPackRankings = rows<Row>(localPackRes).map(mapLocalPackRanking);
  const localProfileRow = rows<Row>(localProfileRes)[0];
  const localProfileHealth: LocalProfileHealth | null = localProfileRow
    ? mapLocalProfileHealth(localProfileRow)
    : null;
  const keywordIdeaRows = rows<Row>(keywordIdeasRes).map(mapKeywordIdea);
  const shareOfVoice = rows<Row>(shareOfVoiceRes).map(mapShareOfVoice);
  const competitorReviewGaps = rows<Row>(competitorReviewGapRes).map(mapCompetitorReviewGap);
  // Newest first, with posts that arrived without a timestamp last.
  const socialPosts = rows<Row>(socialPostsRes)
    .map(mapSocialPost)
    .sort((a, b) => (b.postedAt ?? b.scrapedAt).localeCompare(a.postedAt ?? a.scrapedAt));
  const socialMonitorTargets = rows<Row>(socialTargetsRes).map(mapSocialMonitorTarget);
  const reviewConnections = rows<Row>(reviewConnectionsRes).map(mapReviewConnection);
  const socialAccounts = rows<Row>(socialAccountsRes).map(mapSocialAccount);
  const publishJobs = rows<Row>(publishJobsRes).map(mapSocialPublishJob);
  // Which providers the server actually holds credentials for. Best effort — an
  // undeployed gateway simply reports everything as unconfigured.
  const providerStatus = buildProviderStatus({
    connections: integrationConnections,
    usage: apiUsage,
    config: await fetchProviderConfig(),
  });

  const competitors: Competitor[] = competitorRows.map((c) => {
    const related = (list: Row[]) => list.filter((r) => r.competitor_id === c.id);
    return {
      ...mapCompetitorBase(c),
      traffic: orderBySort(related(metricRows).filter((m) => m.kind === "traffic")).map((m) => ({
        label: str(m.label),
        visits: num(m.value),
      })),
      reviewTrend: orderBySort(related(metricRows).filter((m) => m.kind === "review_trend")).map((m) => ({
        label: str(m.label),
        visits: num(m.value),
      })),
      trafficSources: orderBySort(related(metricRows).filter((m) => m.kind === "traffic_source")).map((m) => ({
        label: str(m.label),
        share: num(m.value),
      })),
      social: related(socialRows).map<SocialChannel>(mapSocialChannel),
      keywordGap: related(keywordRows).map<KeywordGap>((k) => ({
        keyword: str(k.keyword),
        volume: num(k.volume),
        ourRank: k.our_rank === null || k.our_rank === undefined ? null : num(k.our_rank),
        theirRank: num(k.their_rank),
        difficulty: num(k.difficulty),
        intent: (str(k.intent, "commercial") as KeywordGap["intent"]),
      })),
      ads: related(adRows).map<AdCreative>((a) => ({
        id: a.id,
        platform: str(a.platform),
        headline: str(a.headline),
        audience: str(a.audience),
        firstSeen: str(a.first_seen_at, new Date().toISOString()),
        status: (a.status ?? "active") as AdCreative["status"],
        focus: str(a.focus),
        bannerUrl: str(a.banner_url),
        landingUrl: str(a.landing_url),
      })),
      reviews: related(reviewRows).map<CompetitorReview>((r) => ({
        id: r.id,
        author: str(r.author),
        rating: num(r.rating),
        postedAt: str(r.posted_at, new Date().toISOString()),
        source: str(r.source),
        text: str(r.body),
        sentiment: (r.sentiment ?? "neutral") as CompetitorReview["sentiment"],
      })),
      audience: related(audienceRows).map<AudienceSlice>((a) => ({
        segment: str(a.segment),
        ageRange: str(a.age_range),
        share: num(a.share),
      })),
      newItems: related(itemRows).map<CompetitorItem>((i) => ({
        id: i.id,
        product: str(i.product),
        sku: str(i.sku),
        category: str(i.category),
        kind: (i.kind ?? "product") as ItemKind,
        price: num(i.price),
        previousPrice: num(i.previous_price, num(i.price)),
        stock: (i.stock ?? "in_stock") as CompetitorItem["stock"],
        previousStock: (i.previous_stock ?? "in_stock") as CompetitorItem["stock"],
        change: (i.change ?? "new_product") as CompetitorItem["change"],
        detectedAt: str(i.detected_at, new Date().toISOString()),
        url: str(i.url),
      })),
    };
  });

  /**
   * Where our measured traffic sits against the rivals we measure.
   *
   * Derived here, at load, rather than read from `businesses.industry_rank` — that
   * column has no writer, so the My Business tile rendered an em dash beside a
   * hint claiming movement "in your industry", which is the worst of both. The one
   * comparison the data actually supports is against the tracked set: we hold a
   * measured monthly figure for our own site and for each rival, from the same
   * provider run, so the ranking is a real ordering of comparable estimates. It is
   * *not* an industry-wide rank, and the tile says "of the ones you track".
   *
   * Competitors with no measured traffic are left out of the ordering rather than
   * counted as zero: an unmeasured rival is not a smaller rival.
   */
  const visitCounts = competitorRows
    .map((c) => num((c as Row).monthly_visits))
    .filter((visits) => visits > 0);
  const industryRank =
    profile.monthlyVisits > 0
      ? 1 + visitCounts.filter((visits) => visits > profile.monthlyVisits).length
      : 0;

  const metrics: BusinessMetrics = {
    ...EMPTY_METRICS,
    seoScore: profile.seoScore,
    previousSeoScore: profile.previousSeoScore,
    geoScore: profile.geoScore,
    previousGeoScore: profile.previousGeoScore,
    domainAuthority: profile.domainAuthority,
    indexedPages: profile.indexedPages,
    backlinks: profile.backlinks,
    industryRank,
    // The ranking is recomputed from the figures on every load, so there is no
    // stored previous to compare against unless one was written by hand; saying
    // "no change" is the truthful default rather than inventing a movement.
    industryRankPrevious: profile.industryRankPrevious || industryRank,
    monthlyVisits: profile.monthlyVisits,
    visitsChange: profile.visitsChange,
    conversionRate: profile.conversionRate,
    traffic: orderBySort(myMetricRows.filter((m) => m.kind === "traffic")).map((m) => ({
      label: str(m.label),
      visits: num(m.value),
    })),
    trafficSources: orderBySort(myMetricRows.filter((m) => m.kind === "channel")).map((m) => ({
      label: str(m.label),
      share: num(m.value),
    })),
    topServers: orderBySort(myMetricRows.filter((m) => m.kind === "search_surface")).map((m) => ({
      name: str(m.label),
      share: num(m.value),
    })),
  };

  const reviewSeries: Record<string, TrafficPoint[]> = {};
  for (const row of orderBySort(reviewSeriesRows)) {
    const key = str(row.source);
    reviewSeries[key] = reviewSeries[key] ?? [];
    reviewSeries[key].push({ label: str(row.label), visits: num(row.score) });
  }

  const reviewSources: ReviewSource[] = reviewSourceRows.map((s) => ({
    source: str(s.source),
    score: num(s.score),
    previousScore: num(s.previous_score, num(s.score)),
    reviews: num(s.reviews),
    newThisMonth: num(s.new_this_month),
    series: reviewSeries[str(s.source)] ?? [],
  }));

  const reviewScanRuns = scanRows.filter((r) => r.source_type === "reviews");
  const reviewsPostedRecently = myReviewRows.filter(
    (r) => new Date(str(r.posted_at)).getTime() > Date.now() - 7 * 864e5,
  );

  const latestReviewScan: ReviewScan = {
    scannedAt: str(reviewScanRuns[0]?.finished_at ?? reviewScanRuns[0]?.started_at, new Date().toISOString()),
    nextScanAt: nextScanFrom("weekly"),
    newReviews: reviewsPostedRecently.length,
    flagged: myReviewRows.filter((r) => r.is_flagged).length,
    averageRating: myReviewRows.length
      ? Number((myReviewRows.reduce((sum, r) => sum + num(r.rating), 0) / myReviewRows.length).toFixed(2))
      : 0,
    items: myReviewRows.map<MyReview>((r) => ({
      id: r.id,
      author: str(r.author),
      rating: num(r.rating),
      source: str(r.source),
      postedAt: str(r.posted_at, new Date().toISOString()),
      text: str(r.body),
      sentiment: (r.sentiment ?? "neutral") as MyReview["sentiment"],
      action: str(r.action),
      isFlagged: Boolean(r.is_flagged),
      externalId: str(r.external_id),
      platform: str(r.platform),
      language: str(r.language),
      replied: Boolean(r.replied),
      replyText: str(r.reply_text),
      repliedAt: r.replied_at ? str(r.replied_at) : null,
    })),
  };

  const mailAccount: MailAccount = mailRes.data
    ? {
        senderName: str((mailRes.data as Row).sender_name, profile.brandName),
        loginEmail: str((mailRes.data as Row).login_email, profile.ownerEmail),
        replyTo: str((mailRes.data as Row).reply_to, profile.ownerEmail),
        secondaryEmail: str((mailRes.data as Row).secondary_email, profile.ownerEmail),
        signature: str((mailRes.data as Row).signature),
        timezone: str((mailRes.data as Row).timezone, profile.timezone),
        dailyDigest: (mailRes.data as Row).daily_digest !== false,
        sendFrequency: ((mailRes.data as Row).send_frequency ?? "weekly") as SendFrequency,
        messageTypes: ((mailRes.data as Row).message_types ?? [
          "new_stock",
          "deals",
        ]) as MessageType[],
      }
    : {
        senderName: profile.brandName,
        loginEmail: profile.ownerEmail,
        replyTo: profile.ownerEmail,
        secondaryEmail: profile.ownerEmail,
        signature: "",
        timezone: profile.timezone,
        dailyDigest: true,
        sendFrequency: "weekly",
        messageTypes: ["new_stock", "deals"],
      };

  const workspace: WorkspaceData = {
    /* downloadUrl is filled with a signed Storage URL below */
    profile,
    metrics,
    competitors,
    clients: clientRows.map<Client>((c) => ({
      id: c.id,
      name: str(c.name),
      email: str(c.email),
      company: str(c.company),
      industry: str(c.industry),
      status: (c.status ?? "active") as Client["status"],
      tier: (c.tier ?? "starter") as Client["tier"],
      joinedAt: str(c.joined_at, new Date().toISOString()),
      lastContacted: str(c.last_contacted_at, str(c.created_at, new Date().toISOString())),
      nextSendAt: str(c.next_send_at, nextSendFrom((c.frequency ?? "weekly") as SendFrequency)),
      frequency: (c.frequency ?? "weekly") as SendFrequency,
      messageTypes: (c.message_types ?? []) as MessageType[],
      openRate: num(c.open_rate),
      monthlyFee: num(c.monthly_fee),
      notes: str(c.notes) || undefined,
    })),
    mailAccount,
    sentMessages: rows<Row>(sentRes).map<SentMessage>((m) => ({
      id: m.id,
      clientId: str(m.client_id),
      clientName: str(m.client_name),
      subject: str(m.subject),
      types: (m.types ?? []) as MessageType[],
      sentAt: str(m.sent_at, new Date().toISOString()),
      status: (m.status ?? "delivered") as SentMessage["status"],
    })),
    // Tracked terms carry the live positions from the last Google scan, so the
    // SEO tab shows where we actually sit rather than the stored placeholder.
    topSeoKeywords: mergeSeoRankings(
      myKeywordRows
        .filter((k) => (k.kind ?? "seo") === "seo")
        .map<RankRow>((k) => ({
          keyword: str(k.keyword),
          volume: num(k.volume),
          position: rankOrNull(k.position),
          change: num(k.change),
        })),
      serpRankings,
    ),
    topGeoKeywords: myKeywordRows
      .filter((k) => k.kind === "geo")
      .map<GeoRankRow>((k) => ({
        prompt: str(k.keyword),
        engine: str(k.engine),
        position: num(k.position),
        // Written into `volume` by `serp-scan`: the column is generic on purpose, so
        // adding a metric does not need a migration.
        sources: num(k.volume),
      }))
      .sort((a, b) => b.position - a.position),
    serpRankings,
    localPackRankings,
    localProfileHealth,
    keywordIdeas: keywordIdeaRows,
    shareOfVoice,
    competitorReviewGaps,
    socialPosts,
    socialMonitorTargets,
    geoVisibility: orderBySort(myMetricRows.filter((m) => m.kind === "geo_visibility")).map((m) => ({
      label: str(m.label),
      visits: num(m.value),
    })),
    weeklyReports: rows<Row>(reportsRes).map<WeeklyReport>((r) => ({
      week: str(r.week_label),
      seoScore: num(r.seo_score),
      geoScore: num(r.geo_score),
      visits: num(r.visits),
      conversions: num(r.conversions),
      highlight: str(r.highlight),
      actions: (r.actions ?? []) as string[],
    })),
    reviewSources,
    latestReviewScan,
    reviewConnections,
    socialAccounts,
    publishJobs,
    adAssets: rows<Row>(adAssetsRes).map<AdAsset>((a) => ({
      id: a.id,
      product: str(a.product),
      sku: str(a.sku),
      formats: (a.formats ?? []) as string[],
      shootStatus: (a.shoot_status ?? "scheduled") as AdAsset["shootStatus"],
      shootDate: str(a.shoot_date, new Date().toISOString()),
      figmaUrl: str(a.figma_url),
      downloadUrl: null,
      storagePath: str(a.storage_path) || null,
      sizeMb: num(a.size_mb),
      downloads: num(a.downloads),
    })),
    socialScores: rows<Row>(socialScoresRes).map<SocialScore>((s) => ({
      platform: str(s.platform),
      handle: str(s.handle),
      score: num(s.score),
      followers: num(s.followers),
      growth: num(s.growth),
      benchmarkGap: num(s.benchmark_gap),
      focus: (s.focus ?? "medium") as SocialScore["focus"],
      reason: str(s.reason),
    })),
    inventoryRecommendations: rows<Row>(recommendationsRes).map<InventoryRecommendation>((r) => ({
      id: r.id,
      product: str(r.product),
      category: str(r.category),
      suggestedQty: num(r.suggested_qty),
      estimatedPrice: num(r.estimated_price),
      marginPct: num(r.margin_pct),
      trafficPotential: num(r.traffic_potential),
      reason: str(r.reason),
      priority: (r.priority ?? "medium") as InventoryRecommendation["priority"],
      competitorRef: str(r.competitor_ref),
    })),
    inventory: rows<Row>(inventoryRes).map<InventoryItem>((i) => ({
      id: i.id,
      kind: (i.kind ?? "product") as InventoryItem["kind"],
      name: str(i.name),
      sku: str(i.sku),
      category: str(i.category),
      description: str(i.description),
      price: num(i.price),
      compareAtPrice: num(i.compare_at_price),
      stock: num(i.stock),
      status: (i.status ?? "active") as InventoryItem["status"],
      imageUrl: str(i.image_url),
      tags: (i.tags ?? []) as string[],
      createdAt: str(i.created_at, new Date().toISOString()),
    })),
    promotionBriefs: rows<Row>(promotionsRes).map<PromotionBrief>((p) => ({
      id: p.id,
      name: str(p.name, "Untitled ad brief"),
      itemId: p.item_id ? str(p.item_id) : null,
      serviceId: p.service_id ? str(p.service_id) : null,
      priceItemId: p.price_item_id ? str(p.price_item_id) : null,
      contactInfo: str(p.contact_info),
      template: (p.template ?? "square") as PromotionBrief["template"],
      accentColor: str(p.accent_color, "#4f46e5"),
      components: (p.components ?? []) as PromotionBrief["components"],
      discountKind: (p.discount_kind ?? "percent") as PromotionBrief["discountKind"],
      discountValue: num(p.discount_value),
      dealText: str(p.deal_text),
      couponCode: str(p.coupon_code),
      headline: str(p.headline),
      notes: str(p.notes),
      status: (p.status ?? "submitted") as PromotionBrief["status"],
      submittedAt: str(p.submitted_at, new Date().toISOString()),
      updatedAt: str(p.updated_at, new Date().toISOString()),
    })),
    deliveredAds: rows<Row>(deliveredAdsRes).map<DeliveredAd>((a) => ({
      id: a.id,
      briefId: a.brief_id ? str(a.brief_id) : null,
      name: str(a.name, "Ad design"),
      template: (a.template ?? "square") as DeliveredAd["template"],
      fileUrl: str(a.file_url),
      storagePath: str(a.storage_path),
      sizeMb: num(a.size_mb),
      downloads: num(a.downloads),
      note: str(a.note),
      deliveredAt: str(a.delivered_at, new Date().toISOString()),
    })),
    buyList: rows<Row>(buyListRes).map((b) => str(b.recommendation_id)),
    scanRuns: scanRows.map<ScanRun>((r) => ({
      id: r.id,
      sourceType: (r.source_type ?? "competitor") as ScanRun["sourceType"],
      sourceId: r.source_id ?? null,
      sourceName: str(r.source_name),
      status: (r.status ?? "queued") as ScanRun["status"],
      changesFound: num(r.changes_found),
      error: str(r.error) || null,
      startedAt: str(r.started_at, new Date().toISOString()),
      finishedAt: str(r.finished_at) || null,
    })),
    integrationConnections,
    providerStatus,
    apiUsage,
    isSample: competitorRows.length === 0 && clientRows.length === 0,
  };

  // Private bucket: hand back a short-lived signed URL per exported ad pack.
  if (db) {
    workspace.adAssets = await Promise.all(
      workspace.adAssets.map(async (asset) => {
        if (!asset.storagePath) return asset;
        try {
          const { data } = await db.storage.from("ad-assets").createSignedUrl(asset.storagePath, 3600);
          return { ...asset, downloadUrl: data?.signedUrl ?? null };
        } catch {
          return asset;
        }
      }),
    );
  }

  return workspace;
}

/* --------------------------------------------------------------- mutations */

export async function setCompetitorCadence(competitorId: string, cadence: Cadence) {
  const db = requireSupabase();
  const { error } = await db
    .from("competitors")
    .update({ cadence })
    .eq("id", competitorId);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------- watched sources (add / edit / remove) */

/**
 * Adds a competitor.
 *
 * The created row comes back in the client shape so the page can show and select
 * it without a reload. A brand-new competitor genuinely has no traffic, keywords,
 * posts or reviews yet, which is exactly what `mapCompetitorBase` returns — so
 * nothing here has to invent placeholder numbers.
 */
export async function createCompetitorRow(
  businessId: string,
  input: CompetitorInput,
): Promise<Competitor> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("competitors")
    .insert({
      business_id: businessId,
      name: input.name.trim(),
      website: input.website.trim(),
      cadence: input.cadence,
      notes: input.notes?.trim() || null,
    })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not add that competitor.");

  return mapCompetitorBase(data as Row);
}

/**
 * Edits the columns the competitor form owns, and only those.
 *
 * Changing the website does not detach the competitor's history: scans, posts and
 * reviews all hang off `competitor_id`, so they stay attached to the same row.
 */
export async function updateCompetitorRow(competitorId: string, patch: Partial<CompetitorInput>) {
  const db = requireSupabase();
  const payload: Row = {};
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.website !== undefined) payload.website = patch.website.trim();
  if (patch.cadence !== undefined) payload.cadence = patch.cadence;
  if (patch.notes !== undefined) payload.notes = patch.notes.trim() || null;
  if (!Object.keys(payload).length) return;

  const { error } = await db.from("competitors").update(payload).eq("id", competitorId);
  if (error) throw new Error(error.message);
}

/**
 * Stops watching a competitor.
 *
 * Every child table references `competitors` with `on delete cascade`, so one
 * delete also clears their metrics, social handles, keywords, ads, reviews,
 * audience slices, detected items, share of voice, review gap, scraped posts and
 * monitor targets. The UI must say so before it calls this — there is no undo.
 */
export async function deleteCompetitorRow(competitorId: string) {
  const db = requireSupabase();
  const { error } = await db.from("competitors").delete().eq("id", competitorId);
  if (error) throw new Error(error.message);
}

/**
 * Saves a competitor's whole set of profiles in one call — the onboarding path,
 * where a competitor can arrive with several.
 *
 * One row per competitor per platform, which is what the unique index from
 * `0016_competitor_social_handles.sql` enforces, so re-saving a platform replaces
 * its handle instead of stacking a second scrape target.
 *
 * Handles are normalised to the bare username first. The gateway builds the
 * profile URL around what is stored, so a pasted profile URL would be embedded
 * inside another URL and the scrape would quietly return nothing.
 *
 * Rows we cannot address are dropped rather than saved: a handle with no platform,
 * or a blank one, is a billed target that can only ever come back empty. The first
 * entry wins when the same platform appears twice, matching `mergeSocialChannel`.
 */
export async function saveCompetitorSocialHandles(
  businessId: string,
  input: {
    competitorId: string;
    handles: CompetitorSocialInput[];
    /** Defaults to `manual`: a person entered it. */
    source?: "manual" | "discovered" | "imported";
  },
): Promise<SocialChannel[]> {
  const db = requireSupabase();
  const source = input.source ?? "manual";

  const seen = new Set<string>();
  const payload = input.handles
    .map((row) => ({
      platform: socialPlatformOf(row.platform) ?? row.platform.trim().toLowerCase(),
      handle: normaliseSocialHandle(row.handle),
      // A row may carry its own provenance: onboarding records an accepted
      // proposal as `discovered` and anything the user corrected as `manual`, in
      // one save. Rows without one take the call's default.
      source: row.source ?? source,
    }))
    .filter((row) => {
      if (!row.platform || !row.handle || seen.has(row.platform)) return false;
      seen.add(row.platform);
      return true;
    });
  if (!payload.length) return [];

  const { data, error } = await db
    .from("competitor_social")
    .upsert(
      payload.map((row) => ({
        business_id: businessId,
        competitor_id: input.competitorId,
        platform: row.platform,
        handle: row.handle,
        source: row.source,
        discovered_at: row.source === "discovered" ? new Date().toISOString() : null,
      })),
      { onConflict: "business_id,competitor_id,platform" },
    )
    .select();
  if (error) throw new Error(error.message);

  return ((data ?? []) as Row[]).map(mapSocialChannel);
}

export async function createClientRow(
  businessId: string,
  input: {
    name: string;
    email: string;
    company: string;
    industry: string;
    tier: Client["tier"];
    frequency: SendFrequency;
    messageTypes: MessageType[];
    monthlyFee: number;
  },
): Promise<Client> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("clients")
    .insert({
      business_id: businessId,
      name: input.name,
      email: input.email,
      company: input.company,
      industry: input.industry,
      status: "active",
      tier: input.tier,
      frequency: input.frequency,
      message_types: input.messageTypes,
      monthly_fee: input.monthlyFee,
      last_contacted_at: new Date().toISOString(),
      next_send_at: nextSendFrom(input.frequency, input.messageTypes),
    })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not add the customer.");

  return {
    id: data.id,
    name: data.name,
    email: data.email,
    company: str(data.company),
    industry: str(data.industry),
    status: "active",
    tier: input.tier,
    joinedAt: data.joined_at,
    lastContacted: data.last_contacted_at,
    nextSendAt: data.next_send_at,
    frequency: input.frequency,
    messageTypes: input.messageTypes,
    openRate: 0,
    monthlyFee: input.monthlyFee,
  };
}

export async function updateClientRow(clientId: string, patch: Partial<Client>) {
  const db = requireSupabase();
  const payload: Row = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.email !== undefined) payload.email = patch.email;
  if (patch.company !== undefined) payload.company = patch.company;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.tier !== undefined) payload.tier = patch.tier;
  if (patch.notes !== undefined) payload.notes = patch.notes;
  if (patch.frequency !== undefined) {
    payload.frequency = patch.frequency;
    payload.next_send_at = nextSendFrom(patch.frequency, patch.messageTypes ?? []);
  }
  if (patch.messageTypes !== undefined) payload.message_types = patch.messageTypes;
  if (patch.lastContacted !== undefined) payload.last_contacted_at = patch.lastContacted;
  if (patch.nextSendAt !== undefined) payload.next_send_at = patch.nextSendAt;
  if (!Object.keys(payload).length) return;

  const { error } = await db.from("clients").update(payload).eq("id", clientId);
  if (error) throw new Error(error.message);
}

export async function deleteClientRow(clientId: string) {
  const db = requireSupabase();
  const { error } = await db.from("clients").delete().eq("id", clientId);
  if (error) throw new Error(error.message);
}

export async function logSentMessages(
  businessId: string,
  messages: { clientId: string; clientName: string; subject: string; types: MessageType[] }[],
) {
  const db = requireSupabase();
  const now = new Date().toISOString();
  const { error } = await db.from("sent_messages").insert(
    messages.map((m) => ({
      business_id: businessId,
      client_id: m.clientId,
      client_name: m.clientName,
      subject: m.subject,
      types: m.types,
      status: "delivered",
      sent_at: now,
    })),
  );
  if (error) throw new Error(error.message);
}

export async function saveMailAccountRow(businessId: string, account: MailAccount) {
  const db = requireSupabase();
  const { error } = await db.from("mail_accounts").upsert(
    {
      business_id: businessId,
      sender_name: account.senderName,
      login_email: account.loginEmail,
      reply_to: account.replyTo,
      secondary_email: account.secondaryEmail,
      signature: account.signature,
      timezone: account.timezone,
      daily_digest: account.dailyDigest,
      send_frequency: account.sendFrequency,
      message_types: account.messageTypes,
    },
    { onConflict: "business_id" },
  );
  if (error) throw new Error(error.message);
}

export async function addBuyListItem(businessId: string, recommendationId: string) {
  const db = requireSupabase();
  const { error } = await db
    .from("buy_list_items")
    .upsert(
      { business_id: businessId, recommendation_id: recommendationId },
      { onConflict: "business_id,recommendation_id" },
    );
  if (error) throw new Error(error.message);
}

export async function removeBuyListItem(businessId: string, recommendationId: string) {
  const db = requireSupabase();
  const { error } = await db
    .from("buy_list_items")
    .delete()
    .eq("business_id", businessId)
    .eq("recommendation_id", recommendationId);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------ brand logo */

/** Public URL of the uploaded logo, cache-busted so a replacement shows at once. */
export async function uploadBrandLogo(ownerUserId: string, file: File): Promise<string> {
  const db = requireSupabase();
  const extension = (file.name.split(".").pop() ?? "png")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") || "png";
  const path = `${ownerUserId}/logo.${extension}`;

  const { error } = await db.storage.from("brand-assets").upload(path, file, {
    upsert: true,
    contentType: file.type || "image/png",
  });
  if (error) throw new Error(error.message);

  const { data } = db.storage.from("brand-assets").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function updateBrandLogo(ownerUserId: string, logoUrl: string) {
  const db = requireSupabase();
  const { error } = await db
    .from("businesses")
    .update({ logo_url: logoUrl })
    .eq("owner_user_id", ownerUserId);
  if (error) throw new Error(error.message);
}

/** Clears the stored logo and deletes the uploaded files behind it. */
export async function deleteBrandLogo(ownerUserId: string) {
  const db = requireSupabase();
  const { data } = await db.storage.from("brand-assets").list(ownerUserId);
  const paths = (data ?? []).map((file) => `${ownerUserId}/${file.name}`);
  if (paths.length) await db.storage.from("brand-assets").remove(paths);
  await updateBrandLogo(ownerUserId, "");
}

/**
 * Saves the workspace's own social handles.
 *
 * The handles are a plain map on the business row (`social_handles`), keyed by
 * platform label, and this is the only writer of it after onboarding — which is
 * what lets the Social page add and remove them without re-running setup. Blank
 * entries are dropped so an emptied field removes the handle rather than storing
 * an empty string that would render as a connected-but-blank channel.
 */
export async function saveSocialHandles(
  businessId: string,
  handles: Record<string, string>,
): Promise<Record<string, string>> {
  const db = requireSupabase();
  const cleaned: Record<string, string> = {};
  for (const [platform, handle] of Object.entries(handles)) {
    const key = platform.trim();
    const value = handle.trim();
    if (!key || !value) continue;
    cleaned[key] = value;
  }

  const { error } = await db
    .from("businesses")
    .update({ social_handles: cleaned })
    .eq("id", businessId);
  if (error) throw new Error(error.message);

  return cleaned;
}

export async function markReviewScanComplete(businessId: string) {
  const db = requireSupabase();
  const now = new Date().toISOString();
  const { error } = await db.from("scan_runs").insert({
    business_id: businessId,
    source_type: "reviews",
    source_name: "Manual review scan",
    status: "succeeded",
    started_at: now,
    finished_at: now,
  });
  if (error) throw new Error(error.message);
}

/* -------------------------------------------- inventory & promotions */

type InventoryInput = Omit<InventoryItem, "id" | "createdAt">;

function inventoryPayload(input: Partial<InventoryInput>): Row {
  const payload: Row = {};
  if (input.kind !== undefined) payload.kind = input.kind;
  if (input.name !== undefined) payload.name = input.name;
  if (input.sku !== undefined) payload.sku = input.sku;
  if (input.category !== undefined) payload.category = input.category;
  if (input.description !== undefined) payload.description = input.description;
  if (input.price !== undefined) payload.price = input.price;
  if (input.compareAtPrice !== undefined) payload.compare_at_price = input.compareAtPrice;
  if (input.stock !== undefined) payload.stock = input.stock;
  if (input.status !== undefined) payload.status = input.status;
  if (input.imageUrl !== undefined) payload.image_url = input.imageUrl;
  if (input.tags !== undefined) payload.tags = input.tags;
  return payload;
}

function mapInventoryRow(row: Row): InventoryItem {
  return {
    id: row.id,
    kind: (row.kind ?? "product") as InventoryItem["kind"],
    name: str(row.name),
    sku: str(row.sku),
    category: str(row.category),
    description: str(row.description),
    price: num(row.price),
    compareAtPrice: num(row.compare_at_price),
    stock: num(row.stock),
    status: (row.status ?? "active") as InventoryItem["status"],
    imageUrl: str(row.image_url),
    tags: (row.tags ?? []) as string[],
    createdAt: str(row.created_at, new Date().toISOString()),
  };
}

export async function createInventoryItem(
  businessId: string,
  input: InventoryInput,
): Promise<InventoryItem> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("inventory_items")
    .insert({ business_id: businessId, ...inventoryPayload(input) })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not save that item.");
  return mapInventoryRow(data as Row);
}

export async function updateInventoryItem(itemId: string, patch: Partial<InventoryInput>) {
  const db = requireSupabase();
  const payload = inventoryPayload(patch);
  if (!Object.keys(payload).length) return;
  const { error } = await db.from("inventory_items").update(payload).eq("id", itemId);
  if (error) throw new Error(error.message);
}

export async function deleteInventoryItem(itemId: string) {
  const db = requireSupabase();
  const { error } = await db.from("inventory_items").delete().eq("id", itemId);
  if (error) throw new Error(error.message);
}

/** Product/service image for the ad designs — public bucket, owner-scoped folder. */
export async function uploadInventoryImage(ownerUserId: string, file: File): Promise<string> {
  const db = requireSupabase();
  const extension = (file.name.split(".").pop() ?? "png")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") || "png";
  const path = `${ownerUserId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

  const { error } = await db.storage.from("inventory-images").upload(path, file, {
    upsert: true,
    contentType: file.type || "image/png",
  });
  if (error) throw new Error(error.message);

  const { data } = db.storage.from("inventory-images").getPublicUrl(path);
  return data.publicUrl;
}

type PromotionBriefInput = Omit<PromotionBrief, "id" | "submittedAt" | "updatedAt">;

function promotionBriefPayload(input: Partial<PromotionBriefInput>): Row {
  const payload: Row = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.itemId !== undefined) payload.item_id = input.itemId;
  if (input.serviceId !== undefined) payload.service_id = input.serviceId;
  if (input.priceItemId !== undefined) payload.price_item_id = input.priceItemId;
  if (input.contactInfo !== undefined) payload.contact_info = input.contactInfo;
  if (input.template !== undefined) payload.template = input.template;
  if (input.accentColor !== undefined) payload.accent_color = input.accentColor;
  if (input.components !== undefined) payload.components = input.components;
  if (input.discountKind !== undefined) payload.discount_kind = input.discountKind;
  if (input.discountValue !== undefined) payload.discount_value = input.discountValue;
  if (input.dealText !== undefined) payload.deal_text = input.dealText;
  if (input.couponCode !== undefined) payload.coupon_code = input.couponCode;
  if (input.headline !== undefined) payload.headline = input.headline;
  if (input.notes !== undefined) payload.notes = input.notes;
  if (input.status !== undefined) payload.status = input.status;
  return payload;
}

function mapPromotionBriefRow(row: Row): PromotionBrief {
  return {
    id: row.id,
    name: str(row.name, "Untitled ad brief"),
    itemId: row.item_id ? str(row.item_id) : null,
    serviceId: row.service_id ? str(row.service_id) : null,
    priceItemId: row.price_item_id ? str(row.price_item_id) : null,
    contactInfo: str(row.contact_info),
    template: (row.template ?? "square") as PromotionBrief["template"],
    accentColor: str(row.accent_color, "#4f46e5"),
    components: (row.components ?? []) as PromotionBrief["components"],
    discountKind: (row.discount_kind ?? "percent") as PromotionBrief["discountKind"],
    discountValue: num(row.discount_value),
    dealText: str(row.deal_text),
    couponCode: str(row.coupon_code),
    headline: str(row.headline),
    notes: str(row.notes),
    status: (row.status ?? "submitted") as PromotionBrief["status"],
    submittedAt: str(row.submitted_at, new Date().toISOString()),
    updatedAt: str(row.updated_at, new Date().toISOString()),
  };
}

export async function createPromotionBrief(
  businessId: string,
  input: PromotionBriefInput,
): Promise<PromotionBrief> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("promotion_briefs")
    .insert({ business_id: businessId, ...promotionBriefPayload(input) })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not send that brief.");
  return mapPromotionBriefRow(data as Row);
}

export async function updatePromotionBrief(briefId: string, patch: Partial<PromotionBriefInput>) {
  const db = requireSupabase();
  const payload = promotionBriefPayload(patch);
  if (!Object.keys(payload).length) return;
  const { error } = await db.from("promotion_briefs").update(payload).eq("id", briefId);
  if (error) throw new Error(error.message);
}

export async function deletePromotionBrief(briefId: string) {
  const db = requireSupabase();
  const { error } = await db.from("promotion_briefs").delete().eq("id", briefId);
  if (error) throw new Error(error.message);
}

/* --------------------------------------------------------- search visibility */

function mapSerpRanking(row: Row): SerpRanking {
  return {
    keyword: str(row.keyword),
    device: (row.device ?? "desktop") as SerpRanking["device"],
    location: str(row.location),
    position: row.position === null || row.position === undefined ? null : num(row.position),
    url: str(row.url),
    title: str(row.title),
    snippetType: str(row.snippet_type),
    isRichResult: Boolean(row.is_rich_result),
    previousPosition:
      row.previous_position === null || row.previous_position === undefined
        ? null
        : num(row.previous_position),
    previousIsRichResult:
      row.previous_is_rich_result === null || row.previous_is_rich_result === undefined
        ? null
        : Boolean(row.previous_is_rich_result),
    previousSnippetType: str(row.previous_snippet_type),
    checkedAt: str(row.checked_at, new Date().toISOString()),
  };
}

function mapLocalPackRanking(row: Row): LocalPackRanking {
  return {
    keyword: str(row.keyword),
    location: str(row.location),
    inPack: Boolean(row.in_pack),
    packPosition:
      row.pack_position === null || row.pack_position === undefined
        ? null
        : num(row.pack_position),
    placeId: str(row.place_id),
    pack: Array.isArray(row.pack) ? (row.pack as LocalPackEntry[]) : [],
    previousInPack:
      row.previous_in_pack === null || row.previous_in_pack === undefined
        ? null
        : Boolean(row.previous_in_pack),
    previousPackPosition:
      row.previous_pack_position === null || row.previous_pack_position === undefined
        ? null
        : num(row.previous_pack_position),
    checkedAt: str(row.checked_at, new Date().toISOString()),
  };
}

function mapLocalProfileHealth(row: Row): LocalProfileHealth {
  return {
    placeId: str(row.place_id),
    label: str(row.label),
    score: num(row.score),
    checks: Array.isArray(row.checks) ? (row.checks as LocalProfileCheck[]) : [],
    reviewsCount: num(row.reviews_count),
    averageRating: num(row.average_rating),
    address: str(row.address),
    category: str(row.category),
    website: str(row.website),
    checkedAt: str(row.checked_at, new Date().toISOString()),
  };
}

function mapKeywordIdea(row: Row): KeywordIdea {
  return {
    id: str(row.id),
    seed: str(row.seed),
    suggestion: str(row.suggestion),
    relevance: num(row.relevance),
    source: str(row.source, "autocomplete"),
    savedAsKeyword: Boolean(row.saved_as_keyword),
    // Empty until the seed has been grouped, which is what the page groups on.
    cluster: str(row.cluster),
    createdAt: str(row.created_at, new Date().toISOString()),
  };
}

function mapShareOfVoice(row: Row): ShareOfVoice {
  return {
    competitorId: str(row.competitor_id),
    competitorName: str(row.competitor_name),
    keywordSet: str(row.keyword_set, "tracked"),
    termCount: num(row.term_count),
    ourTop10: num(row.our_top10),
    theirTop10: num(row.their_top10),
    ourShare: num(row.our_share),
    theirShare: num(row.their_share),
    previousOurShare:
      row.previous_our_share === null || row.previous_our_share === undefined
        ? null
        : num(row.previous_our_share),
    checkedAt: str(row.checked_at, new Date().toISOString()),
  };
}

function mapSocialPost(row: Row): SocialPost {
  return {
    id: str(row.id),
    competitorId: str(row.competitor_id),
    platform: str(row.platform),
    externalId: str(row.external_id),
    url: str(row.url),
    caption: str(row.caption),
    mediaUrl: str(row.media_url),
    mediaType: str(row.media_type),
    hashtags: Array.isArray(row.hashtags) ? (row.hashtags as string[]) : [],
    mentions: Array.isArray(row.mentions) ? (row.mentions as string[]) : [],
    likes: num(row.likes),
    comments: num(row.comments),
    shares: num(row.shares),
    views: num(row.views),
    engagementRate: num(row.engagement_rate),
    postedAt: row.posted_at ? str(row.posted_at) : null,
    scrapedAt: str(row.scraped_at, new Date().toISOString()),
  };
}

function mapSocialMonitorTarget(row: Row): SocialMonitorTarget {
  return {
    competitorId: str(row.competitor_id),
    platform: str(row.platform),
    handle: str(row.handle),
    actorId: str(row.actor_id),
    cadence: str(row.cadence, "weekly"),
    lastScrapedAt: row.last_scraped_at ? str(row.last_scraped_at) : null,
    lastRunStatus: str(row.last_run_status),
    lastError: str(row.last_error),
  };
}

function mapCompetitorReviewGap(row: Row): CompetitorReviewGap {
  return {
    competitorId: str(row.competitor_id),
    competitorName: str(row.competitor_name),
    placeId: str(row.place_id),
    ourReviews: num(row.our_reviews),
    theirReviews: num(row.their_reviews),
    reviewGap: num(row.review_gap),
    ourRating: num(row.our_rating),
    theirRating: num(row.their_rating),
    ratingGap: num(row.rating_gap),
    previousReviewGap:
      row.previous_review_gap === null || row.previous_review_gap === undefined
        ? null
        : num(row.previous_review_gap),
    checkedAt: str(row.checked_at, new Date().toISOString()),
  };
}

function mapSocialAccount(row: Row): SocialAccount {
  return {
    id: str(row.id),
    provider: (row.provider ?? "mallary") as SocialAccount["provider"],
    platform: str(row.platform),
    displayName: str(row.display_name, str(row.platform)),
    handle: str(row.handle),
    avatarUrl: str(row.avatar_url),
    status: (row.status ?? "active") as SocialAccount["status"],
    connectedAt: str(row.connected_at, new Date().toISOString()),
  };
}

function mapSocialPublishJob(row: Row): SocialPublishJob {
  return {
    id: str(row.id),
    briefId: row.brief_id ? str(row.brief_id) : null,
    deliveredAdId: row.delivered_ad_id ? str(row.delivered_ad_id) : null,
    accountIds: Array.isArray(row.account_ids) ? (row.account_ids as string[]) : [],
    platforms: Array.isArray(row.platforms) ? (row.platforms as string[]) : [],
    caption: str(row.caption),
    scheduledFor: row.scheduled_for ? str(row.scheduled_for) : null,
    timezone: str(row.timezone),
    status: (row.status ?? "queued") as SocialPublishJob["status"],
    providerJobId: str(row.provider_job_id),
    permalink: str(row.permalink),
    error: str(row.error),
    createdAt: str(row.created_at, new Date().toISOString()),
    updatedAt: str(row.updated_at, new Date().toISOString()),
  };
}

function mapReviewConnection(row: Row): ReviewConnection {
  return {
    id: str(row.id),
    provider: (row.provider ?? "reviews") as ReviewConnection["provider"],
    platform: str(row.platform),
    handle: str(row.handle),
    label: str(row.label),
    status: (row.status ?? "active") as ReviewConnection["status"],
    lastSyncedAt: row.last_synced_at ? str(row.last_synced_at) : null,
    lastError: str(row.last_error),
    createdAt: str(row.created_at, new Date().toISOString()),
  };
}

/** Promotes an autocomplete suggestion into the tenant's tracked SEO keywords. */
export async function saveKeywordIdea(
  businessId: string,
  idea: { id: string; suggestion: string },
): Promise<void> {
  const db = requireSupabase();
  const { error: ideaError } = await db
    .from("keyword_ideas")
    .update({ saved_as_keyword: true })
    .eq("id", idea.id);
  if (ideaError) throw new Error(ideaError.message);

  const { error } = await db.from("my_keywords").insert({
    business_id: businessId,
    keyword: idea.suggestion,
    kind: "seo",
    volume: 0,
    position: 0,
    change: 0,
  });
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------ integrations */

function mapApiUsageRow(row: Row): ApiUsage {
  return {
    provider: (row.provider ?? "serpapi") as IntegrationProvider,
    // One log row is one provider request; totals are summed downstream.
    requests: 1,
    units: num(row.units, 1),
    costUsd: num(row.cost_usd),
    errors: row.status === "error" ? 1 : 0,
  };
}

function mapIntegrationConnection(row: Row): IntegrationConnection {
  return {
    id: str(row.id),
    provider: (row.provider ?? "serpapi") as IntegrationProvider,
    kind: (row.kind ?? "actor") as IntegrationConnection["kind"],
    externalId: str(row.external_id),
    label: str(row.label),
    handle: str(row.handle),
    status: (row.status ?? "active") as IntegrationConnection["status"],
    meta: (row.meta ?? {}) as Record<string, unknown>,
    createdAt: str(row.created_at, new Date().toISOString()),
    updatedAt: str(row.updated_at, new Date().toISOString()),
  };
}

/** Saved external connections for a tenant, newest first. */
export async function listConnections(businessId: string): Promise<IntegrationConnection[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("integration_connections")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapIntegrationConnection(row as Row));
}

/** Provider availability, connection counts and spend, without a full reload. */
export async function integrationUsage(businessId: string): Promise<ProviderStatus[]> {
  const db = requireSupabase();
  const [connectionsRes, usageRes] = await Promise.all([
    db.from("integration_connections").select("*").eq("business_id", businessId),
    db
      .from("api_usage_log")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);
  return buildProviderStatus({
    connections: rows<Row>(connectionsRes).map(mapIntegrationConnection),
    usage: rows<Row>(usageRes).map(mapApiUsageRow),
    config: await fetchProviderConfig(),
  });
}

/* --------------------------------------------------------- review profiles */

/**
 * Connects a review profile. Profiles are addressed by their public handle or
 * URL, so the reviewed platform never has to authorise anything.
 *
 * The row is also mirrored into `integration_connections` (kind `review_profile`)
 * so the Integrations panel counts it alongside the other providers, while
 * `review_connections` stays the table the sync function reads.
 */
export async function saveReviewConnection(
  businessId: string,
  input: { platform: string; handle: string; label?: string },
): Promise<ReviewConnection> {
  const db = requireSupabase();
  const platform = input.platform.trim().toLowerCase();
  const handle = input.handle.trim();
  if (!platform) throw new Error("Pick a review platform.");
  if (!handle) throw new Error("Add the profile's public URL or handle.");
  const label = (input.label ?? "").trim() || `${platform} profile`;

  const { data, error } = await db
    .from("review_connections")
    .upsert(
      { business_id: businessId, provider: "reviews", platform, handle, label },
      { onConflict: "business_id,provider,platform,handle" },
    )
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not connect that review profile.");

  await db.from("integration_connections").upsert(
    {
      business_id: businessId,
      provider: "reviews",
      kind: "review_profile",
      external_id: `${platform}:${handle}`,
      label,
      handle,
      status: "active",
    },
    { onConflict: "business_id,provider,kind,external_id" },
  );

  return mapReviewConnection(data as Row);
}

/** Disconnects a review profile and its mirror in the Integrations panel. */
export async function deleteReviewConnection(connectionId: string) {
  const db = requireSupabase();
  const { data } = await db
    .from("review_connections")
    .select("business_id, platform, handle")
    .eq("id", connectionId)
    .maybeSingle();

  const { error } = await db.from("review_connections").delete().eq("id", connectionId);
  if (error) throw new Error(error.message);

  if (data) {
    await db
      .from("integration_connections")
      .delete()
      .eq("business_id", data.business_id)
      .eq("provider", "reviews")
      .eq("kind", "review_profile")
      .eq("external_id", `${String(data.platform)}:${String(data.handle)}`);
  }
}

/**
 * Records a reply the user posted by hand.
 *
 * Posting a reply needs a platform business API — Google's is not connected on
 * this deployment — so the reply composer is still useful for drafting and
 * copying, and this is what takes the review out of "needs a reply" once the
 * user has pasted it on the platform. The text is kept on the review and in the
 * reply history, so the audit trail is the same shape as a posted reply.
 */
export async function saveManualReviewReply(
  businessId: string,
  reviewId: string,
  reply: string,
): Promise<{ repliedAt: string }> {
  const db = requireSupabase();
  const repliedAt = new Date().toISOString();

  const { error } = await db
    .from("my_reviews")
    .update({ replied: true, reply_text: reply, replied_at: repliedAt })
    .eq("id", reviewId)
    .eq("business_id", businessId);
  if (error) throw new Error(error.message);

  await db.from("review_replies").insert({
    business_id: businessId,
    review_id: reviewId,
    body: reply,
    status: "manual",
  });

  return { repliedAt };
}

/* ------------------------------------------------- competitor social handles */

/**
 * Declares one competitor handle to monitor. `social-scan` scrapes exactly the
 * rows in this table, so saving one is what turns a competitor's Instagram,
 * TikTok, Facebook or X profile into a scrape target — without a row here the
 * scan reports nothing to do.
 *
 * One row per competitor per platform (the unique index added in
 * `0016_competitor_social_handles.sql`): saving a platform that is already
 * tracked replaces its handle rather than stacking a second target.
 *
 * The handle is normalised to the bare username first. The gateway strips a
 * leading `@` and builds the profile URL around what is left, so a pasted URL
 * would be embedded in that URL and the scrape would quietly find nothing.
 */
export async function saveCompetitorSocialHandle(
  businessId: string,
  input: { competitorId: string; platform: string; handle: string; followers?: number },
): Promise<SocialChannel> {
  const db = requireSupabase();
  const platform = socialPlatformOf(input.platform) ?? input.platform.trim().toLowerCase();
  const handle = normaliseSocialHandle(input.handle);
  if (!platform) throw new Error("Pick a platform.");
  if (!handle) {
    throw new Error(
      "Add the profile's handle or its full profile URL (for example https://www.instagram.com/yourbrand).",
    );
  }

  const payload: Record<string, unknown> = {
    business_id: businessId,
    competitor_id: input.competitorId,
    platform,
    handle,
    // A handle a person typed or corrected is manual, whichever way it was
    // first found: provenance follows what is stored now, not its history.
    source: "manual",
  };
  // `followers` is sent only when the caller really supplied a count. A blank
  // field means "unknown", and an upsert that sends 0 there would wipe the
  // figure the last scan measured — turning every engagement rate back to 0%.
  // Omitting the column leaves the stored value (or the column default) alone.
  if (Number.isFinite(input.followers)) {
    payload.followers = Math.max(0, Math.round(Number(input.followers)));
  }

  const { data, error } = await db
    .from("competitor_social")
    .upsert(payload, { onConflict: "business_id,competitor_id,platform" })
    .select()
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Could not save that handle.");
  }

  return mapSocialChannel(data as Row);
}

/** Stops monitoring one competitor handle. */
export async function deleteCompetitorSocialHandle(
  businessId: string,
  input: { competitorId: string; platform: string },
) {
  const db = requireSupabase();
  const platform = socialPlatformOf(input.platform) ?? input.platform.trim().toLowerCase();

  const { error } = await db
    .from("competitor_social")
    .delete()
    .eq("business_id", businessId)
    .eq("competitor_id", input.competitorId)
    .eq("platform", platform);
  if (error) throw new Error(error.message);

  // Drop the scrape state alongside it, so a handle that is added again later
  // starts fresh instead of inheriting the removed one's "not due yet" cadence
  // and the run id of a scrape of a different profile.
  await db
    .from("social_monitor_targets")
    .delete()
    .eq("business_id", businessId)
    .eq("competitor_id", input.competitorId)
    .eq("platform", platform);
}

/* ---------------------------------------------------------------- mapping */

/**
 * One competitor row's own columns.
 *
 * The related collections (traffic, keywords, ads, reviews …) are **not**
 * included: `loadWorkspace` spreads them on top, and a competitor that was just
 * created has none of them. Keeping the scalars here means the create and update
 * paths map through the same function as the loader instead of a second copy of
 * these fields that would quietly drift out of step.
 */
function mapCompetitorBase(row: Row): Competitor {
  return {
    id: row.id,
    name: str(row.name),
    website: str(row.website),
    cadence: (row.cadence ?? "daily") as Cadence,
    // Carried so the edit form can prefill it. Without it, re-saving a competitor
    // would blank notes the user had written.
    notes: str(row.notes) || undefined,
    lastScan: str(row.last_scan_at, new Date().toISOString()),
    monthlyVisits: num(row.monthly_visits),
    visitsChange: num(row.visits_change),
    seoScore: num(row.seo_score),
    geoScore: num(row.geo_score),
    rating: num(row.rating),
    previousRating: num(row.previous_rating, num(row.rating)),
    reviewCount: num(row.review_count),
    reviewsThisMonth: num(row.reviews_this_month),
    adPlatforms: (row.ad_platforms ?? []) as string[],
    // Written only by the contacts gateway; shown so the button can report a run
    // that is still going rather than starting a second one.
    contactsStatus: str(row.contacts_status) || undefined,
    contactsScannedAt: str(row.contacts_scanned_at) || undefined,
    // A run id still on the row is a catalogue crawl that has been billed and not
    // read back yet. The pull needs to see it to collect it inside the pull cap,
    // so it is mapped here rather than left to `select("*")`.
    siteScanPending: Boolean(row.site_run_id),
    traffic: [],
    reviewTrend: [],
    trafficSources: [],
    social: [],
    keywordGap: [],
    ads: [],
    reviews: [],
    audience: [],
    newItems: [],
  };
}

function mapSocialChannel(row: Row): SocialChannel {
  return {
    platform: str(row.platform),
    handle: str(row.handle),
    followers: num(row.followers),
    engagementRate: num(row.engagement_rate),
    postsPerWeek: num(row.posts_per_week),
    adsRunning: num(row.ads_running),
    source: (row.source ?? "manual") as SocialChannel["source"],
  };
}

function mapProfile(row: Row): BusinessProfile {
  return {
    seoScore: num(row.seo_score),
    previousSeoScore: num(row.previous_seo_score, num(row.seo_score)),
    top10Count: num(row.top10_count),
    previousTop10Count: num(row.previous_top10_count, num(row.top10_count)),
    rankedCount: num(row.ranked_count),
    avgPosition: num(row.avg_position),
    previousAvgPosition: num(row.previous_avg_position, num(row.avg_position)),
    rankingsCheckedAt: str(row.rankings_checked_at),
    geoScore: num(row.geo_score),
    previousGeoScore: num(row.previous_geo_score, num(row.geo_score)),
    monthlyVisits: num(row.monthly_visits),
    visitsChange: num(row.visits_change),
    conversionRate: num(row.conversion_rate),
    industryRank: num(row.industry_rank),
    industryRankPrevious: num(row.industry_rank_previous, num(row.industry_rank)),
    domainAuthority: num(row.domain_authority),
    indexedPages: num(row.indexed_pages),
    backlinks: num(row.backlinks),
    id: str(row.id),
    ownerUserId: str(row.owner_user_id),
    ownerEmail: str(row.owner_email),
    brandName: str(row.brand_name),
    logoUrl: str(row.logo_url),
    legalName: str(row.legal_name),
    industry: str(row.industry),
    niche: str(row.niche),
    primaryDomain: str(row.primary_domain),
    secondaryDomains: (row.secondary_domains ?? []) as string[],
    platformType: str(row.platform_type),
    country: str(row.country),
    currency: str(row.currency, "USD"),
    timezone: str(row.timezone),
    teamSize: str(row.team_size),
    primaryGoal: str(row.primary_goal),
    goals: (row.goals ?? []) as string[],
    adPlatforms: (row.ad_platforms ?? []) as string[],
    socialHandles: (row.social_handles ?? {}) as Record<string, string>,
    notificationEmail: str(row.notification_email),
    reportDay: str(row.report_day),
    onboardingComplete: row.onboarding_complete === true,
  };
}
