import { useState } from "react";
import { cn } from "@/lib/utils";
import { Container } from "./bits";

/*
 * Odoo's opening grey band, rebuilt against the real thing.
 *
 * The geometry is Odoo's, to the number: each tile is an `<img>` at
 * `img-thumbnail rounded-1 mb-3` — 80px, 12px of padding, no border, a 0.5rem
 * radius and the violet glow — on an `od-app-entry` cell that lifts 0.25rem on
 * hover, in a row that lifts 3rem (4rem from `md`) below the pill.
 *
 * The icons are the reference's own: every Odoo app module ships
 * `static/description/icon.svg`, which is what odoo.com serves from
 * download.odoocdn.com — not a packaged icon library. They are paired here
 * with the businesses this desk gets run for, so the captions and the marker
 * writing are ours while the artwork and every measurement are the reference's.
 */

/** One tile: the reference's app icon over one of the businesses we run it for. */
type Source = { slug: string; label: string };

export const SOURCES: Source[] = [
  { slug: "accountant", label: "Beauty retail" },
  { slug: "knowledge", label: "Fashion boutiques" },
  { slug: "sign", label: "Phone shops" },
  { slug: "crm", label: "Electronics" },
  { slug: "web_studio", label: "Print & design" },
  { slug: "sale_subscription", label: "Subscriptions" },
  { slug: "ai_app", label: "Home appliances" },
  { slug: "point_of_sale", label: "Market stalls" },
  { slug: "mail", label: "Auto parts" },
  { slug: "documents", label: "Pharmacies" },
  { slug: "project", label: "Salons & spas" },
  { slug: "hr_timesheet", label: "Gyms & studios" },
  { slug: "industry_fsm", label: "Field services" },
  { slug: "planning", label: "Furniture" },
  { slug: "helpdesk", label: "Local grocers" },
  { slug: "website_sale", label: "Online stores" },
  { slug: "website", label: "Restaurants" },
  { slug: "mass_mailing", label: "Cafés & bakeries" },
  { slug: "purchase", label: "Wholesale" },
  { slug: "stock", label: "Hardware" },
  { slug: "mrp", label: "Manufacturers" },
  { slug: "sale", label: "Supermarkets" },
  { slug: "hr", label: "Agencies" },
  { slug: "spreadsheet_dashboard", label: "Logistics" },
];

/*
 * What the switch writes over the wall: the tools this desk replaces — ours,
 * not Odoo's list — each one hanging off the arrow that the reference draws for
 * that spot. The arrows are the reference's own strokes, lifted out of its
 * `apps_switched.svg` (odoo.com/openerp_website/static/src/img/apps/home/) and
 * set at the reference's own coordinates, so every head points at the tile Odoo
 * points it at; we only swap the writing. Fourteen of the sheet's seventeen
 * arrows came across — one per name below — and its lettering did not.
 *
 * Each label below therefore sits on the centre of the name the reference
 * writes beside that arrow, as a percentage of the tile row itself, so a name
 * keeps its arrow at every width. `left`/`top` are those centres.
 */
type Mark = { label: string; x: number; y: number; align?: "left" | "right" };

const MARKS: Mark[] = [
  { label: "Semrush", x: -4.39, y: -2.98 },
  { label: "Hootsuite", x: -6.23, y: 26.59 },
  /* `Service cloud` is two lines in the reference, so its arrow head sits right
     of the name: ours is one line and would run into it, hence the right edge. */
  { label: "Trustpilot", x: -4.1, y: 64.08, align: "right" },
  { label: "Klaviyo", x: 15.45, y: 46.9 },
  { label: "Photoshop", x: 111.2, y: 2.62 },
  { label: "Analytics", x: 111.1, y: 31.42 },
  { label: "Canva", x: 110.59, y: 54.23 },
  { label: "Spreadsheets", x: 107.82, y: 93.85 },
  { label: "SimilarWeb", x: 14.39, y: -7.09 },
  { label: "DocuSign", x: 37.52, y: -3.6 },
  { label: "Ahrefs", x: 90.17, y: -3.25 },
  { label: "Google Ads", x: 33.9, y: 103.84 },
  { label: "Mailchimp", x: 31.51, y: 71.8 },
  { label: "Email + Excel", x: 81.95, y: 101.0 },
];

/* The pill's content, by country. Odoo shows whichever of its events is
   nearest; ours lists the shows we run, keyed by ISO country code. */
type Event = { place: string; date: string };

