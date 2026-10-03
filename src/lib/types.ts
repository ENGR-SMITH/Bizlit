export type Cadence = "daily" | "weekly" | "monthly";

export type ChangeType =
  | "new_product"
  | "price_change"
  | "stock_change"
  | "promotion"
  | "removed";

export type StockState = "in_stock" | "low_stock" | "out_of_stock" | "preorder";

/**
 * What a watched site published one catalogue row as.
 *
 * The site scraper reads all three from a competitor's own pages: a shopfront
 * publishes products, a service business publishes services, and a business whose
 * site is its pricing page publishes plans.
 */
export type ItemKind = "product" | "service" | "price_plan";

/* ---------------- Competitors ---------------- */

export interface TrafficPoint {
  label: string;
  visits: number;
}

export interface SocialChannel {
  platform: string;
  handle: string;
  followers: number;
  engagementRate: number;
  postsPerWeek: number;
  adsRunning: number;
  /**
   * Where this handle came from. `discovered` means the contacts actor proposed
   * it from the competitor's own website and the user accepted it; `manual` means
   * a person typed or corrected it. Shown as a badge so a proposal never looks
   * like something the user chose.
   */
  source?: "manual" | "discovered" | "imported";
}

/**
 * A competitor's recent public post, pulled by the Apify gateway.
 *
 * This is evidence and inspiration — the caption, the numbers it earned and
 * where it lives. It is never republished as our own creative: every "build our
 * own" action starts a fresh brief for the user's brand.
 */
export interface SocialPost {
  id: string;
  competitorId: string;
  /** Platform key: instagram | tiktok | facebook | x. */
  platform: string;
  externalId: string;
  url: string;
  caption: string;
  mediaUrl: string;
  mediaType: string;
  hashtags: string[];
  mentions: string[];
  likes: number;
  comments: number;
  shares: number;
  views: number;
  /** (likes + comments) ÷ followers, as a percentage. */
  engagementRate: number;
  postedAt: string | null;
  scrapedAt: string;
}

/** How the last scrape of one competitor handle went. */
export interface SocialMonitorTarget {
  competitorId: string;
  platform: string;
  handle: string;
  actorId: string;
  cadence: string;
  lastScrapedAt: string | null;
  lastRunStatus: string;
  lastError: string;
}

export interface KeywordGap {
  keyword: string;
  volume: number;
  ourRank: number | null;
  theirRank: number;
  difficulty: number;
  intent: "informational" | "commercial" | "transactional";
}

export interface AdCreative {
  id: string;
  platform: string;
  headline: string;
  audience: string;
  firstSeen: string;
  status: "active" | "paused";
  focus: string;
  bannerUrl: string;
  landingUrl: string;
}

export interface CompetitorReview {
  id: string;
  author: string;
  rating: number;
  postedAt: string;
  source: string;
  text: string;
  sentiment: "positive" | "neutral" | "negative";
}

export interface AudienceSlice {
  segment: string;
  ageRange: string;
  share: number;
}

/**
 * One product change on a competitor's own site.
 *
 * Written by `site-scan`, and always a *change* — a product read again unchanged is
 * not a row, which is why `change` is never empty here.
 */
export interface CompetitorItem {
  id: string;
  product: string;
  sku: string;
  category: string;
  /** What their site published this as; absent on rows read before migration 0025. */
  kind?: ItemKind;
  price: number;
  previousPrice: number;
  stock: StockState;
  previousStock: StockState;
  change: ChangeType;
  detectedAt: string;
  url: string;
}

export interface Competitor {
  id: string;
  name: string;
  website: string;
  cadence: Cadence;
  lastScan: string;
  monthlyVisits: number;
  visitsChange: number;
  traffic: TrafficPoint[];
  trafficSources: { label: string; share: number }[];
  seoScore: number;
  geoScore: number;
  social: SocialChannel[];
  adPlatforms: string[];
  rating: number;
  previousRating: number;
  reviewCount: number;
  reviewsThisMonth: number;
  reviewTrend: TrafficPoint[];
  reviews: CompetitorReview[];
  audience: AudienceSlice[];
  ads: AdCreative[];
  newItems: CompetitorItem[];
  keywordGap: KeywordGap[];
  /** Free text the user keeps about the competitor. Optional: most have none. */
  notes?: string;
  /**
   * Website contact discovery state, written only by `web-contacts-scan`:
   * idle | running | done | failed | skipped. Read by the Social presence card so
   * the button can say "checking…" instead of lying about having finished.
   */
  contactsStatus?: string;
  /** When discovery last completed for this competitor. */
  contactsScannedAt?: string;
  /**
   * True while `competitors.site_run_id` (migration `0021`) holds a crawl this
   * workspace has already paid for and not yet collected.
   */
  siteScanPending?: boolean;
}

