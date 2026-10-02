import { daysAgo, daysAhead, domainFromUrl } from "../lib/format";
import type {
  AdAngle,
  AdAsset,
  CompetitorReviewGap,
  ContactDiscoveryResult,
  GeoRankRow,
  InventoryRecommendation,
  KeywordCluster,
  KeywordIdea,
  LocalPackRanking,
  LocalProfileHealth,
  RankRow,
  ReviewConnection,
  ReviewSource,
  SerpRanking,
  ShareOfVoice,
  SocialScore,
  TrafficPoint,
  WeeklyReport,
} from "../lib/types";

const MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep"];

function series(values: number[]): TrafficPoint[] {
  return values.map((visits, i) => ({ label: MONTHS[i], visits }));
}

export const myBusiness = {
  brand: "Your Retail Brand",
  primaryDomain: "yourretailbrand.com",
  secondaryDomains: ["shop.yourretailbrand.com"],
  seoScore: 74,
  previousSeoScore: 68,
  geoScore: 61,
  previousGeoScore: 54,
  domainAuthority: 38,
  indexedPages: 1_284,
  trustpilotBacklinks: 412,
  industry: "Beauty & electronics retail",
  industryRank: 6,
  industryRankPrevious: 8,
  monthlyVisits: 184_300,
  visitsChange: 9.1,
  conversionRate: 2.4,
  traffic: series([128_000, 139_500, 149_200, 161_000, 168_900, 184_300]),
  trafficSources: [
    { label: "Organic search", share: 41 },
    { label: "Paid social", share: 19 },
    { label: "Direct", share: 18 },
    { label: "Email", share: 14 },
    { label: "Referral", share: 8 },
  ],
  topServers: [
    { name: "Google", share: 62 },
    { name: "Bing", share: 14 },
    { name: "ChatGPT", share: 12 },
    { name: "Perplexity", share: 7 },
    { name: "Others", share: 5 },
  ],
};

export const topSeoKeywords: RankRow[] = [
  { keyword: "velvet matte lip kit", volume: 9_400, position: 3, change: 4 },
  { keyword: "hydra glow serum 50ml", volume: 6_100, position: 2, change: 1 },
  { keyword: "aurora x5 phone price", volume: 12_800, position: 7, change: 6 },
  { keyword: "anc earbuds under 50", volume: 9_900, position: 12, change: 3 },
  { keyword: "cloud blush palette", volume: 4_300, position: 5, change: 9 },
  { keyword: "65w gan charger", volume: 5_700, position: 14, change: -2 },
  { keyword: "linen midi dress", volume: 7_300, position: 26, change: 5 },
  { keyword: "ceramic brake pads sedan", volume: 2_400, position: 9, change: 2 },
];

export const topGeoKeywords: GeoRankRow[] = [
  // 0 in `position` is "the answer did not mention us"; anything higher is the place
  // among the sources it listed. See `GeoRankRow`.
  { prompt: "where to buy velvet lip kits online", engine: "Google AI Overview", position: 2, sources: 5 },
  { prompt: "recommend a hydrating serum under $20", engine: "Google AI Overview", position: 1, sources: 6 },
  { prompt: "best value phone under $300", engine: "Google AI Overview", position: 4, sources: 8 },
  { prompt: "cheapest 65w gan charger retailer", engine: "Google AI Overview", position: 0, sources: 4 },
  { prompt: "affordable makeup bundle brands", engine: "Google AI Overview", position: 3, sources: 7 },
  { prompt: "linen dress shops with fast delivery", engine: "Google AI Overview", position: 0, sources: 5 },
];

export const geoVisibility: TrafficPoint[] = [
  { label: "Apr", visits: 21 },
  { label: "May", visits: 28 },
  { label: "Jun", visits: 34 },
  { label: "Jul", visits: 44 },
  { label: "Aug", visits: 52 },
  { label: "Sep", visits: 61 },
];

