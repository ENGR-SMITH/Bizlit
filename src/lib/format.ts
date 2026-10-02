export function daysAgo(days: number, hours = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - hours, 0, 0, 0);
  return d.toISOString();
}

export function daysAhead(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}

export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (Math.abs(mins) < 1) return "just now";
  if (Math.abs(mins) < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function dayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function monthShort(month: string): string {
  return MONTH_SHORT[Number(month) - 1] ?? "";
}

/**
 * A metric series label as the axis should read it.
 *
 * The scans store machine-shaped labels — `2026-06-01` for a month of SimilarWeb
 * traffic, `2026-10-02` for one day's AI-visibility reading, `2026-10` for a
 * competitor's monthly review trend — while the sample workspace stores "Apr".
 * This reduces the dates to the same short form so a stored chart and a sample
 * chart read alike, and leaves anything that is not a date (a channel name, a
 * month already written short) exactly as it is.
 */
export function chartLabel(raw: string): string {
  const monthOnly = /^(\d{4})-(\d{2})$/.exec(raw);
  if (monthOnly) return monthShort(monthOnly[2]) || raw;

  const dated = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dated) {
    const month = monthShort(dated[2]);
    if (!month) return raw;
    // A point dated the 1st carries a month of data — that is how the traffic
    // provider labels its monthly series — so it reads as the month; every other
    // day is a single reading and reads as one.
    return dated[3] === "01" ? month : `${Number(dated[3])} ${month}`;
  }

  return raw;
}

export function money(value: number): string {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 100 ? 2 : 0,
  });
}

/**
 * A dollar figure that stays honest from whole dollars down to a fraction of a
 * cent.
 *
 * `money()` rounds to two decimals, which is right for a price and wrong for a
 * usage ledger: the AI drafting rows cost thousandths of a cent each, so a panel
 * built on `money()` reports real spend as `$0.00` and reads as "nothing was
 * charged". Amounts under a cent therefore keep just enough decimals to show
 * their leading significant digits, with trailing zeros trimmed.
 */
export function usd(value: number): string {
  const amount = Number.isFinite(value) ? value : 0;
  if (amount === 0) return "$0.00";

  const magnitude = Math.abs(amount);
  if (magnitude >= 0.01) return `$${amount.toFixed(2)}`;

  // ~3 significant figures below a cent, then trim the padding: $0.00055600 →
  // $0.000556. Two decimals are always kept so a rounded-up figure still reads
  // as currency rather than a bare fraction.
  const decimals = Math.min(8, Math.max(2, 3 - Math.floor(Math.log10(magnitude))));
  const fixed = amount.toFixed(decimals).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  // Too small for even eight decimals to show: say so rather than print `$0`,
  // which is the very reading this formatter exists to avoid.
  if (Number(fixed) === 0) return "$<0.00000001";
  return `$${fixed}`;
}

export function compact(value: number): string {
  return value.toLocaleString(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

export function pct(value: number, digits = 1): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function cadenceLabel(c: string): string {
  switch (c) {
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
    case "every_2_days":
      return "Every 2 days";
    default:
      return c;
  }
}

/** Host of a website URL, e.g. "supply.lumierecosmetics.com". Empty when unusable. */
export function domainFromUrl(url: string): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return raw
      .replace(/^https?:\/\//, "")
      .split(/[/?#]/)[0]
      .replace(/^www\./, "");
  }
}

/**
 * A website as it should be stored and requested, from however someone typed it.
 *
 * `competitor.com`, `https://competitor.com/` and `https://competitor.com/shop`
 * all become `https://competitor.com`. Normalising in one place is what keeps the
 * onboarding step, the add/edit forms and the scrape input in agreement — and it
 * is about the *request* being valid, not about display (`domainFromUrl` above
 * is the display side).
 *
 * Only the host is kept: a catalogue path points a site scan at one page rather
 * than the site, and a query or fragment can point it somewhere unintended.
 * Returns "" when there is nothing usable, so callers can reject it rather than
 * store a string no scan can open — the same reason a handle is normalized before
 * it becomes a billed target.
 */
export function normaliseWebsite(value: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    // A host is the one thing a URL cannot be useful without.
    return url.hostname ? `${url.protocol}//${url.host}` : "";
  } catch {
    return "";
  }
}

export function titleCase(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * What a scraped catalogue row is, as the monitoring pages label it.
 *
 * A missing kind means the row was read before the `kind` column existed
 * (migration 0025), when only products were stored — so it reads as a product
 * rather than as a blank label. Takes a plain string so this stays a leaf
 * formatter with no import of the domain types.
 */
export function itemKindLabel(kind: string | undefined): string {
  switch (kind) {
    case "service":
      return "Service";
    case "price_plan":
      return "Price plan";
    default:
      return "Product";
  }
}

/** Display names for the review-platform keys `my_reviews.platform` stores. */
const REVIEW_PLATFORM_LABELS: Record<string, string> = {
  google: "Google Reviews",
  yelp: "Yelp",
  g2: "G2",
  trustpilot: "Trustpilot",
  capterra: "Capterra",
  tripadvisor: "TripAdvisor",
  facebook: "Facebook",
  instagram: "Instagram",
};

/**
 * The platform a review was read from, as the tag on that review reads it.
 *
 * This mirrors the reader's own display names in `supabase/functions/_shared/
 * reviews.ts`, which the browser cannot import because that module is Deno-side
 * — so the two copies are pinned together by a test rather than left to drift.
 * An empty key returns an empty label (the caller falls back to the row's
 * `source`); an unknown key passes through unchanged, so a platform added to the
 * reader tomorrow shows its real name instead of a blank or invented tag.
 */
export function reviewPlatformLabel(platform: string): string {
  const key = platform.trim().toLowerCase();
  if (!key) return "";
  return REVIEW_PLATFORM_LABELS[key] ?? platform.trim();
}
