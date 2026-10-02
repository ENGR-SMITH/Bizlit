import { describe, expect, it } from "vitest";
import {
  isRecentPost,
  mergeSocialChannel,
  normaliseSocialHandle,
  parseFollowerCount,
  platformLabel,
  socialPlatformOf,
  summariseChannelSocial,
  summariseSocial,
} from "../src/lib/social";
import { buildAlerts } from "../src/lib/alerts";
import { sampleWorkspace } from "../src/data/sample";
import {
  engagementRate,
  followersFrom,
  inputFor,
  normalisePost,
  normalisePosts,
  platformOf,
  tagsInCaption,
  toIsoTimestamp,
} from "../supabase/functions/_shared/apify";
import {
  bestBenchmarkByPlatform,
  scoreOwnProfile,
} from "../supabase/functions/_shared/socialScore";
import type { SocialPost } from "../src/lib/types";

/** A post with sensible defaults, so each test only states what it is about. */
function post(overrides: Partial<SocialPost> & { postedAt: string }): SocialPost {
  return {
    id: overrides.externalId ?? "p",
    competitorId: "comp-1",
    platform: "instagram",
    externalId: "p",
    url: "",
    caption: "",
    mediaUrl: "",
    mediaType: "Image",
    hashtags: [],
    mentions: [],
    likes: 0,
    comments: 0,
    shares: 0,
    views: 0,
    engagementRate: 0,
    scrapedAt: overrides.postedAt,
    ...overrides,
  };
}

const NOW = new Date("2026-09-27T12:00:00.000Z");
const at = (daysAgo: number, hoursAgo = 0) =>
  new Date(NOW.getTime() - daysAgo * 86_400_000 - hoursAgo * 3_600_000).toISOString();

describe("summariseSocial", () => {
  it("measures cadence, averages and the posts-per-day window from the posts themselves", () => {
    const insight = summariseSocial(
      [
        post({ externalId: "a", postedAt: at(0, 2), engagementRate: 8 }),
        post({ externalId: "b", postedAt: at(0, 9), engagementRate: 5 }),
        post({ externalId: "c", postedAt: at(0, 20), engagementRate: 3 }),
        post({ externalId: "d", postedAt: at(3), engagementRate: 4 }),
        post({ externalId: "e", postedAt: at(8), engagementRate: 2 }),
      ],
      "comp-1",
      NOW,
    );

    expect(insight.posts).toBe(5);
    expect(insight.postsLast24Hours).toBe(3);
    expect(insight.postsLast7Days).toBe(4);
    // Five posts inside a 30-day window → 5 / (30/7) per week.
    expect(insight.postsPerWeek).toBe(1.2);
    expect(insight.averageEngagement).toBe(4.4);
    expect(insight.bestPost?.externalId).toBe("a");
  });

  it("keeps the pre-window best post as the record to beat", () => {
    const insight = summariseSocial(
      [
        post({ externalId: "recent", postedAt: at(2), engagementRate: 8.1 }),
        post({ externalId: "old", postedAt: at(60), engagementRate: 4.4 }),
      ],
      "comp-1",
      NOW,
    );

    expect(insight.bestPost?.externalId).toBe("recent");
    expect(insight.previousBest?.externalId).toBe("old");
  });

  it("counts only this competitor's posts and ranks their hashtags", () => {
    const insight = summariseSocial(
      [
        post({ externalId: "a", postedAt: at(1), hashtags: ["velvet", "nairobi"] }),
        post({ externalId: "b", postedAt: at(2), hashtags: ["velvet"] }),
        post({ externalId: "other", competitorId: "comp-2", postedAt: at(1) }),
      ],
      "comp-1",
      NOW,
    );

    expect(insight.posts).toBe(2);
    expect(insight.topHashtags[0]).toEqual({ tag: "velvet", count: 2 });
  });

  it("returns an empty insight for a competitor we have no posts for", () => {
    const insight = summariseSocial([], "comp-missing", NOW);

    expect(insight.posts).toBe(0);
    expect(insight.bestPost).toBeNull();
    expect(insight.postsPerWeek).toBe(0);
  });
});