export const weeklyReports: WeeklyReport[] = [
  {
    week: "Week 39 · 21–24 Sep 2026",
    seoScore: 74,
    geoScore: 61,
    visits: 184_300,
    conversions: 4_423,
    highlight: "Two lip-kit keywords moved into the top 3; AI answers now cite us for serum queries.",
    actions: [
      "Publish a comparison page for 'anc earbuds under 50' (competitor holds position 6).",
      "Add FAQ schema to the Aurora X5 product page to win the AI Overview snippet.",
      "Rewrite the linen dress category copy to close the 23-position gap with StitchLine.",
    ],
  },
  {
    week: "Week 38 · 14–20 Sep 2026",
    seoScore: 71,
    geoScore: 57,
    visits: 174_100,
    conversions: 4_046,
    highlight: "GEO visibility up 9 points after adding structured product data.",
    actions: ["Refresh 6 product descriptions from the brand's own spec sheets.", "Fix 3 broken canonical tags."],
  },
  {
    week: "Week 37 · 7–13 Sep 2026",
    seoScore: 68,
    geoScore: 54,
    visits: 168_900,
    conversions: 3_882,
    highlight: "Back-in-stock pages recovered 1,240 organic sessions.",
    actions: ["Set up price-drop landing pages per competitor feed."],
  },
];

export const reviewSources: ReviewSource[] = [
  { source: "Google Reviews", score: 4.6, previousScore: 4.4, reviews: 1_842, newThisMonth: 96, series: series([4.3, 4.35, 4.4, 4.45, 4.5, 4.6]) },
  { source: "Trustpilot", score: 4.2, previousScore: 4.3, reviews: 612, newThisMonth: 41, series: series([4.4, 4.35, 4.3, 4.3, 4.25, 4.2]) },
  { source: "Facebook", score: 4.5, previousScore: 4.4, reviews: 388, newThisMonth: 23, series: series([4.2, 4.25, 4.3, 4.35, 4.4, 4.5]) },
  { source: "Instagram mentions", score: 4.4, previousScore: 4.2, reviews: 214, newThisMonth: 31, series: series([4.0, 4.1, 4.2, 4.25, 4.3, 4.4]) },
];

export const latestReviewScan = {
  scannedAt: daysAgo(0, 3),
  nextScan: daysAhead(1),
  newReviews: 37,
  flagged: 4,
  averageRating: 4.47,
  items: [
    {
      id: "myrev-1",
      author: "Grace W.",
      rating: 5,
      source: "Google Reviews",
      postedAt: daysAgo(0, 5),
      text: "Received my lip kit in two days and the checkout was smooth on mobile.",
      sentiment: "positive" as const,
      action: "Ask for a testimonial quote for the ad creative.",
      externalId: "rf-grace-w",
      platform: "google",
      language: "en",
      replied: true,
      replyText: "Thank you Grace — enjoy the kit, and we would love a one-line quote.",
      repliedAt: daysAgo(0, 3),
    },
    {
      id: "myrev-2",
      author: "Peter M.",
      rating: 2,
      source: "Trustpilot",
      // Older than the 48h reply window, so the "awaiting a reply" alert fires.
      postedAt: daysAgo(3),
      text: "Charger I bought was showing in stock but arrived 6 days later than promised.",
      sentiment: "negative" as const,
      action: "Sync charger stock from Vantage feed; reply with a delivery credit.",
      externalId: "rf-peter-m",
      platform: "trustpilot",
      language: "en",
      replied: false,
      replyText: "",
      repliedAt: null,
    },
    {
      id: "myrev-3",
      author: "Nadia H.",
      rating: 4,
      source: "Facebook",
      postedAt: daysAgo(1, 9),
      text: "Great prices but I could not find the blush palette under 'Face' on the website.",
      sentiment: "neutral" as const,
      action: "Add 'palette' to the Face category search synonyms.",
      externalId: "rf-nadia-h",
      platform: "facebook",
      language: "en",
      replied: false,
      replyText: "",
      repliedAt: null,
    },
    {
      id: "myrev-4",
      author: "Samuel K.",
      rating: 5,
      source: "Instagram mentions",
      postedAt: daysAgo(2),
      text: "Their team replied in the DMs and swapped the shade for me the same day.",
      sentiment: "positive" as const,
      action: "Repost to Stories with the new lip-kit ad.",
      externalId: "rf-samuel-k",
      platform: "instagram",
      language: "en",
      replied: false,
      replyText: "",
      repliedAt: null,
    },
  ],
};

/**
 * Sample connected review profiles so the reply composer and the "connect a
 * profile" affordance render before a live review sync runs.
 */