const EVENTS: Record<string, Event> = {
  NG: { place: "Business Show Lagos", date: "Oct 13, 2026" },
  GH: { place: "Business Show Accra", date: "Nov 3, 2026" },
  KE: { place: "Business Show Nairobi", date: "Nov 10, 2026" },
  ZA: { place: "Business Show Cape Town", date: "Nov 24, 2026" },
  GB: { place: "Business Show London", date: "Dec 1, 2026" },
  IE: { place: "Business Show Dublin", date: "Dec 3, 2026" },
  US: { place: "Business Show New York", date: "Dec 8, 2026" },
  CA: { place: "Business Show Toronto", date: "Jan 19, 2027" },
  IN: { place: "Business Show Mumbai", date: "Jan 26, 2027" },
  AE: { place: "Business Show Dubai", date: "Feb 2, 2027" },
  SG: { place: "Business Show Singapore", date: "Feb 9, 2027" },
  AU: { place: "Business Show Sydney", date: "Feb 16, 2027" },
  DE: { place: "Business Show Berlin", date: "Mar 2, 2027" },
  FR: { place: "Business Show Paris", date: "Mar 9, 2027" },
  NL: { place: "Business Show Amsterdam", date: "Mar 11, 2027" },
  BR: { place: "Business Show São Paulo", date: "Mar 16, 2027" },
};

/* The reference card, for anywhere we have no show of our own. */
const FALLBACK: Event = { place: "Business Show Lagos", date: "Oct 13, 2026" };

/** Timezone -> country, so the pill answers to where the clock is, not the IP. */
const TZ_COUNTRY: Record<string, string> = {
  "Africa/Lagos": "NG",
  "Africa/Accra": "GH",
  "Africa/Nairobi": "KE",
  "Africa/Johannesburg": "ZA",
  "Africa/Cairo": "EG",
  "Europe/London": "GB",
  "Europe/Dublin": "IE",
  "Europe/Paris": "FR",
  "Europe/Berlin": "DE",
  "Europe/Madrid": "ES",
  "Europe/Rome": "IT",
  "Europe/Amsterdam": "NL",
  "Europe/Lisbon": "PT",
  "Europe/Warsaw": "PL",
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Phoenix": "US",
  "America/Los_Angeles": "US",
  "America/Anchorage": "US",
  "America/Toronto": "CA",
  "America/Vancouver": "CA",
  "America/Mexico_City": "MX",
  "America/Sao_Paulo": "BR",
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  "Asia/Dubai": "AE",
  "Asia/Singapore": "SG",
  "Asia/Karachi": "PK",
  "Asia/Dhaka": "BD",
  "Asia/Jakarta": "ID",
  "Asia/Manila": "PH",
  "Asia/Shanghai": "CN",
  "Asia/Tokyo": "JP",
  "Asia/Seoul": "KR",
  "Asia/Riyadh": "SA",
  "Australia/Sydney": "AU",
  "Australia/Melbourne": "AU",
  "Pacific/Auckland": "NZ",
};

/*
 * Which country the visitor is in, from the browser alone — the timezone
 * first, then the region on their language (`en-NG`). Nothing is sent
 * anywhere: it is a lookup on data the page already has.
 */
export function detectCountry(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    if (TZ_COUNTRY[zone]) return TZ_COUNTRY[zone];

    const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const tag of languages) {
      const region = /[-_]([A-Za-z]{2})$/.exec(tag ?? "");
      if (region) return region[1].toUpperCase();
    }
  } catch {
    /* older engines, or a locked-down browser: the reference card stands in */
  }
  return "NG";
}

/** "NG" -> "Nigeria", for the flag's alt text. */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * The white announcement pill — `x_wd_notification_box` on odoo.com: the flag
 * on the left, the bold event name, the date a margin away, and the register
 * link stretched over the whole card. The country is detected, so the flag,
 * the event and the date follow the visitor.
 */
