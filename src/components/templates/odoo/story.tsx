import {
  BadgeCheck,
  BellRing,
  ChevronDown,
  ClipboardList,
  FileText,
  ImagePlus,
  Mail,
  MessageSquareQuote,
  Radar,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/primitives";
import { Stars } from "@/components/charts";
import { sampleWorkspace } from "@/data/sample";
import { compact, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Band, Container, Doodle, Mark, Underline, odBtn, odBtnLight } from "./bits";

/*
 * The middle of the odoo.com landing page, in order: what the product does, the
 * "level up" card row, the native-AI band and the "done right" leaf that closes
 * with the plan.
 *
 * Every band carries odoo.com's own padding (`pb-5 pb-lg-6`, `py-5 py-lg-7`,
 * `pb-5 pb-lg-10`, `pt-7`), its headings are display-2 with `mb-6`, and each
 * card is Odoo's white `s_wd_features_item`: 2rem of padding, 0.75rem radius,
 * a 1px #E9E3F7 border and a 70px leaf-shaped icon tile in the top corner.
 */

/* --------------------------------------------------------------- features */

/*
 * Odoo puts a quotation above the company artwork in the card under the
 * sources wall; we keep the card, the two-column split and the mark on the
 * right, and put the product's own list where the quotation was — one icon
 * tile per thing the desk does, in the order the workspace does them, beside
 * the rail that names the desk and the numbers it works on.
 */
type Tone = "violet" | "orchid" | "indigo" | "fuchsia" | "gold";

/** The tile a feature wears: the page's own violets at 12% behind its icon. */
const FEATURE_TONES: Record<Tone, string> = {
  violet: "bg-[var(--od-tone-violet-bg)] text-[var(--od-tone-violet-fg)]",
  orchid: "bg-[var(--od-tone-orchid-bg)] text-[var(--od-tone-orchid-fg)]",
  indigo: "bg-[var(--od-tone-indigo-bg)] text-[var(--od-tone-indigo-fg)]",
  gold: "bg-[var(--od-tone-gold-bg)] text-[var(--od-tone-gold-fg)]",
  fuchsia: "bg-[var(--od-tone-fuchsia-bg)] text-[var(--od-tone-fuchsia-fg)]",
};

const FEATURES: { icon: ReactNode; label: string; note: string; tone: Tone }[] = [
  {
    icon: <Radar size={17} />,
    label: "Competitor watch",
    note: "Prices, stock and live campaigns, captured on the cadence you set",
    tone: "violet",
  },
  {
    icon: <Search size={17} />,
    label: "Search & AI answers",
    note: "SEO score, keyword positions and GEO visibility, rescored weekly",
    tone: "orchid",
  },
  {
    icon: <ClipboardList size={17} />,
    label: "One buy list",
    note: "Supplier and marketplace prices folded into a single sheet",
    tone: "gold",
  },
  {
    icon: <Mail size={17} />,
    label: "Client emails",
    note: "New stock, deals, check-ins and the weekly report, sent from your own mailbox",
    tone: "indigo",
  },
  {
    icon: <MessageSquareQuote size={17} />,
    label: "Review scans",
    note: "What needs an answer is flagged with the reply already drafted",
    tone: "fuchsia",
  },
  {
    icon: <ImagePlus size={17} />,
    label: "Briefs to banners",
    note: "Ad briefs turned into banner designs you download and post",
    tone: "orchid",
  },
  {
    icon: <Share2 size={17} />,
    label: "Social tracking",
    note: "Competitor profiles watched for followers, posting cadence and engagement",
    tone: "violet",
  },
  {
    icon: <BellRing size={17} />,
    label: "One notifications desk",
    note: "Everything that changed, ranked in the order it matters",
    tone: "indigo",
  },
];

export function FeaturesBand() {
  return (
    <Band className="pb-[3rem] lg:pb-[4rem]">
      <div className="overflow-hidden rounded-[0.75rem] border border-[var(--od-border)] bg-[var(--od-surface)]">
        {/* every job the desk runs, under the mark that runs it */}
        <div className="p-[1.5rem] md:p-[2.5rem] xl:p-[3rem]">
          <div className="flex items-start justify-between gap-[1.5rem] md:gap-[3rem]">
            <div className="min-w-0">
              <p className="flex items-center gap-[0.625rem] text-[0.75rem] font-semibold tracking-[0.16em] text-[var(--od-violet)] uppercase">
                <span aria-hidden className="h-[1px] w-[1.75rem] bg-[rgba(109,40,217,0.35)]" />
                One desk, eight jobs
              </p>

              <h3 className="od-h4 mt-[1rem]">
                Everything the desk does <Mark>for you</Mark>
              </h3>

              <p className="mt-[0.75rem] max-w-[42rem] text-[1rem] leading-relaxed text-[var(--od-body)]">
                Every source we watch lands in one place and is ranked by what changed, on the
                cadence you set.
              </p>
            </div>

            <span className="inline-flex h-[4.5rem] w-[4.5rem] shrink-0 items-center justify-center rounded-[1.2rem] bg-[var(--od-surface)] shadow-[0_0.5rem_1.25rem_rgba(109,40,217,0.10)] ring-1 ring-[rgba(109,40,217,0.16)] xl:h-[5.5rem] xl:w-[5.5rem] xl:rounded-[1.4rem]">
              <img
                src="/logo.png"
                width={72}
                height={72}
                alt="BIZLIT"
                loading="lazy"
                className="h-[3.5rem] w-[3.5rem] xl:h-[4.25rem] xl:w-[4.25rem]"
              />
            </span>
          </div>

          <ul className="mt-[2rem] grid gap-x-[2.5rem] gap-y-[1.5rem] sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <li key={feature.label} className="flex items-start gap-[0.875rem]">
                <span
                  aria-hidden
                  className={cn(
                    "flex h-[2.25rem] w-[2.25rem] shrink-0 items-center justify-center rounded-[0.7rem]",
                    FEATURE_TONES[feature.tone],
                  )}
                >
                  {feature.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-[0.9375rem] leading-tight font-semibold text-[var(--od-ink)]">
                    {feature.label}
                  </span>
                  <span className="mt-[0.3rem] block text-[0.875rem] leading-relaxed text-[var(--od-body)]">
                    {feature.note}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

      </div>
    </Band>
  );
}

/* --------------------------------------------------------------- level up */

/*
 * The screens are real captures of the workspace (the same layouts the
 * screens band renders, shot at two widths) — odoo.com puts a product video
 * here, we put the product itself.
 */
const SHOTS = {
  clients: "/img/app/clients.png",
  competition: "/img/app/competition.png",
  business: "/img/app/business.png",
  detail: "/img/app/detail.png",
};

/** The four cells of Odoo's 12 × 16 collage, placed exactly as it places them. */
const CELLS: { src: string; area: string; alt: string; className?: string }[] = [
  {
    src: SHOTS.clients,
    area: "3 / 3 / 15 / 11",
    alt: "The BIZLIT clients screen with the customer list",
    className: "object-center",
  },
  {
    src: SHOTS.competition,
    area: "9 / 1 / 18 / 9",
    alt: "The BIZLIT competition screen with a rival's traffic sources and live campaigns",
    className: "object-left",
  },
  {
    src: SHOTS.business,
    area: "5 / 9 / 17 / 13",
    alt: "The BIZLIT business screen with SEO and GEO scores and tracked keywords",
  },
  {
    src: SHOTS.detail,
    area: "1 / 1 / 9 / 4",
    alt: "Traffic sources for a tracked competitor",
  },
];

/*
 * What the screens above are actually for, one card each — and every card is
 * another screen of the product, drawn from the sample workspace's own rows so
 * a mock cannot drift from what the app really shows: the outbox with the
 * emails that went out, the review the scan flagged with the draft the composer
 * opens with, the two ad briefs and the design they produced, and the profiles
 * the daily scan watches.
 */
const DEMO = sampleWorkspace();
const OUTBOX = DEMO.sentMessages.slice(0, 3);
const FLAGGED_REVIEW =
  DEMO.latestReviewScan.items.find((review) => review.isFlagged) ?? DEMO.latestReviewScan.items[0];
const TRACKED_PROFILES = DEMO.socialMonitorTargets.map((target) => {
  const competitor = DEMO.competitors.find((c) => c.id === target.competitorId);
  const channel = competitor?.social.find(
    (s) => s.handle.toLowerCase() === target.handle.toLowerCase(),
  );
  return { target, competitor, channel };
});

/** The strip every workspace card wears: its icon, its title, one chip. */
function ScreenHead({
  icon,
  title,
  chip,
  tone = "neutral",
}: {
  icon: ReactNode;
  title: string;
  chip: string;
  tone?: "neutral" | "good" | "warn" | "bad" | "info" | "brand";
}) {
  return (
    <div className="flex items-center gap-[0.375rem] border-b border-slate-100 pb-[0.375rem]">
      <span className="text-slate-400">{icon}</span>
      <span className="text-[0.6875rem] font-semibold text-slate-900">{title}</span>
      <Badge tone={tone} className="ms-auto">
        {chip}
      </Badge>
    </div>
  );
}

/** One row of a workspace list, at the size these cards can hold. */
const MOCK_ROW =
  "flex items-center gap-[0.5rem] rounded-[0.5rem] bg-slate-50 px-[0.5rem] py-[0.25rem] leading-tight";

/*
 * `area` is the cell, `shift` nudges it over its neighbour, and `z` decides
 * who lies on top where the two mats meet — the same tuck Odoo's own cells get
 * from their overlapping spans. Each cell is only as tall as the screen drawn
 * in it plus the strip the overlaps need, so no card carries empty mat, and
 * every nudge stays inside that strip rather than over another card's rows.
 */
const PANELS: { title: string; area: string; z: number; shift?: string; body: ReactNode }[] = [
  {
    title: "Emailing",
    area: "7 / 7 / 14 / 13",
    z: 9,
    shift: "-ml-[3rem]",
    body: (
      <div className="text-[0.6875rem]">
        <ScreenHead icon={<Send size={13} />} title="Client emails" chip="Weekly cadence" />

        <ul className="mt-[0.5rem] space-y-[0.375rem]">
          {OUTBOX.map((message) => (
            <li key={message.id} className={MOCK_ROW}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.6875rem] font-medium text-slate-900">
                  {message.subject}
                </span>
                <span className="block truncate text-[0.625rem] text-slate-500">
                  {message.clientName} · {relativeTime(message.sentAt)}
                </span>
              </span>
              <Badge
                tone={
                  message.status === "bounced"
                    ? "bad"
                    : message.status === "delivered"
                      ? "neutral"
                      : "good"
                }
              >
                {message.status}
              </Badge>
            </li>
          ))}
        </ul>

        <p className="mt-[0.5rem] text-[0.625rem] text-slate-500">
          8 sent this week · 6 opened or clicked
        </p>
      </div>
    ),
  },
  {
    title: "Review reading & replying",
    area: "7 / 1 / 14 / 7",
    z: 8,
    shift: "ml-[2.5rem]",
    body: (
      <div className="text-[0.6875rem]">
        <ScreenHead
          icon={<MessageSquareQuote size={13} />}
          title="Review scan"
          chip={`${DEMO.latestReviewScan.flagged} flagged`}
          tone="bad"
        />

        <div className="mt-[0.5rem] rounded-[0.5rem] border border-slate-200 p-[0.5rem]">
          <div className="flex items-center gap-[0.375rem]">
            <Stars rating={FLAGGED_REVIEW.rating} size={11} />
            <span className="text-[0.6875rem] font-medium text-slate-900">
              {FLAGGED_REVIEW.author}
            </span>
            <span className="truncate text-[0.625rem] text-slate-500">
              {FLAGGED_REVIEW.source}
            </span>
          </div>
          <p className="mt-[0.25rem] text-[0.625rem] leading-snug text-slate-600">
            {FLAGGED_REVIEW.text}
          </p>
        </div>

        <div className="mt-[0.5rem] rounded-[0.5rem] border border-dashed border-slate-300 bg-slate-50 p-[0.5rem]">
          <p className="text-[0.5625rem] tracking-wide text-slate-500 uppercase">Reply draft</p>
          <p className="mt-[0.125rem] text-[0.625rem] leading-snug text-slate-700">
            {FLAGGED_REVIEW.action}
          </p>
        </div>

        <p className="mt-[0.5rem] text-[0.625rem] text-slate-500">
          Drafts wait for your yes before anything sends
        </p>
      </div>
    ),
  },
  {
    title: "Ads graphics banners",
    area: "1 / 1 / 8 / 7",
    z: 2,
    body: (
      <div className="text-[0.6875rem]">
        <ScreenHead
          icon={<Sparkles size={13} />}
          title="Promotions"
          chip={`${DEMO.deliveredAds.length} delivered`}
          tone="good"
        />

        <div className="mt-[0.5rem] flex items-end gap-[0.5rem]">
          {DEMO.promotionBriefs.map((brief) => (
            <figure key={brief.id} className="min-w-0 flex-1">
              <div
                style={{
                  background: `linear-gradient(135deg, ${brief.accentColor} 0%, ${brief.accentColor}cc 100%)`,
                }}
                className={`flex flex-col justify-between rounded-[0.5rem] p-[0.5rem] text-white ${
                  brief.template === "story" ? "h-[5.25rem]" : "h-[3.75rem]"
                }`}
              >
                <span className="truncate text-[0.5625rem] tracking-wide uppercase opacity-90">
                  {brief.headline}
                </span>
                <span className="text-[0.8125rem] leading-tight font-bold">
                  {brief.discountKind === "percent"
                    ? `${brief.discountValue}% off`
                    : `$${brief.discountValue} off`}
                </span>
                <span className="text-[0.5625rem] opacity-90">
                  {brief.couponCode ? `Code ${brief.couponCode}` : brief.dealText}
                </span>
              </div>
              <figcaption className="mt-[0.375rem] flex items-center gap-[0.375rem]">
                <Badge tone={brief.status === "delivered" ? "good" : "warn"}>
                  {brief.status === "delivered" ? "delivered" : "in design"}
                </Badge>
                <span className="truncate text-[0.625rem] text-slate-500">
                  {brief.template === "story" ? "1080 × 1920" : "1080 × 1080"}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>

        <p className="mt-[0.5rem] text-[0.625rem] text-slate-500">
          Prices and codes pulled from your own catalogue
        </p>
      </div>
    ),
  },
  {
    title: "Social media tracking profiles",
    area: "1 / 7 / 8 / 13",
    z: 4,
    shift: "-ml-[3rem] -mt-[2.5rem]",
    body: (
      <div className="text-[0.6875rem]">
        <ScreenHead icon={<Share2 size={13} />} title="Tracked profiles" chip="Daily scan" />

        <ul className="mt-[0.5rem] space-y-[0.375rem]">
          {TRACKED_PROFILES.map(({ target, competitor, channel }) => (
            <li key={target.handle} className={MOCK_ROW}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.6875rem] font-medium text-slate-900">
                  {target.handle}
                </span>
                <span className="block truncate text-[0.625rem] text-slate-500">
                  {competitor?.name}
                  {channel
                    ? ` · ${compact(channel.followers)} followers · ${channel.postsPerWeek}/wk`
                    : ""}
                </span>
              </span>
              {channel ? (
                <span className="shrink-0 rounded-full bg-[rgba(168,85,247,0.14)] px-[0.375rem] py-[0.0625rem] text-[0.625rem] font-semibold text-[var(--od-accent)]">
                  {channel.engagementRate}% eng
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        <p className="mt-[0.5rem] text-[0.625rem] text-slate-500">
          Posts, follows and engagement collected on every scan
        </p>

        <p className="mt-[0.25rem] text-[0.625rem] text-slate-500">
          {TRACKED_PROFILES.length} rival profiles · next scan 06:00
        </p>
      </div>
    ),
  },
];

export function LevelUpBand() {
  return (
    <section className="od-round-bottom relative bg-[var(--od-band)] py-[3rem] lg:py-[6rem]">
      {/* `o_illustration_doodle_02`, the orange doodle behind this band. */}
      <div className="od-shape od-shape-02" aria-hidden />

      <Container className="relative z-[1]">
        <h2 className="od-d2 mb-[4rem] lg:text-center">
          Level up your quality of <Mark tone="yellow-03">work</Mark>
        </h2>

        {/* Odoo's `o_grid_mode` collage: 12 columns, 50px rows, 10px of
            padding on every cell, and the screens covering their cell. */}
        <div className="mx-[-10px] hidden lg:grid lg:grid-cols-12 lg:auto-rows-[50px]">
          {CELLS.map((cell) => (
            <figure key={cell.src} className="p-[10px]" style={{ gridArea: cell.area }}>
              <img
                src={cell.src}
                alt={cell.alt}
                loading="lazy"
                className={`od-shot ${cell.className ?? "object-left-top"}`}
              />
            </figure>
          ))}
        </div>

        {/* Below `lg` Odoo swaps the collage for one full-width shot. The
            wrapper carries `lg:hidden` rather than the image, because
            `.od-shot` sets its own `display` and would out-rank the utility. */}
        <div className="lg:hidden">
          <img
            src={SHOTS.competition}
            alt="The BIZLIT competition screen with a rival's traffic sources and live campaigns"
            loading="lazy"
            className="od-shot h-auto"
          />
        </div>

        {/* Under the screenshots, the four jobs the product does are the same
            collage again: Odoo's 12 columns and 50px rows, a white mat on every
            cell, and cells whose spans cross each other the way its own four
            do — no captions, just the screens. */}
        <div className="mx-[-10px] hidden lg:grid lg:grid-cols-12 lg:auto-rows-[50px]">
          {PANELS.map((panel) => (
            <figure
              key={panel.title}
              className={cn(
                "relative p-[10px] transition-transform duration-200 ease-out hover:z-[20] hover:-translate-y-[0.25rem]",
                panel.shift,
              )}
              style={{ gridArea: panel.area, zIndex: panel.z }}
            >
              <div className="od-shot-frame od-panel-shot h-full">{panel.body}</div>
            </figure>
          ))}
        </div>

        {/* Below `lg` the overlap would be unreadable, so the same four stack. */}
        <div className="od-mobile-panels mt-[2rem] grid gap-[1.5rem] sm:grid-cols-2 lg:hidden">
          {PANELS.map((panel) => (
            <div key={panel.title} className="od-shot-frame min-h-0">
              {panel.body}
            </div>
          ))}
        </div>

        {/* `col-lg-6 col-xl-5 pt-6 text-lg-center`: the lead line, a doodled
            arrow, then the play-styled link into the workspace screens. */}
        <div className="flex justify-center">
          <div className="pt-[4rem] lg:w-5/12 lg:text-center">
            <p className="od-lead mb-[1.5rem]">
              <strong className="font-medium">Everything on one desk,</strong> ranked as it moves —
              competitor prices, stock, campaigns and search positions, captured on the cadence you
              set and ready before your first coffee.
            </p>

            <Doodle
              src="/img/odoo/arrow_doodle_3.svg"
              width={44}
              className="mx-auto mb-[1.5rem] rotate-[40deg]"
            />

            <a
              href="#screens"
              className="od-doodle mx-auto rotate-[350deg] text-[2rem] no-underline"
            >
              See it on your own data
            </a>
          </div>
        </div>
      </Container>
    </section>
  );
}

/* --------------------------------------------------------------- native AI */

const AI_ITEMS = [
  {
    title: "Reply drafts",
    body: "Every review that needs an answer arrives with a draft you edit and send yourself.",
  },
  {
    title: "Original ad angles",
    body: "Built from a competitor's best-performing post — an angle for your brand, never their artwork.",
  },
  {
    title: "Keyword themes",
    body: "Intent themes that label the suggestions you already had. Nothing invented gets through.",
  },
];

export function AiBand() {
  return (
    <section className="pt-[6rem] pb-[3rem] lg:text-center">
      <Container>
        <h2 className="od-d2 mb-[4rem]">
          AI that reads the <Mark tone="coral">noise</Mark> for you
        </h2>

        <div className="grid gap-x-[2rem] md:grid-cols-3 lg:text-left">
          {AI_ITEMS.map((item) => (
            <div key={item.title} className="od-card">
              <h4 className="od-card-title od-h4">{item.title}</h4>
              <p className="text-[1rem] leading-relaxed text-[var(--od-body)]">{item.body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ------------------------------------------------------------- done right */

const PRINCIPLES: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: "One workspace, not six tabs",
    body: "Competitors, suppliers, search, local, reputation, customers and the ad pipeline share one desk with one sign-in.",
    icon: <BadgeCheck />,
  },
  {
    title: "Your rows, nobody else's",
    body: "Every read and write is tenant-scoped behind row level security. Nothing is shared between desks, ever.",
    icon: <ShieldCheck />,
  },
  {
    title: "Drafts, never autopilot",
    body: "Reply drafts wait in the composer and ad angles create briefs. Nothing is sent, posted or created without you.",
    icon: <FileText />,
  },
  {
    title: "Costs you can actually see",
    body: "Each provider call is logged with its units and dollars, and a run refuses itself before it breaks the monthly cap.",
    icon: <Wallet />,
  },
];

const PLAN_FEATURES = [
  "Competitor and traffic monitoring",
  "SEO and AI-answer (GEO) scores, weekly",
  "One ranked notifications desk",
  "Client messaging from your own mailbox",
  "Review scans with reply flags",
  "A buy list built from real price moves",
  "No pipelines or setup required",
];

export function DoneRightBand() {
  return (
    <Band leaf className="py-[3rem] lg:py-[6rem]">
      <h2 className="od-d2 mb-[4rem] lg:text-center">
        Competitor watch
        <br />
        done <Underline>right</Underline>.
      </h2>

      <div className="grid gap-x-[2rem] md:grid-cols-2">
        {PRINCIPLES.map((item) => (
          <div key={item.title} className="od-card">
            <span className="od-card-icon" style={{ color: "var(--od-orchid)" }} aria-hidden>
              {item.icon}
            </span>
            <h4 className="od-card-title od-h4">{item.title}</h4>
            <p className="text-[1rem] leading-relaxed text-[var(--od-body)]">{item.body}</p>
          </div>
        ))}
      </div>

      {/* Odoo's editions block, holding our single plan. */}
      <div
        id="pricing"
        className="mt-[4rem] rounded-[0.75rem] border border-[var(--od-border)] bg-[var(--od-surface)] p-[2rem] md:p-[4rem]"
      >
        <div className="grid gap-[2rem] md:grid-cols-[1fr_1.25fr] md:gap-[4rem]">
          <div>
            <h3 className="od-h4 mb-[1rem]">One plan, every source</h3>
            <p className="text-[var(--od-body)]">For independent retailers and small buying teams.</p>
            <p className="mt-[1.5rem] text-[1.5rem] font-semibold text-[var(--od-ink)]">
              $39{" "}
              <span className="text-[1rem] font-normal text-[var(--od-muted)]">
                per user / month
              </span>
            </p>
            <div className="mt-[1.5rem] flex flex-wrap gap-[1rem]">
              <a href="/sign-up" className={odBtn}>
                Start free
              </a>
              <a href="/sign-in" className={odBtnLight}>
                Sign in
              </a>
            </div>
            <p className="mt-[1rem] text-[0.875rem] text-[var(--od-muted)]">
              No credit card to start · Cancel whenever you like
            </p>
          </div>

          <ul className="grid gap-[0.75rem] self-center sm:grid-cols-2">
            {PLAN_FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-[0.75rem]">
                <BadgeCheck
                  size={18}
                  className="mt-[0.25rem] shrink-0"
                  style={{ color: "var(--od-orchid)" }}
                  aria-hidden
                />
                <span className="text-[1rem] text-[var(--od-ink)]">{feature}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Band>
  );
}

/* -------------------------------------------------------------------- faq */

export type FaqItem = { q: string; a: string };

export function FaqBand({ items }: { items: FaqItem[] }) {
  return (
    <section id="faq" className="pt-[6rem] pb-[3rem]">
      <Container>
        <h2 className="od-d2 mb-[4rem] lg:text-center">Before you sign up.</h2>

        <div className="mx-auto mt-[1.5rem] max-w-3xl">
          {items.map((item) => (
            <details key={item.q} className="group border-t border-[var(--od-border)] py-[1rem]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-[1.5rem] text-[1.25rem] font-semibold text-[var(--od-ink)] marker:hidden">
                {item.q}
                <ChevronDown
                  size={20}
                  className="shrink-0 text-[var(--od-muted)] transition group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="mt-[0.75rem] max-w-2xl text-[1rem] leading-relaxed text-[var(--od-body)]">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