export const reviewConnections: ReviewConnection[] = [
  {
    id: "rc-google",
    provider: "reviews",
    platform: "google",
    handle: "yourretailbrand.com",
    label: "Google Reviews",
    status: "active",
    lastSyncedAt: daysAgo(0, 3),
    lastError: "",
    createdAt: daysAgo(20),
  },
  {
    id: "rc-trustpilot",
    provider: "reviews",
    platform: "trustpilot",
    handle: "yourretailbrand.com",
    label: "Trustpilot",
    status: "active",
    lastSyncedAt: daysAgo(0, 3),
    lastError: "",
    createdAt: daysAgo(20),
  },
  {
    id: "rc-facebook",
    provider: "reviews",
    platform: "facebook",
    handle: "YourRetailBrand",
    label: "Facebook",
    status: "active",
    lastSyncedAt: daysAgo(1),
    lastError: "",
    createdAt: daysAgo(12),
  },
];

export const adAssets: AdAsset[] = [
  {
    id: "aa-1",
    product: "Velvet Matte Lip Kit (12 shades)",
    sku: "LUM-LK-1200",
    formats: ["1200×1200", "1080×1920 Story", "300×250 display"],
    shootStatus: "ready",
    shootDate: daysAgo(4),
    figmaUrl: "https://figma.com/file/bizlit-lipkit-ads",
    downloadUrl: "/assets/ad-exports/lipkit-pack.zip",
    sizeMb: 42.6,
    downloads: 6,
  },
  {
    id: "aa-2",
    product: "Aurora X5 Smartphone 128GB",
    sku: "VAN-AX5-128",
    formats: ["1080×1080", "1080×1920 Story", "728×90 leaderboard"],
    shootStatus: "ready",
    shootDate: daysAgo(6),
    figmaUrl: "https://figma.com/file/bizlit-aurora-x5-ads",
    downloadUrl: "/assets/ad-exports/aurora-x5-pack.zip",
    sizeMb: 58.1,
    downloads: 3,
  },
  {
    id: "aa-3",
    product: "Linen Wrap Midi Dress",
    sku: "NOV-LW-4410",
    formats: ["1080×1080", "1000×1500 Pinterest"],
    shootStatus: "editing",
    shootDate: daysAgo(2),
    figmaUrl: "https://figma.com/file/bizlit-linen-dress-ads",
    downloadUrl: "/assets/ad-exports/linen-dress-pack.zip",
    sizeMb: 31.4,
    downloads: 1,
  },
  {
    id: "aa-4",
    product: "AeroChef Air Fryer 5.5L",
    sku: "HC-AC-5500",
    formats: ["1200×1200", "1920×1080 video"],
    shootStatus: "scheduled",
    shootDate: daysAhead(3),
    figmaUrl: "https://figma.com/file/bizlit-airochef-ads",
    downloadUrl: "/assets/ad-exports/airochef-pack.zip",
    sizeMb: 0,
    downloads: 0,
  },
];

export const socialScores: SocialScore[] = [
  {
    platform: "Instagram",
    handle: "@yourretailbrand",
    score: 68,
    followers: 34_200,
    growth: 6.4,
    benchmarkGap: -22,
    focus: "high",
    reason: "GlowMart posts 9×/week vs your 4×. Reels on price drops drive most of their organic reach.",
  },
  {
    platform: "TikTok",
    handle: "@yourretailbrand",
    score: 41,
    followers: 8_900,
    growth: 18.2,
    benchmarkGap: -44,
    focus: "high",
    reason: "Fastest-growing channel for competitors; your engagement rate is 2.1% vs their 7.1%.",
  },
  {
    platform: "Facebook",
    handle: "YourRetailBrand",
    score: 72,
    followers: 21_400,
    growth: 1.8,
    benchmarkGap: -11,
    focus: "medium",
    reason: "Solid ad performance; posting cadence below TecWave by 2 posts a week.",
  },
  {
    platform: "YouTube",
    handle: "@yourretailbrand",
    score: 33,
    followers: 3_100,
    growth: 4.1,
    benchmarkGap: -38,
    focus: "low",
    reason: "Low priority until product photography library is complete.",
  },
  {
    platform: "Pinterest",
    handle: "YourRetailBrand",
    score: 29,
    followers: 1_600,
    growth: 2.3,
    benchmarkGap: -19,
    focus: "medium",
    reason: "StitchLine gets 31% of traffic from Pinterest; strong fit for your dress and beauty SKUs.",
  },
];