/* ---------------- Clients ---------------- */

export type MessageType =
  | "new_stock"
  | "two_day_checkin"
  | "platform_info"
  | "deals"
  | "competitor_alert"
  | "review_update"
  | "weekly_report";

export type SendFrequency = "every_2_days" | "daily" | "weekly" | "monthly";

export interface Client {
  id: string;
  name: string;
  email: string;
  company: string;
  industry: string;
  status: "active" | "paused" | "prospect";
  tier: "starter" | "growth" | "premium";
  joinedAt: string;
  lastContacted: string;
  nextSendAt: string;
  frequency: SendFrequency;
  messageTypes: MessageType[];
  openRate: number;
  monthlyFee: number;
  notes?: string;
}

export interface SentMessage {
  id: string;
  clientId: string;
  clientName: string;
  subject: string;
  types: MessageType[];
  sentAt: string;
  /** `failed` is a send the mail server refused — it is kept so the activity log is honest. */
  status: "delivered" | "opened" | "clicked" | "bounced" | "failed";
}

export interface MailAccount {
  senderName: string;
  loginEmail: string;
  replyTo: string;
  signature: string;
  timezone: string;
  dailyDigest: boolean;
  secondaryEmail: string;
  /**
   * One cadence for the whole list — every customer is mailed on the same
   * schedule, so this lives in the workspace configuration, not per client.
   */
  sendFrequency: SendFrequency;
  /** One list of message types for the whole customer base, set in Configuration. */
  messageTypes: MessageType[];
}

/* ---------------- Search visibility (SerpApi) ---------------- */

export type SearchDevice = "desktop" | "mobile";

/** Our Google organic position for a tracked keyword on one device. */
export interface SerpRanking {
  keyword: string;
  device: SearchDevice;
  location: string;
  /** null when we are not present in the results we fetched. */
  position: number | null;
  url: string;
  title: string;
  /** Rich-snippet kind found on our result, empty when none. */
  snippetType: string;
  isRichResult: boolean;
  /** State from the previous scan, for "lost a rich snippet" alerts. */
  previousPosition: number | null;
  previousIsRichResult: boolean | null;
  previousSnippetType: string;
  checkedAt: string;
}

/** One entry of the local map 3-pack. */
export interface LocalPackEntry {
  position: number;
  name: string;
  placeId: string;
  rating: number;
  reviews: number;
}

/** Where we sit in the local map 3-pack for a keyword. */
export interface LocalPackRanking {
  keyword: string;
  location: string;
  inPack: boolean;
  /** 1–3 when in the pack, null when we are not. */
  packPosition: number | null;
  placeId: string;
  /** Everyone in the pack, so competitors can be compared later. */
  pack: LocalPackEntry[];
  /** State from the previous scan, for "dropped out of the pack" alerts. */
  previousInPack: boolean | null;
  previousPackPosition: number | null;
  checkedAt: string;
}

/** One Google Business Profile completeness check. */
export interface LocalProfileCheck {
  label: string;
  ok: boolean;
  detail: string;
}

/** Google Business Profile health for our own Maps listing. */
export interface LocalProfileHealth {
  placeId: string;
  label: string;
  score: number;
  checks: LocalProfileCheck[];
  reviewsCount: number;
  averageRating: number;
  address: string;
  category: string;
  website: string;
  checkedAt: string;
}

/** A Google Autocomplete suggestion the user can promote to a tracked keyword. */
export interface KeywordIdea {
  id: string;
  seed: string;
  suggestion: string;
  relevance: number;
  source: string;
  savedAsKeyword: boolean;
  /**
   * AI-assigned intent theme, empty until the workspace groups the seed. The
   * page shows the plain list while this is empty.
   */
  cluster: string;
  createdAt: string;
}