function DigestPill() {
  const [country] = useState(detectCountry);
  const [flagOk, setFlagOk] = useState(true);
  const event = EVENTS[country] ?? FALLBACK;

  return (
    <div className="od-notif">
      <img
        src={
          flagOk
            ? `https://odoocdn.com/base/static/img/country_flags/${country.toLowerCase()}.png`
            : "/img/odoo/ng.png"
        }
        onError={() => setFlagOk(false)}
        width={16}
        height={16}
        alt={countryName(country)}
        className="me-[0.25rem] h-4 w-4 shrink-0 rounded-[50rem] object-cover md:ms-[0.5rem] md:me-[1rem]"
      />
      <span className="align-middle text-start font-bold">{event.place}</span>
      <div className="hidden text-nowrap text-[var(--od-body)] md:ms-[1rem] md:block">
        {event.date}
      </div>
      <a
        href="#pricing"
        className="od-stretched text-nowrap text-[var(--od-violet)] no-underline md:mx-[1rem] lg:ms-[3rem]"
      >
        Register ⟶
      </a>
    </div>
  );
}

/**
 * The wall of tiles — `x_wd_apps_row` / `x_wd_app_entry`: an `<img
 * class="img-thumbnail rounded-1 mb-3">` over a truncated caption. The
 * reference's arrows and our own names sit over it, both on one layer that the
 * switch turns on.
 */
function AppWall({ without }: { without: boolean }) {
  return (
    <div className="relative flow-root">
      <div className="od-apps-row">
        {/* Every tile is a door into the sign-up: the wall is the pitch, and
            the switch above it is what a visitor reaches for next. */}
        {SOURCES.map((source) => (
          <a key={source.label} href="/sign-up" className="od-app-entry">
            <figure>
              <img
                width={80}
                className="od-app-icon"
                src={`/icons/apps/${source.slug}.svg`}
                alt={`${source.label} icon`}
                loading="lazy"
              />
              <figcaption className="od-app-caption">{source.label}</figcaption>
            </figure>
          </a>
        ))}
      </div>

      {/*
        * The drawing, on its own layer over the row's exact box: the
        * reference's sheet of arrows, then our names on the spots its own
        * names hold.
        */}
      <div className={cn("od-scrawls", without && "is-on")} aria-hidden={!without}>
        <img
          className="od-arrows"
          src="/img/odoo/apps_switched_arrows.svg"
          width={1250}
          height={729}
          alt=""
          loading="lazy"
        />
        {MARKS.map((mark) => (
          <span
            key={mark.label}
            className={cn("od-scrawl", mark.align && `od-scrawl-${mark.align}`)}
            style={{ left: `${mark.x}%`, top: `${mark.y}%` }}
          >
            {mark.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Odoo's "Imagine without odoo" switch — a plain Bootstrap form-switch. */
function WithoutSwitch({
  on,
  onChange,
  id,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  id: string;
}) {
  return (
    <div className="od-corner">
      <input
        type="checkbox"
        role="switch"
        id={id}
        className="od-switch"
        checked={on}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label className="od-switch-label" htmlFor={id}>
        Imagine without BIZLIT
      </label>
    </div>
  );
}

export default function SourcesBand() {
  const [without, setWithout] = useState(false);

  return (
    <section
      id="sources"
      className="relative overflow-x-clip bg-[var(--od-band)] px-0 pt-[1.5rem] pb-[3rem] md:pt-[4rem] lg:pb-[4rem]"
    >
      {/* `o_illustration_doodle_03`: the white wave across the top. */}
      <div className="od-shape od-shape-03" aria-hidden />

      <Container className="relative z-[1]">
        {/* `<div class="row justify-content-center"><div class="col-xl-9
            col-xxl-8 text-center">` — the pill and the wall live there. */}
        <div className="mx-[-1rem] flex justify-center">
          <div className="w-full px-[1rem] text-center min-[1200px]:w-3/4 min-[1400px]:w-2/3">
            <DigestPill />
            <AppWall without={without} />
          </div>
        </div>

        {/* `col-lg-6 pt40 text-start d-none d-lg-block` / `col-lg-6 pt40 text-end`,
            the switch moved out to `xl`: its drawing needs the xl gutters. */}
        <div className="flex flex-wrap items-center">
          <div className="hidden w-full pt-[40px] text-start min-[1200px]:block min-[1200px]:w-1/2">
            <WithoutSwitch on={without} onChange={setWithout} id="x_wd_apps_switcher" />
          </div>
          <div className="w-full pt-[40px] text-end min-[1200px]:w-1/2">
            <a href="#screens" className="text-[var(--od-violet)] no-underline">
              View all Apps
              <img
                src="/img/odoo/secondary_arrow_sm_03.svg"
                width={40}
                alt=""
                loading="lazy"
                className="ms-[0.5rem] me-[1rem] inline-block align-top"
              />
            </a>
          </div>
        </div>
      </Container>
    </section>
  );
}