/* ---------------------------------------------------- search visibility */
/*
 * Sample SerpApi output so the Local visibility panel renders before a real
 * scan runs. Positions mirror `topSeoKeywords`, with a small mobile variance.
 */
export const serpRankings: SerpRanking[] = [
  { keyword: "velvet matte lip kit", device: "desktop", location: "Kenya", position: 3, url: "https://yourretailbrand.com/products/velvet-lip-kit", title: "Velvet Matte Lip Kit — 12 shades", snippetType: "product", isRichResult: true, previousPosition: 3, previousIsRichResult: true, previousSnippetType: "product", checkedAt: daysAgo(0, 3) },
  { keyword: "velvet matte lip kit", device: "mobile", location: "Kenya", position: 4, url: "https://yourretailbrand.com/products/velvet-lip-kit", title: "Velvet Matte Lip Kit — 12 shades", snippetType: "product", isRichResult: true, previousPosition: 5, previousIsRichResult: true, previousSnippetType: "product", checkedAt: daysAgo(0, 3) },
  { keyword: "hydra glow serum 50ml", device: "desktop", location: "Kenya", position: 2, url: "https://yourretailbrand.com/products/hydra-glow-serum", title: "Hydra Glow Serum 50ml", snippetType: "faq", isRichResult: true, previousPosition: 2, previousIsRichResult: true, previousSnippetType: "faq", checkedAt: daysAgo(0, 3) },
  { keyword: "hydra glow serum 50ml", device: "mobile", location: "Kenya", position: 2, url: "https://yourretailbrand.com/products/hydra-glow-serum", title: "Hydra Glow Serum 50ml", snippetType: "faq", isRichResult: true, previousPosition: 2, previousIsRichResult: true, previousSnippetType: "faq", checkedAt: daysAgo(0, 3) },
  { keyword: "aurora x5 phone price", device: "desktop", location: "Kenya", position: 7, url: "https://yourretailbrand.com/products/aurora-x5", title: "Aurora X5 — price and specs", snippetType: "", isRichResult: false, previousPosition: 9, previousIsRichResult: false, previousSnippetType: "", checkedAt: daysAgo(0, 3) },
  { keyword: "aurora x5 phone price", device: "mobile", location: "Kenya", position: 9, url: "https://yourretailbrand.com/products/aurora-x5", title: "Aurora X5 — price and specs", snippetType: "", isRichResult: false, previousPosition: 8, previousIsRichResult: false, previousSnippetType: "", checkedAt: daysAgo(0, 3) },
  { keyword: "anc earbuds under 50", device: "desktop", location: "Kenya", position: 12, url: "", title: "", snippetType: "", isRichResult: false, previousPosition: 9, previousIsRichResult: true, previousSnippetType: "faq", checkedAt: daysAgo(0, 3) },
  { keyword: "anc earbuds under 50", device: "mobile", location: "Kenya", position: null, url: "", title: "", snippetType: "", isRichResult: false, previousPosition: null, previousIsRichResult: false, previousSnippetType: "", checkedAt: daysAgo(0, 3) },
  { keyword: "cloud blush palette", device: "desktop", location: "Kenya", position: 5, url: "https://yourretailbrand.com/products/cloud-blush", title: "Cloud Blush Trio Palette", snippetType: "product", isRichResult: true, previousPosition: 5, previousIsRichResult: true, previousSnippetType: "product", checkedAt: daysAgo(0, 3) },
  { keyword: "cloud blush palette", device: "mobile", location: "Kenya", position: 6, url: "https://yourretailbrand.com/products/cloud-blush", title: "Cloud Blush Trio Palette", snippetType: "product", isRichResult: true, previousPosition: 6, previousIsRichResult: true, previousSnippetType: "product", checkedAt: daysAgo(0, 3) },
];