describe("summariseChannelSocial", () => {
  const now = new Date("2026-09-27T12:00:00.000Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  it("measures one platform only, not the competitor's other channels", () => {
    const posts = [
      post({ externalId: "a", platform: "instagram", postedAt: daysAgo(1), engagementRate: 2 }),
      post({ externalId: "b", platform: "instagram", postedAt: daysAgo(2), engagementRate: 4 }),
      post({ externalId: "c", platform: "tiktok", postedAt: daysAgo(1), engagementRate: 9 }),
    ];

    const instagram = summariseChannelSocial(posts, "comp-1", "instagram", now);
    expect(instagram.posts).toBe(2);
    expect(instagram.averageEngagement).toBe(3);
    expect(instagram.postsPerWeek).toBe(0.5);
  });

  it("matches a platform however the stored channel row spells it", () => {
    // `competitor_social.platform` can hold a display label for an imported row.
    const posts = [post({ externalId: "a", platform: "x", postedAt: daysAgo(1), engagementRate: 1 })];
    expect(summariseChannelSocial(posts, "comp-1", "X (Twitter)", now).posts).toBe(1);
  });

  it("reports nothing measured for a platform with no scraped posts", () => {
    expect(summariseChannelSocial([], "comp-1", "facebook", now)).toEqual({
      posts: 0,
      postsPerWeek: 0,
      averageEngagement: 0,
    });
  });
});

describe("platform helpers", () => {
  it("labels platform keys and passes unknown ones through", () => {
    expect(platformLabel("instagram")).toBe("Instagram");
    expect(platformLabel("x")).toBe("X");
    expect(platformLabel("Mastodon")).toBe("Mastodon");
  });

  it("maps the stored competitor platform labels onto scraper platforms", () => {
    expect(platformOf("X (Twitter)")).toBe("x");
    expect(platformOf("Instagram")).toBe("instagram");
    expect(platformOf("YouTube")).toBeNull();
  });

  it("marks posts from the last 48 hours as new", () => {
    expect(isRecentPost(post({ postedAt: at(1) }), NOW)).toBe(true);
    expect(isRecentPost(post({ postedAt: at(5) }), NOW)).toBe(false);
  });
});