/**
 * One original ad angle, drawn from a competitor's best-performing post. A draft
 * the user picks from — an angle creates nothing on its own.
 */
export interface AdAngle {
  /** Our own line, never a rewording of theirs. */
  headline: string;
  /** Why it should work, in a sentence. */
  rationale: string;
  /** Catalogue item to build it around, or "" when none fits. */
  itemHint: string;
}

/** A theme a seed's keyword suggestions were grouped under. */
export interface KeywordCluster {
  name: string;
  /** informational | commercial | transactional | navigational | mixed */
  intent: string;
  /** Always a subset of the suggestions we already hold. */
  keywords: string[];
}

/** Share of Voice: how often we and a competitor appear in the Google top 10. */
export interface ShareOfVoice {
  competitorId: string;
  competitorName: string;
  keywordSet: string;
  termCount: number;
  ourTop10: number;
  theirTop10: number;
  /** Percent of tracked terms (0–100). */
  ourShare: number;
  theirShare: number;
  /** Our share last scan, for "share of voice crossed a threshold" alerts. */
  previousOurShare: number | null;
  checkedAt: string;
}

/** Competitor Review Gap: the local rating / review-count difference. */
export interface CompetitorReviewGap {
  competitorId: string;
  competitorName: string;
  placeId: string;
  ourReviews: number;
  theirReviews: number;
  /** Their reviews minus ours — negative means we lead. */
  reviewGap: number;
  ourRating: number;
  theirRating: number;
  /** Our rating minus theirs — positive means we lead. */
  ratingGap: number;
  /** The gap last benchmark, for the "gap widened" alert. */
  previousReviewGap: number | null;
  checkedAt: string;
}

/* ---------------- My business ---------------- */

export interface RankRow {
  keyword: string;
  volume: number;
  /** null when we are not in the results we fetched (or have not scanned it yet). */
  position: number | null;
  /** Positions gained since the previous scan — negative means we slipped. */
  change: number;
}

export interface GeoRankRow {
  prompt: string;
  engine: string;
  /**
   * 0 when the AI answer did not mention us, otherwise our place among the sources
   * it listed (or 1 when it named us only in the prose).
   *
   * Deliberately not a rank: an AI answer has no "position 7". Rendering one would
   * invent a number the answer does not contain, which is why the table shows
   * cited / not cited and keeps the index here for the detail it does carry.
   */
  position: number;
  /** How many sources the answer drew on — the size of the field we were cited in. */
  sources: number;
}

export interface ReviewSource {
  source: string;
  score: number;
  previousScore: number;
  reviews: number;
  newThisMonth: number;
  series: TrafficPoint[];
}

export interface AdAsset {
  id: string;
  product: string;
  sku: string;
  formats: string[];
  shootStatus: "ready" | "editing" | "scheduled";
  shootDate: string;
  figmaUrl: string;
  /** Public or signed URL of the exported creative bundle. */
  downloadUrl?: string | null;
  /** Path inside the `ad-assets` Supabase Storage bucket. */
  storagePath?: string | null;
  sizeMb: number;
  downloads: number;
}

export interface SocialScore {
  platform: string;
  handle: string;
  score: number;
  followers: number;
  growth: number;
  benchmarkGap: number;
  focus: "high" | "medium" | "low";
  reason: string;
}

export interface InventoryRecommendation {
  id: string;
  product: string;
  category: string;
  suggestedQty: number;
  estimatedPrice: number;
  marginPct: number;
  trafficPotential: number;
  reason: string;
  priority: "high" | "medium" | "low";
  competitorRef: string;
}

/* ---------------- Inventory & services ---------------- */

export type InventoryKind = "product" | "service";
export type InventoryStatus = "active" | "draft" | "archived";

/**
 * Something the business sells. Products carry stock; services do not. Both
 * feed the ad designs built on the Promotions page, so each row can hold its
 * own image.
 */
export interface InventoryItem {
  id: string;
  kind: InventoryKind;
  name: string;
  sku: string;
  category: string;
  description: string;
  price: number;
  /** Original price when the item is discounted, 0 when there is no discount. */
  compareAtPrice: number;
  /** Units on hand — products only, ignored for services. */
  stock: number;
  status: InventoryStatus;
  /** Public URL (live) or data URL (demo) of the product/service image. */
  imageUrl: string;
  tags: string[];
  createdAt: string;
}