export const localPackRankings: LocalPackRanking[] = [
  { keyword: "beauty shop near me", location: "Nairobi", inPack: true, packPosition: 2, placeId: "yourretailbrand", pack: [ { position: 1, name: "GlowMart Beauty", placeId: "glowmartbeauty", rating: 4.3, reviews: 3182 }, { position: 2, name: "Your Retail Brand", placeId: "yourretailbrand", rating: 4.6, reviews: 1842 }, { position: 3, name: "StitchLine Boutique", placeId: "stitchlineboutique", rating: 4.6, reviews: 1106 } ], previousInPack: true, previousPackPosition: 2, checkedAt: daysAgo(0, 3) },
  { keyword: "lip kit near me", location: "Nairobi", inPack: true, packPosition: 1, placeId: "yourretailbrand", pack: [ { position: 1, name: "Your Retail Brand", placeId: "yourretailbrand", rating: 4.6, reviews: 1842 }, { position: 2, name: "GlowMart Beauty", placeId: "glowmartbeauty", rating: 4.3, reviews: 3182 } ], previousInPack: true, previousPackPosition: 3, checkedAt: daysAgo(0, 3) },
  { keyword: "phone accessories shop", location: "Nairobi", inPack: false, packPosition: null, placeId: "yourretailbrand", pack: [ { position: 1, name: "TecWave Electronics", placeId: "tecwave", rating: 4.1, reviews: 2044 }, { position: 2, name: "PhonePoint", placeId: "phonepoint", rating: 4.4, reviews: 880 } ], previousInPack: true, previousPackPosition: 3, checkedAt: daysAgo(0, 3) },
];

export const localProfileHealth: LocalProfileHealth = {
  placeId: "yourretailbrand",
  label: "Your Retail Brand",
  score: 78,
  checks: [
    { label: "Website linked", ok: true, detail: "yourretailbrand.com" },
    { label: "Opening hours", ok: true, detail: "Mon–Sat 9:00–19:00" },
    { label: "Photos", ok: true, detail: "14 photos" },
    { label: "Business description", ok: false, detail: "Add a 750-character description" },
    { label: "Category set", ok: true, detail: "Beauty supply store" },
    { label: "Review volume", ok: false, detail: "1,842 reviews — GlowMart has 3,182" },
  ],
  reviewsCount: 1842,
  averageRating: 4.6,
  address: "Kimathi Street, Nairobi, Kenya",
  category: "Beauty supply store",
  website: "https://yourretailbrand.com",
  checkedAt: daysAgo(0, 3),
};

/**
 * Deterministic demo suggestions for a seed term. Used in demo mode (and before
 * the gateway is deployed) so the keyword finder always returns something.
 */
export function sampleKeywordIdeas(seed: string): KeywordIdea[] {
  const clean = seed.trim().toLowerCase() || "your product";
  const stamp = new Date().toISOString();
  const slug = clean.replace(/[^a-z0-9]+/g, "-");
  return [
    `${clean} near me`,
    `${clean} price`,
    `best ${clean} 2026`,
    `buy ${clean} online`,
    `${clean} reviews`,
  ].map((suggestion, index) => ({
    id: `ki-demo-${slug}-${index}`,
    seed: clean,
    suggestion,
    relevance: 900 - index * 120,
    source: "autocomplete",
    savedAsKeyword: false,
    cluster: "",
    createdAt: stamp,
  }));
}

export const keywordIdeas: KeywordIdea[] = [
  { id: "ki-1", seed: "velvet lip kit", suggestion: "velvet lip kit near me", relevance: 1250, source: "autocomplete", savedAsKeyword: false, cluster: "", createdAt: daysAgo(0, 3) },
  { id: "ki-2", seed: "velvet lip kit", suggestion: "velvet lip kit price in kenya", relevance: 601, source: "autocomplete", savedAsKeyword: false, cluster: "", createdAt: daysAgo(0, 3) },
  { id: "ki-3", seed: "velvet lip kit", suggestion: "velvet lip kit shades for dark skin", relevance: 540, source: "autocomplete", savedAsKeyword: false, cluster: "", createdAt: daysAgo(0, 3) },
  { id: "ki-4", seed: "velvet lip kit", suggestion: "best velvet lip kit 2026", relevance: 480, source: "autocomplete", savedAsKeyword: true, cluster: "", createdAt: daysAgo(0, 3) },
];

/*
 * Sample AI drafts, so every drafting surface renders with no provider key —
 * the same promise the rest of the sample data keeps.
 *
 * These are copy, not measurements. A draft is something the user reads, edits
 * and confirms, so there is nothing here that could be wrong the way an invented
 * number would be. Each is deterministic, so a demo does not reshuffle on click.
 */