describe("Apify normalisation", () => {
  it("reads the Instagram scraper's own field names", () => {
    const normalised = normalisePost(
      {
        id: "12345",
        shortCode: "C7xKq1",
        url: "https://www.instagram.com/p/C7xKq1/",
        caption: "Restock day #velvetlipkit thanks @glowmart",
        displayUrl: "https://cdn.example.com/a.jpg",
        type: "Image",
        likesCount: 14_200,
        commentsCount: 640,
        timestamp: "2026-09-27T09:30:00.000Z",
      },
      "instagram",
    );

    expect(normalised).toMatchObject({
      externalId: "12345",
      caption: "Restock day #velvetlipkit thanks @glowmart",
      likes: 14_200,
      comments: 640,
      mediaType: "Image",
      postedAt: "2026-09-27T09:30:00.000Z",
    });
    expect(normalised?.hashtags).toEqual(["velvetlipkit"]);
    expect(normalised?.mentions).toEqual(["glowmart"]);
  });

  it("falls back to aliases when an actor renames its fields", () => {
    const normalised = normalisePost(
      { shortCode: "ABC", text: "Morning drop", imageUrl: "https://cdn.example.com/b.jpg", likes: 12 },
      "instagram",
    );

    expect(normalised).toMatchObject({
      externalId: "ABC",
      caption: "Morning drop",
      mediaUrl: "https://cdn.example.com/b.jpg",
      likes: 12,
      url: "https://www.instagram.com/p/ABC/",
    });
  });

  it("drops items with no identity and de-duplicates repeats", () => {
    const items = [
      { caption: "no id here" },
      { id: "same", caption: "first" },
      { id: "same", caption: "second" },
    ];

    expect(normalisePost(items[0], "instagram")).toBeNull();
    expect(normalisePosts(items, "instagram")).toHaveLength(1);
    expect(normalisePosts(items, "instagram")[0].caption).toBe("second");
  });

  it("computes engagement against the profile's followers", () => {
    expect(engagementRate(14_200, 640, 184_000)).toBe(8.065);
    // A post for a profile with no followers recorded cannot have a rate.
    expect(engagementRate(100, 10, 0)).toBe(0);
  });

  it("parses timestamps in seconds, milliseconds and ISO form", () => {
    expect(toIsoTimestamp(1_790_000_000)).toBe("2026-09-21T14:13:20.000Z");
    expect(toIsoTimestamp(1_790_000_000_000)).toBe("2026-09-21T14:13:20.000Z");
    expect(toIsoTimestamp("not a date")).toBeNull();
  });

  it("extracts hashtags and mentions from a caption", () => {
    expect(tagsInCaption("Restock #velvetlipkit with @glowmart", "#")).toEqual(["velvetlipkit"]);
    expect(tagsInCaption("Restock #velvetlipkit with @glowmart", "@")).toEqual(["glowmart"]);
  });

  it("sends the Instagram scraper its documented input shape", () => {
    expect(inputFor("instagram", "x", 30, "1 month")).toMatchObject({
      directUrls: ["https://www.instagram.com/x/"],
      resultsType: "posts",
      resultsLimit: 30,
      onlyPostsNewerThan: "1 month",
    });
  });

  it("sends each platform the input keys its actor actually accepts", () => {
    // Facebook's actor marks `startUrls` required, so a URL has to go there.
    expect(inputFor("facebook", "acme", 30, "1 month")).toMatchObject({
      startUrls: [{ url: "https://www.facebook.com/acme/" }],
      resultsLimit: 30,
    });
    // TikTok's actor is addressed by username and counts with `resultsPerPage`.
    expect(inputFor("tiktok", "@acme", 30, "2026-09-01")).toMatchObject({
      profiles: ["acme"],
      resultsPerPage: 30,
      oldestPostDateUnified: "2026-09-01",
    });
    // X's actor is addressed by handle and caps output with `maxItems`.
    expect(inputFor("x", "@acme", 30, "2026-09-01")).toMatchObject({
      twitterHandles: ["acme"],
      maxItems: 30,
      start: "2026-09-01",
    });
  });

  it("never sends the keys the non-Instagram actors reject", () => {
    for (const platform of ["tiktok", "facebook", "x"] as const) {
      expect(inputFor(platform, "acme", 30, "1 month")).not.toHaveProperty("directUrls");
    }
    expect(inputFor("tiktok", "acme", 30, "1 month")).not.toHaveProperty("resultsLimit");
    expect(inputFor("x", "acme", 30, "1 month")).not.toHaveProperty("resultsLimit");
    // A relative `since` is not a date, so it must not reach a date-only field.
    expect(inputFor("tiktok", "acme", 30, "1 month")).not.toHaveProperty("oldestPostDateUnified");
    expect(inputFor("x", "acme", 30, "1 month")).not.toHaveProperty("start");
  });
});

describe("demo social data and alerts", () => {
  it("fires the posting-burst and new-record alerts from the sample posts", () => {
    const alerts = buildAlerts(sampleWorkspace());
    const titles = alerts.map((alert) => alert.title);

    expect(titles.some((title) => title.includes("3 posts in 24 hours"))).toBe(true);
    expect(titles.some((title) => title.includes("beat their 30-day engagement record"))).toBe(true);
  });

  it("does not invent an alert for a competitor with a quiet profile", () => {
    const alerts = buildAlerts(sampleWorkspace());

    expect(alerts.some((alert) => alert.id === "alert-social-burst-comp-stitchline")).toBe(false);
    expect(alerts.some((alert) => alert.id === "alert-social-record-comp-tecwave")).toBe(false);
  });
});

