import type { ReactNode } from "react";
import { reviewPlatformLabel } from "../lib/format";

/**
 * The tag a review carries for the platform it was read from.
 *
 * A review list mixes platforms — Google, Trustpilot, Yelp — and a single grey
 * pill makes the reader work out which page each review came from. Each
 * platform therefore gets its own colour, taken from its own brand, and its
 * logo as a small app-icon chip: the two together identify the platform before
 * the label is even read.
 *
 * The colours are written as literal class strings (a light tint of the brand
 * for the pill, the saturated brand colour behind the logo) so Tailwind's
 * scanner sees them, and they match the shape of the `Badge` tones in
 * primitives — same pill geometry, same `bg / text / ring` construction — so a
 * platform tag sits beside a language or reply badge without looking foreign.
 * A platform with no brand here still gets a tag: the label is shown in the
 * neutral pill rather than dropped.
 */
export interface ReviewPlatformBrand {
  /** The pill: a light tint of the brand, its readable text colour, its ring. */
  pill: string;
  /** The chip the logo sits on: the brand colour itself. */
  chip: string;
}

export const REVIEW_PLATFORM_BRANDS: Record<string, ReviewPlatformBrand> = {
  google: {
    pill: "bg-[#E8F0FE] text-[#1A73E8] ring-[#C6DAFC]",
    chip: "bg-white ring-1 ring-[#DADCE0]",
  },
  trustpilot: {
    pill: "bg-[#E6F7F1] text-[#00855C] ring-[#B7E8D6]",
    chip: "bg-[#00B67A]",
  },
  yelp: {
    pill: "bg-[#FDECEC] text-[#C41200] ring-[#F6C2C2]",
    chip: "bg-[#D32323]",
  },
  g2: {
    pill: "bg-[#FFEEEA] text-[#C1341A] ring-[#FFC9BE]",
    chip: "bg-[#FF492C]",
  },
  capterra: {
    pill: "bg-[#FFF4E3] text-[#B45309] ring-[#FBDCA9]",
    chip: "bg-[#FF9D28]",
  },
  tripadvisor: {
    pill: "bg-[#E3FAF3] text-[#00756A] ring-[#A6EEDD]",
    chip: "bg-[#34E0A1]",
  },
  facebook: {
    pill: "bg-[#DCE9FE] text-[#1560C0] ring-[#AFC9F5]",
    chip: "bg-[#1877F2]",
  },
  instagram: {
    pill: "bg-[#FCE9F1] text-[#C2185B] ring-[#F6C6DA]",
    chip: "bg-[#E1306C]",
  },
};

/** A letter mark, for the platforms whose logo is their name written out. */
function letter(text: string, size: number, baseline: number, fill = "#fff"): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <text
        x="12"
        y={baseline}
        textAnchor="middle"
        fontSize={size}
        fontWeight="800"
        fill={fill}
        fontFamily="inherit"
      >
        {text}
      </text>
    </svg>
  );
}

/**
 * The platform's logo. Drawn rather than imported: no icon set carries these
 * marks, so each one is built from the shapes the brand is recognised by — the
 * four-colour Google G, Trustpilot's star, TripAdvisor's owl eyes, Instagram's
 * camera — and a bold letter where the logo is the name itself.
 */
function PlatformMark({ platform }: { platform: string }): ReactNode {
  switch (platform) {
    case "google":
      // The four arcs and the bar that closes the G's counter, in Google's own
      // colours: red across the top, blue down the right into the bar, green
      // along the bottom, yellow up the left, with the notch above the bar.
      return (
        <svg viewBox="0 0 32 32" className="size-4" fill="none" aria-hidden="true">
          <path d="M6.47 10.5 A11 11 0 0 1 23.78 8.22" stroke="#EA4335" strokeWidth="4.5" />
          <path d="M27 16 A11 11 0 0 1 21.5 25.53" stroke="#4285F4" strokeWidth="4.5" />
          <path d="M21.5 25.53 A11 11 0 0 1 6.47 21.5" stroke="#34A853" strokeWidth="4.5" />
          <path d="M6.47 21.5 A11 11 0 0 1 6.47 10.5" stroke="#FBBC04" strokeWidth="4.5" />
          <path d="M17 16 H27" stroke="#4285F4" strokeWidth="4.5" />
        </svg>
      );
    case "trustpilot":
      // The rating star Trustpilot is named by.
      return (
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
          <path
            d="M12 2.5 L14.47 8.6 L21.04 9.06 L15.99 13.3 L17.58 19.69 L12 16.2 L6.42 19.69 L8.01 13.3 L2.96 9.06 L9.53 8.6 Z"
            fill="#fff"
          />
        </svg>
      );
    case "tripadvisor":
      // The owl: two eyes, dark on the brand green so they still read at 16px.
      return (
        <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
          <circle cx="7.5" cy="12" r="5" stroke="#00675B" strokeWidth="2" />
          <circle cx="16.5" cy="12" r="5" stroke="#00675B" strokeWidth="2" />
          <circle cx="7.5" cy="12" r="2" fill="#00675B" />
          <circle cx="16.5" cy="12" r="2" fill="#00675B" />
        </svg>
      );
    case "instagram":
      // The camera outline of the app icon.
      return (
        <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
          <rect x="4.5" y="4.5" width="15" height="15" rx="4.5" stroke="#fff" strokeWidth="2" />
          <circle cx="12" cy="12" r="3.6" stroke="#fff" strokeWidth="2" />
          <circle cx="16.9" cy="7.2" r="1.15" fill="#fff" />
        </svg>
      );
    case "facebook":
      return letter("f", 16, 17.4);
    case "yelp":
      return letter("Y", 15, 17);
    case "g2":
      return letter("G2", 13, 16.6);
    case "capterra":
      return letter("C", 15, 17);
    default:
      return null;
  }
}

/**
 * One review's platform tag: logo chip plus the platform's name, tinted in the
 * platform's own colour.
 *
 * `source` is the label the sync wrote against the row — it is what the tag
 * shows when the platform key is empty (a review saved before `my_reviews.
 * platform` existed) or names a platform no reader is wired up for. With
 * neither, there is no tag rather than an empty pill.
 */
export function PlatformTag({ platform, source }: { platform: string; source?: string }) {
  const key = platform.trim().toLowerCase();
  const label = reviewPlatformLabel(platform) || (source ?? "").trim();
  if (!label) return null;

  const brand = REVIEW_PLATFORM_BRANDS[key];
  const pill = brand?.pill ?? "bg-slate-100 text-slate-600 ring-slate-200";
  const mark = brand ? <PlatformMark platform={key} /> : null;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full py-0.5 pr-2 pl-1 text-[11px] font-semibold ring-1 ring-inset ${pill}`}
    >
      {brand && mark ? (
        <span
          className={`inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] ${brand.chip}`}
        >
          {mark}
        </span>
      ) : null}
      {label}
    </span>
  );
}