/** A plausible reply to one of the sample reviews. */
export function sampleReplyDraft(input: { author: string; rating: number }): {
  reply: string;
  tone: string;
} {
  const who = input.author.trim() || "there";
  if (input.rating <= 3) {
    return {
      tone: "apologetic",
      reply: `Thank you for telling us, ${who} — that is not the experience we want anyone to have, and we are sorry. We have raised it with the team. If you are willing, please contact us directly so we can put it right.`,
    };
  }
  return {
    tone: "grateful",
    reply: `Thank you, ${who} — that is good to hear. We will pass it on to the team, and we hope to see you again soon.`,
  };
}

/** Angles for the demo social tab, grounded in the sample catalogue. */
export function sampleAdAngles(): AdAngle[] {
  return [
    {
      headline: "The shade that lasts past lunch",
      rationale: "Answers the wear-time worry people raise before buying a matte lip kit.",
      itemHint: "Velvet Matte Lip Kit",
    },
    {
      headline: "Twelve shades, matched in store",
      rationale: "Turns choosing online into a reason to visit, which is where the sale closes.",
      itemHint: "Velvet Matte Lip Kit",
    },
    {
      headline: "Nothing that dries your lips",
      rationale: "Leads with the comfort problem rather than the colour, which is less crowded.",
      itemHint: "Velvet Matte Lip Kit",
    },
  ];
}

/**
 * The demo stand-in for a website contacts scan.
 *
 * Derived from the site's own domain, so the same competitor always proposes the
 * same profiles and the accept flow is a real flow rather than a stub — and it
 * deliberately includes one platform we cannot monitor, so the "found, not
 * monitored" path is exercised in demo mode too.
 *
 * Demo mode never calls the gateway: there is no key, no actor and no spend.
 */
export function sampleSocialSuggestions(website: string): ContactDiscoveryResult {
  const domain = domainFromUrl(website) || "competitor.com";
  const brand = domain.split(".")[0].replace(/[^a-z0-9]/gi, "").toLowerCase() || "competitor";

  return {
    status: "done",
    scannedUrl: domain,
    costUsd: 0,
    unmonitored: ["YouTube"],
    suggestions: [
      {
        platform: "instagram",
        handle: brand,
        url: `https://www.instagram.com/${brand}/`,
        monitorable: true,
      },
      {
        platform: "facebook",
        handle: brand,
        url: `https://www.facebook.com/${brand}/`,
        monitorable: true,
      },
      {
        platform: "tiktok",
        handle: `${brand}official`,
        url: `https://www.tiktok.com/@${brand}official`,
        monitorable: true,
      },
      {
        platform: "youtube",
        handle: brand,
        url: `https://www.youtube.com/@${brand}`,
        monitorable: false,
      },
    ],
  };
}

/**
 * Themes for a seed's demo suggestions.
 *
 * Grouped from the suggestions actually passed in, rather than a fixed answer,
 * so the demo behaves like the real thing: every keyword shown belongs to a
 * suggestion the user can see in the list beside it.
 */
export function sampleKeywordClusters(ideas: KeywordIdea[]): KeywordCluster[] {
  const groups: { name: string; intent: string; match: (s: string) => boolean }[] = [
    { name: "Ready to buy", intent: "transactional", match: (s) => /near me|buy|shop|online/.test(s) },
    { name: "Price and value", intent: "commercial", match: (s) => /price|cost|cheap|affordable|deal/.test(s) },
    { name: "Choosing one", intent: "commercial", match: (s) => /best|review|compare|vs\b/.test(s) },
  ];

  const clusters: KeywordCluster[] = [];
  for (const group of groups) {
    const keywords = ideas.filter((idea) => group.match(idea.suggestion.toLowerCase()));
    if (keywords.length) {
      clusters.push({ name: group.name, intent: group.intent, keywords: keywords.map((k) => k.suggestion) });
    }
  }

  // Anything the patterns missed is still worth showing, so it becomes a theme
  // of its own rather than quietly disappearing from the grouped view.
  const placed = new Set(clusters.flatMap((cluster) => cluster.keywords));
  const rest = ideas.filter((idea) => !placed.has(idea.suggestion)).map((idea) => idea.suggestion);
  if (rest.length) clusters.push({ name: "Still researching", intent: "informational", keywords: rest });

  return clusters;
}