/**
 * The X actor counts with Twitter's vocabulary — `likeCount`, `replyCount`,
 * `retweetCount` — not Instagram's, and this item is a real captured one. Read
 * only the Instagram names and the engagement card silently shows zeroes.
 */
describe("competitor handle normalising", () => {
  it("reduces a pasted profile URL to the bare handle the scraper addresses", () => {
    // The gateway strips a leading "@" and then builds the profile URL around the
    // result, so anything else left in there breaks the URL it sends the actor.
    expect(normaliseSocialHandle("@rei")).toBe("rei");
    expect(normaliseSocialHandle("rei")).toBe("rei");
    expect(normaliseSocialHandle("  rei  ")).toBe("rei");
    expect(normaliseSocialHandle("https://www.instagram.com/arcteryx/")).toBe("arcteryx");
    expect(normaliseSocialHandle("instagram.com/arcteryx")).toBe("arcteryx");
    expect(normaliseSocialHandle("https://www.tiktok.com/@glowmart")).toBe("glowmart");
    expect(normaliseSocialHandle("https://x.com/REI?lang=en")).toBe("REI");
    expect(normaliseSocialHandle("facebook.com/GlowMartBeauty/")).toBe("GlowMartBeauty");
  });

  it("refuses a bare domain rather than scraping it as if it were a username", () => {
    expect(normaliseSocialHandle("instagram.com")).toBe("");
    expect(normaliseSocialHandle("")).toBe("");
    expect(normaliseSocialHandle("   ")).toBe("");
  });

  it("maps the stored platform labels onto the keys the gateway scrapes", () => {
    expect(socialPlatformOf("instagram")).toBe("instagram");
    expect(socialPlatformOf("Instagram")).toBe("instagram");
    expect(socialPlatformOf("X (Twitter)")).toBe("x");
    expect(socialPlatformOf("Twitter")).toBe("x");
    expect(socialPlatformOf("TikTok")).toBe("tiktok");
    // A platform with no actor wired up is not a target the scan can use.
    expect(socialPlatformOf("YouTube")).toBeNull();
    expect(socialPlatformOf("Pinterest")).toBeNull();
  });

  it("keeps one channel per platform, whichever spelling the row uses", () => {
    const existing = [
      {
        platform: "Instagram",
        handle: "@old",
        followers: 10,
        engagementRate: 1,
        postsPerWeek: 1,
        adsRunning: 0,
      },
    ];
    const merged = mergeSocialChannel(existing, {
      platform: "instagram",
      handle: "new",
      followers: 0,
      engagementRate: 0,
      postsPerWeek: 0,
      adsRunning: 0,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].handle).toBe("new");
  });

  it("appends a platform that is not tracked yet", () => {
    const merged = mergeSocialChannel([], {
      platform: "tiktok",
      handle: "glowmart",
      followers: 0,
      engagementRate: 0,
      postsPerWeek: 0,
      adsRunning: 0,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].platform).toBe("tiktok");
  });
});

