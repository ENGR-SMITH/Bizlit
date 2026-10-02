import { SOCIAL_PLATFORMS, platformOf, type SocialPlatform } from "./apify.ts";

/**
 * Scoring the workspace's **own** social profiles.
 *
 * The Social & reviews page has always shown a "your score per platform next to
 * the best competitor" table, but nothing ever wrote `social_scores` — so the
 * panel rendered its empty state forever, however many handles the workspace
 * declared. This module is the arithmetic behind the one producer for that table
 * (`social-scan`), kept pure so it can be unit-tested without a provider.
 *
 * The comparison the page promises is *against the tracked set*, not against the
 * whole platform: we hold a measured follower count and engagement rate for each
 * rival on the same platform, from the same reads, so the benchmark is a real
 * ordering of comparable estimates. When no rival is measured on a platform the
 * score is the profile's own standing and the reason says so rather than inventing
 * a comparison.
 */

/** What one own-profile scrape measured. */
export interface OwnProfileMetrics {
  platform: SocialPlatform;
  handle: string;
  followers: number;
  /** Average (likes + comments) ÷ followers across the scraped posts, as a percent. */
  engagement: number;
}

/** The best rival we measured on one platform, which the score is set against. */
export interface CompetitorBenchmark {
  competitorId: string;
  name: string;
  followers: number;
  engagement: number;
}

/** One row as `social_scores` stores it, minus the tenant/dates. */
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

/** Follower counts are compared, not read aloud, so they are shortened here. */
function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

/**
 * One own profile → a stored score.
 *
 * The blend is 65% audience (followers relative to the best rival) and 35%
 * engagement, which is what the page's "where to focus" column is ordering on: a
 * profile can be large and still score low if its audience does not respond.
 * `priorFollowers` is the figure from the last stored row, so growth is the
 * change since the previous scan rather than since the account existed.
 */
export function scoreOwnProfile(
  own: OwnProfileMetrics,
  best: CompetitorBenchmark | null,
  priorFollowers: number,
): SocialScore {
  const label = SOCIAL_PLATFORMS[own.platform].label;

  const followerScore =
    best && best.followers > 0
      ? Math.min(100, (own.followers / best.followers) * 100)
      : own.followers > 0
        ? 100
        : 0;
  const engagementScore =
    best && best.engagement > 0
      ? Math.min(100, (own.engagement / best.engagement) * 100)
      : own.engagement > 0
        ? 100
        : 0;

  const score = Math.max(
    0,
    Math.min(100, Math.round(followerScore * 0.65 + engagementScore * 0.35)),
  );

  const growth =
    priorFollowers > 0
      ? Number((((own.followers - priorFollowers) / priorFollowers) * 100).toFixed(1))
      : 0;

  const benchmarkGap = best ? own.followers - best.followers : 0;
  const focus: SocialScore["focus"] = score < 45 ? "high" : score < 65 ? "medium" : "low";

  const reason = best
    ? `${best.name} leads ${label} with ${compact(best.followers)} followers to your ${compact(own.followers)}` +
      (best.engagement > 0
        ? `, at ${best.engagement.toFixed(1)}% engagement against your ${own.engagement.toFixed(1)}%.`
        : ".")
    : `No competitor is measured on ${label} yet — this is your own baseline: ${compact(own.followers)} followers, ${own.engagement.toFixed(1)}% engagement.`;

  return {
    platform: label,
    handle: own.handle,
    score,
    followers: own.followers,
    growth,
    benchmarkGap,
    focus,
    reason,
  };
}

/** One `competitor_social` row, as the benchmark read needs it. */
export interface CompetitorSocialRow {
  competitor_id: string | null;
  platform: string;
  followers: number;
}

/** One `social_posts` row, enough to average a rival's engagement. */
export interface CompetitorPostRow {
  competitor_id: string | null;
  platform: string;
  likes: number;
  comments: number;
  engagement_rate: number;
}

/**
 * The best rival per platform, from the data we already hold.
 *
 * Followers decide the "best" and engagement is stored alongside so the reason
 * can name it. A rival who appears on two rows of the same platform keeps the
 * higher follower count; an engagement of 0 is treated as "not measured" rather
 * than "no engagement", so a workspace whose posts predate follower collection
 * does not report a best rival at 0%.
 */
export function bestBenchmarkByPlatform(
  socialRows: CompetitorSocialRow[],
  postRows: CompetitorPostRow[],
  names: Map<string, string>,
): Map<SocialPlatform, CompetitorBenchmark> {
  const followers = new Map<string, number>();
  const platformByKey = new Map<string, SocialPlatform>();

  for (const row of socialRows) {
    if (!row.competitor_id) continue;
    const platform = platformOf(row.platform);
    if (!platform) continue;
    const key = `${row.competitor_id}|${platform}`;
    platformByKey.set(key, platform);
    followers.set(key, Math.max(followers.get(key) ?? 0, Number(row.followers ?? 0)));
  }

  const engagementSum = new Map<string, number>();
  const engagementCount = new Map<string, number>();
  for (const post of postRows) {
    if (!post.competitor_id) continue;
    const platform = platformOf(post.platform);
    if (!platform) continue;
    const key = `${post.competitor_id}|${platform}`;
    if (!followers.has(key)) continue;

    const count = Number(post.engagement_rate ?? 0);
    const rate =
      count > 0
        ? count
        : (() => {
            const audience = followers.get(key) ?? 0;
            return audience > 0
              ? ((Number(post.likes ?? 0) + Number(post.comments ?? 0)) / audience) * 100
              : 0;
          })();

    engagementSum.set(key, (engagementSum.get(key) ?? 0) + rate);
    engagementCount.set(key, (engagementCount.get(key) ?? 0) + 1);
  }

  const best = new Map<SocialPlatform, CompetitorBenchmark>();
  for (const [key, audience] of followers) {
    const platform = platformByKey.get(key);
    if (!platform) continue;
    const competitorId = key.slice(0, key.indexOf("|"));
    const count = engagementCount.get(key) ?? 0;
    const engagement = count ? (engagementSum.get(key) ?? 0) / count : 0;

    const current = best.get(platform);
    if (
      !current ||
      audience > current.followers ||
      (audience === current.followers && engagement > current.engagement)
    ) {
      best.set(platform, {
        competitorId,
        name: names.get(competitorId) ?? "A tracked competitor",
        followers: audience,
        engagement,
      });
    }
  }

  return best;
}
