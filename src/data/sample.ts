import { adAssets, competitorReviewGaps, geoVisibility, inventoryRecommendations, keywordIdeas, latestReviewScan, localPackRankings, localProfileHealth, myBusiness, reviewConnections, reviewSources, serpRankings, shareOfVoice, socialScores, topGeoKeywords, topSeoKeywords, weeklyReports } from "./business";
import { clients, mailAccount, sentMessages } from "./clients";
import { competitors } from "./competitors";
import { deliveredAds, inventoryItems, promotionBriefs, samplePublishJobs, sampleSocialAccounts } from "./commerce";
import { socialMonitorTargets, socialPosts } from "./social";
import { daysAgo, daysAhead } from "../lib/format";
import { buildProviderStatus } from "../lib/integrations";
import type { BusinessMetrics, BusinessProfile, TrafficPoint, WorkspaceData } from "../lib/types";

/** Business-level numbers live on the profile row; series come from metrics rows. */
export function metricsFromProfile(
  profile: BusinessProfile,
  series: {
    traffic: TrafficPoint[];
    trafficSources: { label: string; share: number }[];
    topServers: { name: string; share: number }[];
    geoVisibility?: TrafficPoint[];
  },
): BusinessMetrics {
  return {
    seoScore: profile.seoScore,
    previousSeoScore: profile.previousSeoScore,
    geoScore: profile.geoScore,
    previousGeoScore: profile.previousGeoScore,
    domainAuthority: profile.domainAuthority,
    indexedPages: profile.indexedPages,
    backlinks: profile.backlinks,
    industryRank: profile.industryRank,
    industryRankPrevious: profile.industryRankPrevious,
    monthlyVisits: profile.monthlyVisits,
    visitsChange: profile.visitsChange,
    conversionRate: profile.conversionRate,
    traffic: series.traffic,
    trafficSources: series.trafficSources,
    topServers: series.topServers,
  };
}

export const sampleProfile: BusinessProfile = {
  id: "sample-business",
  ownerUserId: "sample-user",
  ownerEmail: mailAccount.loginEmail,
  brandName: "Your Retail Brand",
  logoUrl: "",
  legalName: "",
  industry: "Beauty & electronics retail",
  niche: "Beauty & cosmetics",
  primaryDomain: "yourretailbrand.com",
  secondaryDomains: ["shop.yourretailbrand.com"],
  platformType: "website",
  country: "Kenya",
  currency: "USD",
  timezone: "Africa/Nairobi (GMT+3)",
  teamSize: "2-10",
  primaryGoal: "Beat competitors on price and stock alerts",
  goals: ["win more traffic", "never miss a rival price drop", "keep clients updated"],
  adPlatforms: ["Meta Ads", "Google Ads", "TikTok Ads"],
  socialHandles: { Instagram: "@yourretailbrand", TikTok: "@yourretailbrand" },
  notificationEmail: mailAccount.loginEmail,
  reportDay: "Friday",
  onboardingComplete: true,
  seoScore: myBusiness.seoScore,
  previousSeoScore: myBusiness.previousSeoScore,
  // Search visibility as `serp-scan` writes it: five of the eight tracked terms in
  // the demo sit in the top 10, and the average position moved up since the scan
  // before. Real workspaces get these from the scan, never from onboarding.
  top10Count: 5,
  previousTop10Count: 4,
  rankedCount: 8,
  avgPosition: 9.8,
  previousAvgPosition: 11.2,
  rankingsCheckedAt: daysAgo(0, 3),
  geoScore: myBusiness.geoScore,
  previousGeoScore: myBusiness.previousGeoScore,
  monthlyVisits: myBusiness.monthlyVisits,
  visitsChange: myBusiness.visitsChange,
  conversionRate: myBusiness.conversionRate,
  industryRank: myBusiness.industryRank,
  industryRankPrevious: myBusiness.industryRankPrevious,
  domainAuthority: myBusiness.domainAuthority,
  indexedPages: myBusiness.indexedPages,
  backlinks: myBusiness.trustpilotBacklinks,
};

/** The complete workspace used in demo mode and before the first scan lands. */
export function sampleWorkspace(profile: BusinessProfile = sampleProfile): WorkspaceData {
  return {
    profile,
    metrics: metricsFromProfile(profile, {
      traffic: myBusiness.traffic,
      trafficSources: myBusiness.trafficSources,
      topServers: myBusiness.topServers,
      geoVisibility: geoVisibility,
    }),
    competitors,
    clients,
    mailAccount,
    sentMessages,
    topSeoKeywords,
    topGeoKeywords,
    serpRankings,
    localPackRankings,
    localProfileHealth,
    keywordIdeas,
    shareOfVoice,
    competitorReviewGaps,
    socialPosts,
    socialMonitorTargets,
    geoVisibility,
    weeklyReports,
    reviewSources,
    reviewConnections,
    // No OAuth grant was ever made for the sample workspace, so replies from it
    // stop at the connect button — the same honest "not configured" the other
    // integrations show rather than a connection that could never answer.
    googleProfile: null,
    latestReviewScan: {
      scannedAt: latestReviewScan.scannedAt,
      nextScanAt: daysAhead(1),
      newReviews: latestReviewScan.newReviews,
      flagged: latestReviewScan.flagged,
      averageRating: latestReviewScan.averageRating,
      items: latestReviewScan.items.map((r) => ({
        ...r,
        isFlagged: r.sentiment === "negative",
      })),
    },
    adAssets,
    socialScores,
    inventoryRecommendations,
    inventory: inventoryItems,
    promotionBriefs,
    deliveredAds,
    socialAccounts: sampleSocialAccounts,
    publishJobs: samplePublishJobs,
    buyList: [],
    scanRuns: [],
    // No provider credentials in demo mode, so every integration shows as
    // unconfigured with the connect prompt — the same shape as a live tenant
    // that has not added its keys yet.
    integrationConnections: [],
    providerStatus: buildProviderStatus({ connections: [], usage: [], config: {} }),
    apiUsage: [],
    isSample: true,
  };
}