/* ---------------- Promotions (ad briefs & delivered designs) ---------------- */

export type PromotionTemplate = "square" | "story" | "landscape";

/** The pieces a user can ask to be included in an ad design. */
export type PromotionComponent =
  | "product"
  | "service"
  | "price"
  | "discount"
  | "deal"
  | "coupon"
  | "logo"
  | "contact"
  | "rating";

/** How the discount component is expressed — a percentage or a money amount. */
export type DiscountKind = "percent" | "amount";

/** Where a brief sits between being sent to us and the finished ad arriving. */
export type PromotionBriefStatus = "submitted" | "in_design" | "delivered";

/**
 * What the business asks us to build. This is the brief a designer works from
 * — it records the pieces to include and the values to use, not a rendered ad.
 */
export interface PromotionBrief {
  id: string;
  name: string;
  /** The inventory product the design is built around. */
  itemId: string | null;
  /** The service the design is built around, when "service" is selected. */
  serviceId: string | null;
  /** The product or service the price refers to, when "price" is selected. */
  priceItemId: string | null;
  /** The contact details to show when "contact" is selected. */
  contactInfo: string;
  template: PromotionTemplate;
  accentColor: string;
  components: PromotionComponent[];
  /** Only meaningful when `discount` is in `components`. */
  discountKind: DiscountKind;
  discountValue: number;
  /** Free-text deal shown when the `deal` component is on, e.g. "Buy 2 get 1 free". */
  dealText: string;
  couponCode: string;
  /** The message the user would like the ad to lead with. */
  headline: string;
  /** Anything else the design team should know about the look. */
  notes: string;
  status: PromotionBriefStatus;
  submittedAt: string;
  updatedAt: string;
}

/**
 * A finished ad we produced from a brief and pushed to Supabase. The user can
 * open these from the Promotions page and export them.
 */
export interface DeliveredAd {
  id: string;
  /** The brief this design answers, when it came from one. */
  briefId: string | null;
  name: string;
  template: PromotionTemplate;
  /** Public URL of the creative in the `delivered-ads` bucket, empty until pushed. */
  fileUrl: string;
  /** Path inside the `delivered-ads` bucket, for reference. */
  storagePath: string;
  sizeMb: number;
  downloads: number;
  note: string;
  deliveredAt: string;
}

/* ---------------- Social publishing (Mallary) ---------------- */

/**
 * One social account the user has connected through Mallary. Accounts are
 * connected inside Mallary's own flow; this mirrors what the provider reports.
 */
export interface SocialAccount {
  id: string;
  provider: IntegrationProvider;
  /** facebook | instagram | x | tiktok | linkedin | youtube | pinterest… */
  platform: string;
  displayName: string;
  handle: string;
  avatarUrl: string;
  status: IntegrationConnectionState;
  connectedAt: string;
}

/** Where a published ad sits in the provider's lifecycle. */
export type PublishJobStatus = "queued" | "publishing" | "published" | "partial" | "failed";

/** One push of a finished design to the user's social accounts. */
export interface SocialPublishJob {
  id: string;
  briefId: string | null;
  deliveredAdId: string | null;
  accountIds: string[];
  platforms: string[];
  caption: string;
  scheduledFor: string | null;
  timezone: string;
  status: PublishJobStatus;
  providerJobId: string;
  permalink: string;
  error: string;
  createdAt: string;
  updatedAt: string;
}

export interface WeeklyReport {
  week: string;
  seoScore: number;
  geoScore: number;
  visits: number;
  conversions: number;
  highlight: string;
  actions: string[];
}

/* ---------------- Account, onboarding and workspace ---------------- */