/*
 * Sample Share of Voice and Competitor Review Gap so Competition → Local renders
 * before a real benchmark runs. Mirrors the tracked keyword set and the local
 * profile health review counts above.
 */
export const shareOfVoice: ShareOfVoice[] = [
  { competitorId: "comp-glowmart", competitorName: "GlowMart Beauty", keywordSet: "tracked", termCount: 10, ourTop10: 6, theirTop10: 8, ourShare: 60, theirShare: 80, previousOurShare: 60, checkedAt: daysAgo(0, 3) },
  { competitorId: "comp-tecwave", competitorName: "TecWave Electronics", keywordSet: "tracked", termCount: 10, ourTop10: 6, theirTop10: 5, ourShare: 60, theirShare: 50, previousOurShare: 44, checkedAt: daysAgo(0, 3) },
  { competitorId: "comp-stitchline", competitorName: "StitchLine Boutique", keywordSet: "tracked", termCount: 10, ourTop10: 6, theirTop10: 4, ourShare: 60, theirShare: 40, previousOurShare: 60, checkedAt: daysAgo(0, 3) },
];

export const competitorReviewGaps: CompetitorReviewGap[] = [
  // GlowMart's lead grew since the last benchmark, so the "review gap widened"
  // alert has something to fire on in demo mode.
  { competitorId: "comp-glowmart", competitorName: "GlowMart Beauty", placeId: "glowmartbeauty", ourReviews: 1842, theirReviews: 3182, reviewGap: 1340, ourRating: 4.6, theirRating: 4.3, ratingGap: 0.3, previousReviewGap: 1180, checkedAt: daysAgo(0, 3) },
  { competitorId: "comp-tecwave", competitorName: "TecWave Electronics", placeId: "tecwave", ourReviews: 1842, theirReviews: 2044, reviewGap: 202, ourRating: 4.6, theirRating: 4.1, ratingGap: 0.5, previousReviewGap: null, checkedAt: daysAgo(0, 3) },
  { competitorId: "comp-stitchline", competitorName: "StitchLine Boutique", placeId: "stitchlineboutique", ourReviews: 1842, theirReviews: 1106, reviewGap: -736, ourRating: 4.6, theirRating: 4.6, ratingGap: 0, previousReviewGap: null, checkedAt: daysAgo(0, 3) },
];

export const inventoryRecommendations: InventoryRecommendation[] = [
  {
    id: "ir-1",
    product: "Glass Skin Toner 200ml",
    category: "Skincare",
    suggestedQty: 120,
    estimatedPrice: 24.9,
    marginPct: 44,
    trafficPotential: 18_400,
    reason: "GlowMart added this SKU last week and it already ranks 2nd for a 9.9k volume term.",
    priority: "high",
    competitorRef: "GlowMart Beauty",
  },
  {
    id: "ir-2",
    product: "Aurora X5 Pro 256GB",
    category: "Smartphones",
    suggestedQty: 60,
    estimatedPrice: 379,
    marginPct: 21,
    trafficPotential: 26_700,
    reason: "TecWave lists it and pulls 24% of its organic traffic from Aurora model searches.",
    priority: "high",
    competitorRef: "TecWave Electronics",
  },
  {
    id: "ir-3",
    product: "Ribbed Knit Cardigan",
    category: "Knitwear",
    suggestedQty: 80,
    estimatedPrice: 49.0,
    marginPct: 38,
    trafficPotential: 7_900,
    reason: "StitchLine's new arrival; 'affordable knit cardigan' is a 5.9k term where you sit at 19.",
    priority: "medium",
    competitorRef: "StitchLine Boutique",
  },
  {
    id: "ir-4",
    product: "Volt 65W GaN Charger",
    category: "Accessories",
    suggestedQty: 200,
    estimatedPrice: 19.5,
    marginPct: 42,
    trafficPotential: 5_700,
    reason: "Cheap attach-rate item; competitors bundle it with every phone listing.",
    priority: "medium",
    competitorRef: "TecWave Electronics",
  },
  {
    id: "ir-5",
    product: "Ceramic Brake Pad Set (Sedan)",
    category: "Auto parts",
    suggestedQty: 40,
    estimatedPrice: 39.9,
    marginPct: 33,
    trafficPotential: 2_400,
    reason: "A rival's promo ends in 6 days; niche but low competition locally.",
    priority: "low",
    competitorRef: "AutoNest Parts",
  },
];