describe("follower counts behind an engagement rate", () => {
  it("reads the spellings the platform actors use, flat and nested", () => {
    expect(followersFrom([{ followersCount: 184_000 }])).toBe(184_000);
    expect(followersFrom([{ follower_count: "41,500" }])).toBe(41_500);
    expect(followersFrom([{ owner: { followersCount: 9_800 } }])).toBe(9_800);
    expect(followersFrom([{ author: { followerCount: 1_200 } }])).toBe(1_200);
  });

  it("reports a dataset that never states it as unknown, not as zero", () => {
    // Zero would take the same branch as a real zero and make every engagement
    // rate structurally 0% — the bug this reader exists to prevent.
    expect(followersFrom([{ id: "1", likesCount: 12 }])).toBeNull();
    expect(followersFrom([])).toBeNull();
  });

  it("takes the first item that actually states one", () => {
    expect(followersFrom([{ id: "a" }, { followers: 500 }])).toBe(500);
  });

  it("turns a count and a post into a real engagement rate once both exist", () => {
    const followers = followersFrom([{ followersCount: 200_000 }]);
    expect(followers).toBe(200_000);
    expect(engagementRate(9_000, 700, followers ?? 0)).toBe(4.85);
  });

  it("reads the profile an Instagram post item nests under metaData", () => {
    // Shape taken from a live `apify/instagram-scraper` dataset: the post item
    // carries no follower field of its own, and the whole profile — follower
    // count included — sits under `metaData`. Miss this nesting and every
    // Instagram engagement rate stays 0% however many posts are captured.
    const item = {
      id: "3170000000000000000",
      shortCode: "DPxxxx",
      ownerUsername: "sephora",
      likesCount: 211_983,
      commentsCount: 900,
      metaData: {
        username: "sephora",
        fullName: "Sephora",
        followersCount: 22_716_271,
        postsCount: 9_008,
        isBusinessAccount: true,
      },
    };

    expect(followersFrom([item])).toBe(22_716_271);
    expect(engagementRate(item.likesCount, item.commentsCount, 22_716_271)).toBe(0.937);
  });

  it("reads TikTok's authorMeta.fans, its own word for the same number", () => {
    expect(followersFrom([{ id: "1", authorMeta: { name: "sephora", fans: 4_100_000 } }])).toBe(
      4_100_000,
    );
  });
});

describe("parseFollowerCount", () => {
  it("accepts a plain number, thousands separators and the k/m shorthand", () => {
    expect(parseFollowerCount("184000")).toEqual({ followers: 184_000 });
    expect(parseFollowerCount("184,000")).toEqual({ followers: 184_000 });
    expect(parseFollowerCount("184k")).toEqual({ followers: 184_000 });
    expect(parseFollowerCount("1.2m")).toEqual({ followers: 1_200_000 });
  });

  it("treats a blank box as unknown — neither a count nor an error", () => {
    // It must stay unknown: saving 0 would wipe a figure the last scan measured.
    expect(parseFollowerCount("")).toEqual({});
    expect(parseFollowerCount("   ")).toEqual({});
  });

  it("refuses what it cannot read rather than saving a wrong denominator", () => {
    expect(parseFollowerCount("lots").error).toBeTruthy();
    expect(parseFollowerCount("184k followers").error).toBeTruthy();
    expect(parseFollowerCount("-5").error).toBeTruthy();
    expect(parseFollowerCount("184k").followers).toBe(184_000);
    expect(parseFollowerCount("lots").followers).toBeUndefined();
  });

  it("refuses a count the integer column cannot hold", () => {
    expect(parseFollowerCount("9999999999").error).toBeTruthy();
  });
});

describe("live X actor field names", () => {
  it("reads likeCount, replyCount and retweetCount", () => {
    const post = normalisePost(
      {
        type: "tweet",
        id: "1587474547443474432",
        url: "https://x.com/REI/status/1587474547443474432",
        text: "Our holiday gift center is here!",
        retweetCount: 72,
        replyCount: 211,
        likeCount: 155,
        quoteCount: 6,
        createdAt: "Tue Nov 01 16:00:00 +0000 2022",
        lang: "en",
      },
      "x",
    );

    expect(post).toMatchObject({
      externalId: "1587474547443474432",
      likes: 155,
      comments: 211,
      shares: 72,
    });
    expect(post?.postedAt).toBe("2022-11-01T16:00:00.000Z");
    expect(post?.url).toBe("https://x.com/REI/status/1587474547443474432");
  });

  it("takes a media URL out of X's nested media block", () => {
    expect(
      normalisePost({ id: "1", text: "hi", media: [{ media_url_https: "https://pbs.twimg.com/media/x.jpg" }] }, "x")?.mediaUrl,
    ).toBe("https://pbs.twimg.com/media/x.jpg");
    expect(normalisePost({ id: "2", text: "hi", media: "https://pbs.twimg.com/media/y.jpg" }, "x")?.mediaUrl).toBe(
      "https://pbs.twimg.com/media/y.jpg",
    );
  });
});