export interface BusinessProfile {
  id: string;
  ownerUserId: string;
  ownerEmail: string;
  brandName: string;
  /** Public URL of the uploaded brand logo, empty when none was uploaded. */
  logoUrl: string;
  legalName: string;
  industry: string;
  niche: string;
  primaryDomain: string;
  secondaryDomains: string[];
  platformType: string;
  country: string;
  currency: string;
  timezone: string;
  teamSize: string;
  primaryGoal: string;
  goals: string[];
  adPlatforms: string[];
  socialHandles: Record<string, string>;
  notificationEmail: string;
  reportDay: string;
  onboardingComplete: boolean;
  /* Latest business-level scores, refreshed by each scan. */
  seoScore: number;
  previousSeoScore: number;
  /**
   * Search visibility, derived by `serp-scan` from the rankings it stores rather
   * than from anything a person typed at onboarding. Each figure carries the
   * previous scan's value alongside it, so the health card shows movement instead
   * of a lone number. `avgPosition` is 0 when we appear for none of the tracked
   * terms, and `rankingsCheckedAt` is empty until the first scan.
   */
  top10Count: number;
  previousTop10Count: number;
  rankedCount: number;
  avgPosition: number;
  previousAvgPosition: number;
  rankingsCheckedAt: string;
  geoScore: number;
  previousGeoScore: number;
  monthlyVisits: number;
  visitsChange: number;
  conversionRate: number;
  industryRank: number;
  industryRankPrevious: number;
  domainAuthority: number;
  indexedPages: number;
  backlinks: number;
}

export interface BusinessMetrics {
  seoScore: number;
  previousSeoScore: number;
  geoScore: number;
  previousGeoScore: number;
  domainAuthority: number;
  indexedPages: number;
  backlinks: number;
  industryRank: number;
  industryRankPrevious: number;
  monthlyVisits: number;
  visitsChange: number;
  conversionRate: number;
  traffic: TrafficPoint[];
  trafficSources: { label: string; share: number }[];
  topServers: { name: string; share: number }[];
}

export interface MyReview {
  id: string;
  author: string;
  rating: number;
  source: string;
  postedAt: string;
  text: string;
  sentiment: "positive" | "neutral" | "negative";
  action: string;
  isFlagged?: boolean;
  /** The reader's own review id, empty for reviews captured before Phase 3. */
  externalId: string;
  /** Platform key: google | yelp | g2 | trustpilot | capterra | tripadvisor. */
  platform: string;
  /** ISO 639-1 language the review was written in. */
  language: string;
  /** True once a reply has been sent (or the provider reported one). */
  replied: boolean;
  /** The reply we sent, when there is one. */
  replyText: string;
  repliedAt: string | null;
}

/**
 * A review profile we monitor, tracked by its public handle or URL — no login on
 * the reviewed platform is required.
 */
export interface ReviewConnection {
  id: string;
  provider: IntegrationProvider;
  /** Platform key: google | yelp | g2 | trustpilot | capterra | tripadvisor. */
  platform: string;
  /** Public URL or company slug the provider tracks. */
  handle: string;
  label: string;
  status: IntegrationConnectionState;
  lastSyncedAt: string | null;
  lastError: string;
  createdAt: string;
}

export interface ReviewScan {
  scannedAt: string;
  nextScanAt: string;
  newReviews: number;
  flagged: number;
  averageRating: number;
  items: MyReview[];
}

/**
 * The workspace's own Google Business Profile, connected through OAuth so a
 * reply can be posted against a review Google issued itself — reading a review
 * and answering it are separate permissions, and a scraped id cannot be
 * replied to.
 *
 * Holds no secret: the refresh token stays on the server, and this is only what
 * the button on Social & reviews shows.
 */
export interface GoogleProfile {
  status: "connected" | "needs_reauth";
  displayName: string;
  accountName: string;
  /** Every location the grant can see — a reply walks them in order. */
  locations: string[];
  connectedAt: string;
  /** Why the grant needs renewing, empty while it is healthy. */
  lastError: string;
}