describe("scoring the workspace's own social profiles", () => {
  const best = {
    competitorId: "rival-1",
    name: "GlowMart Beauty",
    followers: 20_000,
    engagement: 4,
  };

  it("sets the score against the best rival and reports the raw gap", () => {
    const score = scoreOwnProfile(
      { platform: "instagram", handle: "@yourbrand", followers: 10_000, engagement: 2 },
      best,
      8_000,
    );

    expect(score.platform).toBe("Instagram");
    expect(score.handle).toBe("@yourbrand");
    // Half the rival's followers and half its engagement → 50.
    expect(score.score).toBe(50);
    // Growth is against the previous scan's own figure, not the rival's.
    expect(score.growth).toBe(25);
    expect(score.benchmarkGap).toBe(-10_000);
    expect(score.focus).toBe("medium");
    expect(score.reason).toContain("GlowMart Beauty");
  });

  it("caps the score at 100 when the workspace is ahead on both counts", () => {
    const score = scoreOwnProfile(
      { platform: "tiktok", handle: "@yourbrand", followers: 30_000, engagement: 5 },
      best,
      0,
    );

    expect(score.score).toBe(100);
    expect(score.benchmarkGap).toBe(10_000);
    expect(score.focus).toBe("low");
    // No previous figure is a baseline, not a growth of zero percent.
    expect(score.growth).toBe(0);
  });

  it("is the profile's own standing when no rival is measured on the platform", () => {
    const score = scoreOwnProfile(
      { platform: "facebook", handle: "@yourbrand", followers: 1_000, engagement: 0 },
      null,
      0,
    );

    expect(score.benchmarkGap).toBe(0);
    expect(score.reason).toContain("No competitor");
    // 65% of a full audience score and 35% of nothing.
    expect(score.score).toBe(65);
  });

  it("scores an unmeasured or empty profile as needing focus, never as a pass", () => {
    const score = scoreOwnProfile(
      { platform: "instagram", handle: "@yourbrand", followers: 0, engagement: 0 },
      best,
      0,
    );

    expect(score.score).toBe(0);
    expect(score.focus).toBe("high");
  });

  it("picks the biggest rival per platform from the reads already on file", () => {
    const benchmarks = bestBenchmarkByPlatform(
      [
        { competitor_id: "a", platform: "Instagram", followers: 1_000 },
        { competitor_id: "b", platform: "instagram", followers: 5_000 },
      ],
      [
        { competitor_id: "b", platform: "instagram", likes: 100, comments: 50, engagement_rate: 3 },
        { competitor_id: "a", platform: "instagram", likes: 10, comments: 0, engagement_rate: 9 },
      ],
      new Map([
        ["a", "Alpha"],
        ["b", "Beta"],
      ]),
    );

    expect(benchmarks.get("instagram")).toMatchObject({
      competitorId: "b",
      name: "Beta",
      followers: 5_000,
      engagement: 3,
    });
  });

  it("derives an engagement rate when the post row did not store one", () => {
    const benchmarks = bestBenchmarkByPlatform(
      [{ competitor_id: "a", platform: "x", followers: 10_000 }],
      [{ competitor_id: "a", platform: "x", likes: 100, comments: 0, engagement_rate: 0 }],
      new Map([["a", "Alpha"]]),
    );

    expect(benchmarks.get("x")?.engagement).toBe(1);
  });
});