export interface ScanRun {
  id: string;
  sourceType: "competitor" | "reviews" | "seo" | "geo" | "social";
  sourceId: string | null;
  sourceName: string;
  status: "queued" | "running" | "succeeded" | "failed";
  changesFound: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/**
 * One competitor social profile, as entered by hand at onboarding or on the
 * Competition page. `platform` is the key the gateway scrapes against
 * (instagram | tiktok | facebook | x) and `handle` is the bare username.
 */
export interface CompetitorSocialInput {
  platform: string;
  handle: string;
  /**
   * Where this handle came from. Set per row so one save can carry both: an
   * accepted proposal that was left alone is `discovered`, and one the user typed
   * or corrected is `manual` — provenance follows what is stored, not who ran the
   * scan. Absent means the caller's default applies.
   */
  source?: SocialChannel["source"];
}

/**
 * One profile the contacts actor found on a competitor's own website.
 *
 * These are *suggestions*: every accepted handle becomes a billed scrape target,
 * and a footer link can easily belong to the site's web agency rather than the
 * competitor — so nothing here is written until a person accepts it.
 */
export interface SocialSuggestion {
  /** instagram | tiktok | facebook | x — the keys the gateway scrapes against. */
  platform: string;
  /** The bare handle, reduced from whatever URL the actor returned. */
  handle: string;
  /** The exact URL the actor returned, for a "check it" link. */
  url: string;
  /** False for YouTube, LinkedIn, Threads… — shown, never written. */
  monitorable: boolean;
}

/** The result of one website contacts read, in every state it can be in. */
export interface ContactDiscoveryResult {
  /**
   * `unavailable` is a configuration state, not a failure: with no actor id on
   * the deployment the surface explains itself instead of erroring.
   */
  status: "done" | "running" | "failed" | "unavailable";
  /** Present when a run is still working, so the next call can collect it. */
  runId?: string;
  competitorId?: string;
  /** The website that was read. */
  scannedUrl: string;
  suggestions: SocialSuggestion[];
  /** Labels for what the actor found that we have no actor to scrape. */
  unmonitored: string[];
  costUsd?: number;
  /**
   * True when these proposals come from a read taken moments ago rather than a
   * new one — the reuse window doing its job, so nothing was re-charged.
   */
  cached?: boolean;
  /** Why the feature is unavailable, when that is the status. */
  reason?: string;
}

/** A source the user is watching, collected during onboarding. */
export interface MonitoringSourceInput {
  name: string;
  website: string;
  category: string;
  cadence: Cadence;
  /**
   * The competitor's social profiles, if the user recorded any. Optional so an
   * existing saved form stays valid without it.
   */
  socials?: CompetitorSocialInput[];
}

/**
 * What the competitor add/edit form collects. Deliberately not `Competitor`:
 * the server owns everything else (metrics, ratings, last scan), and a form that
 * could PATCH a metric would be a bug waiting to happen.
 */
export interface CompetitorInput {
  name: string;
  website: string;
  cadence: Cadence;
  notes?: string;
}

export interface ClientSeedInput {
  name: string;
  email: string;
  company: string;
  frequency: SendFrequency;
  messageTypes: MessageType[];
}

/* ---------------- Integrations ---------------- */

/**
 * External providers wired into the workspace via the Edge Function gateway.
 *
 * `reviews` is not a vendor: it is review monitoring assembled from the serpapi
 * and apify readers, so it is configured by either of those keys rather than one
 * of its own.
 *
 * `llm` is the drafting model behind the AI enrichment (reply drafts, ad angles,
 * keyword clusters). It is configured by GROQ_API_KEY, but the endpoint and model
 * are settings (LLM_BASE_URL, LLM_MODEL), so any OpenAI-compatible provider can
 * replace it without the app changing.
 */
export type IntegrationProvider = "serpapi" | "apify" | "reviews" | "mallary" | "llm";

/** What a saved connection represents for its provider. */
export type IntegrationKind = "social_account" | "review_profile" | "maps_place" | "actor";

/** A saved connection's health. `needs_reauth` means the user must reconnect. */
export type IntegrationConnectionState = "active" | "needs_reauth" | "disabled";

/**
 * One external connection a tenant has set up — a Mallary social account, a
 * monitored review profile, a SerpApi Maps place or an Apify actor target.
 * Never holds secrets; those stay in the Edge Function environment.
 */
export interface IntegrationConnection {
  id: string;
  provider: IntegrationProvider;
  kind: IntegrationKind;
  externalId: string;
  label: string;
  handle: string;
  status: IntegrationConnectionState;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Provider calls aggregated for a tenant, for the usage/cost readout. */
export interface ApiUsage {
  provider: IntegrationProvider;
  requests: number;
  units: number;
  costUsd: number;
  /** Calls that ended in an error, so the rate can be surfaced. */
  errors: number;
}

/**
 * What the Integrations panel renders: the provider catalogue plus this
 * tenant's connection count and recorded usage. `configured` comes from the
 * server (whether the Edge Functions hold a key) and is always false in demo.
 */
export interface ProviderStatus {
  provider: IntegrationProvider;
  label: string;
  description: string;
  /** Environment variables the server needs before this provider can run. */
  envKeys: string[];
  configured: boolean;
  connections: number;
  requests: number;
  costUsd: number;
  /** Billable units recorded this month (searches / profile syncs / posts). */
  units: number;
  /** Calls that ended in an error this month, so a provider's failure rate is visible. */
  errors: number;
  /** Monthly unit allowance, 0 when uncapped. */
  cap: number;
  /**
   * Features this provider could serve that are switched off on this deployment
   * (e.g. website discovery without `APIFY_CONTACTS_ACTOR_ID`), as ready copy.
   */
  inactiveFeatures: string[];
  /** Monthly dollar allowance, 0 when uncapped. */
  capUsd: number;
}

/** Everything the onboarding wizard collects. */
export interface OnboardingInput {
  brandName: string;
  legalName: string;
  industry: string;
  niche: string;
  primaryDomain: string;
  secondaryDomains: string[];
  platformType: string;
  country: string;
  currency: string;
  timezone: string;
  teamSize: string;
  primaryGoal: string;
  goals: string[];
  adPlatforms: string[];
  socialHandles: Record<string, string>;
  notificationEmail: string;
  reportDay: string;
  competitors: MonitoringSourceInput[];
  clientCadence: SendFrequency;
  clientMessageTypes: MessageType[];
  loginEmail: string;
  signature: string;
  seedClients: ClientSeedInput[];
}

/** The single data shape every page renders from. */
export interface WorkspaceData {
  profile: BusinessProfile;
  metrics: BusinessMetrics;
  competitors: Competitor[];
  clients: Client[];
  mailAccount: MailAccount;
  sentMessages: SentMessage[];
  topSeoKeywords: RankRow[];
  topGeoKeywords: GeoRankRow[];
  /** Google organic positions, one row per keyword × device. */
  serpRankings: SerpRanking[];
  /** Local map 3-pack positions per keyword. */
  localPackRankings: LocalPackRanking[];
  /** Our Google Business Profile health, null until the first local scan. */
  localProfileHealth: LocalProfileHealth | null;
  /** Autocomplete suggestions found but not yet tracked. */
  keywordIdeas: KeywordIdea[];
  /** Share of Voice vs each competitor over the tracked keyword set. */
  shareOfVoice: ShareOfVoice[];
  /** Local rating / review-count gap vs each competitor. */
  competitorReviewGaps: CompetitorReviewGap[];
  /** Review profiles the workspace monitors. */
  reviewConnections: ReviewConnection[];
  /** The workspace's own Google Business Profile, for sending review replies. */
  googleProfile: GoogleProfile | null;
  /** Recent public posts pulled from each competitor's social profiles. */
  socialPosts: SocialPost[];
  /** Scrape state per monitored competitor handle. */
  socialMonitorTargets: SocialMonitorTarget[];
  geoVisibility: TrafficPoint[];
  weeklyReports: WeeklyReport[];
  reviewSources: ReviewSource[];
  latestReviewScan: ReviewScan;
  adAssets: AdAsset[];
  socialScores: SocialScore[];
  inventoryRecommendations: InventoryRecommendation[];
  inventory: InventoryItem[];
  /** Ad briefs the business has sent us. */
  promotionBriefs: PromotionBrief[];
  /** Finished ad designs we have produced and pushed back to them. */
  deliveredAds: DeliveredAd[];
  /** Social accounts the user has connected for publishing. */
  socialAccounts: SocialAccount[];
  /** Every push of a delivered design to those accounts. */
  publishJobs: SocialPublishJob[];
  buyList: string[];
  scanRuns: ScanRun[];
  /** External connections the tenant has saved (social accounts, review profiles…). */
  integrationConnections: IntegrationConnection[];
  /** Provider availability, connection counts and spend for the Integrations panel. */
  providerStatus: ProviderStatus[];
  /** Recorded provider calls, aggregated per provider. */
  apiUsage: ApiUsage[];
  /** True while the workspace has no monitored data of its own yet. */
  isSample: boolean;
}
