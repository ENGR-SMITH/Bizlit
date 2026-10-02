import { useState } from "react";
import type { ReactNode } from "react";
import {
  BarChart3,
  Bell,
  Binoculars,
  Mail,
  Sparkles,
  Users,
} from "lucide-react";
import BlurredOrb from "@/components/templates/axis/blurred-orb";
import Companies from "@/components/templates/axis/companies";
import Faq, { type FaqItem } from "@/components/templates/axis/faq";
import Feature from "@/components/templates/axis/feature";
import Footer from "@/components/templates/axis/footer";
import Hero from "@/components/templates/axis/hero";
import Navbar, { type NavLink } from "@/components/templates/axis/navbar";
import Pricing from "@/components/templates/axis/pricing";
import Stats from "@/components/templates/axis/stats";
import Testimonials from "@/components/templates/axis/testimonials";
import Tools from "@/components/templates/axis/tools";
import { Badge, Tabs, Td, Th } from "@/components/primitives";
import { BarList, DeltaPill, ProgressRing } from "@/components/charts";
import { sampleWorkspace } from "@/data/sample";
import { compact } from "@/lib/format";

/* ---------------------------------------------------------------- content */

const NAV: NavLink[] = [
  { id: "sources", label: "Sources" },
  { id: "screens", label: "Screens" },
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "FAQ" },
];

const FEED_ROWS = [
  { product: "Velvet Matte Lip Kit", note: "GlowMart Beauty", chip: "−16.4%", tone: "brand" as const },
  { product: "Hydra Glow Serum 50ml", note: "GlowMart Beauty", chip: "Restocked", tone: "good" as const },
  { product: "Aurora X5 128GB", note: "TecWave Electronics", chip: "−10.5%", tone: "brand" as const },
];

const FAQ: FaqItem[] = [
  {
    q: "Which competitors can it watch?",
    a: "Any rival with a website — a shopfront, a trade site or a brand catalogue. You add each one during setup and choose how often it is checked.",
  },
  {
    q: "How often does it scan?",
    a: "Per source: daily, weekly or monthly. Daily feeds catch price and stock moves fastest, while weekly and monthly sources are scanned in one batch and summarised.",
  },
  {
    q: "Do my customers see competitor intelligence?",
    a: "No. Competitor alerts stay internal to your desk. You pick what goes out to customers from new stock, deals, check-ins, review updates and the weekly report.",
  },
  {
    q: "Does it send the emails for me?",
    a: "Yes. Alerts go out from the mailbox you configure, with your own signature, and every send is logged so you can see what each customer received.",
  },
  {
    q: "I sell on a marketplace, not my own site.",
    a: "Tell the wizard where you sell. Your scores, traffic and competitor comparisons are tracked against whichever surface you actually trade on.",
  },
];

/** Filled-in sample workspace, so the previews show realistic numbers. */
const DEMO = sampleWorkspace();

/* The workspace screens, previewed with the same components the app renders. */
type ScreenId = "competition" | "business" | "clients";

const SCREENS: {
  id: ScreenId;
  label: string;
  icon: ReactNode;
  url: string;
  /**
   * Optional real screenshot. Drop a PNG at `public/screenshots/<id>.png` and
   * set this to "/screenshots/<id>.png" to use it instead of the live preview.
   */
  src?: string;
  render: () => ReactNode;
}[] = [
  {
    id: "competition",
    label: "Competition",
    icon: <Binoculars size={13} />,
    url: "bizlit.app/#/competition",
    render: () => <CompetitionScreen />,
  },
  {
    id: "business",
    label: "My Business",
    icon: <BarChart3 size={13} />,
    url: "bizlit.app/#/business",
    render: () => <BusinessScreen />,
  },
  {
    id: "clients",
    label: "Clients",
    icon: <Users size={13} />,
    url: "bizlit.app/#/clients",
    render: () => <ClientsScreen />,
  },
];

/* ------------------------------------------------------------------ page */

export function LandingPage() {
  const [screen, setScreen] = useState<ScreenId>("competition");
  const active = SCREENS.find((s) => s.id === screen) ?? SCREENS[0];

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="theme-axis relative w-full overflow-hidden bg-background pb-14 text-foreground">
      <Navbar links={NAV} />

      <BlurredOrb
        className="pointer-events-none absolute top-0 left-0 h-[45rem] w-[45rem] -translate-x-1/2 -translate-y-1/2 opacity-30 blur-[7.5rem] lg:h-[65rem] lg:w-[65rem]"
        style={{
          background:
            "radial-gradient(circle at center, var(--color-hero-start) 0%, var(--color-hero-mid) 100%, var(--color-hero-end) 100%)",
        }}
      />

      <div className="relative mx-auto flex w-full flex-col gap-24 px-4 pt-32 lg:my-28 lg:gap-44">
        <div className="flex flex-col gap-24 lg:gap-12">
          <Hero preview={<HeroPreview />} />

          <div id="sources">
            <Companies />
          </div>
        </div>

        <Feature />

        {/* --------------------------------------------------------- screens */}
        <section id="screens" className="mx-auto w-full max-w-6xl">
          <div className="text-center">
            <h2 className="text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
              Every screen, before you sign up.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground">
              The real workspace layouts, shown with sample data. Pick a screen and look around.
            </p>
          </div>

          <div className="mt-8">
            <Tabs
              value={screen}
              onChange={setScreen}
              options={SCREENS.map((s) => ({ value: s.id, label: s.label, icon: s.icon }))}
            />
          </div>

          <div className="mt-5">
            <WindowFrame url={active.url} badge={<Badge tone="neutral">sample data</Badge>}>
              {active.src ? (
                <img
                  src={active.src}
                  alt={`${active.label} screen in the BIZLIT workspace`}
                  className="w-full"
                />
              ) : (
                active.render()
              )}
            </WindowFrame>
          </div>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            Screens shown with sample data. Your own workspace fills in as soon as your first scan
            completes.
          </p>
        </section>

        <Tools />
        <Stats />
        <Testimonials />

        <section id="pricing">
          <Pricing />
        </section>

        <Faq items={FAQ} />

        <Footer links={NAV} onJump={jump} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ sub-views */

/** A miniature of the real dashboard, built from the app's own primitives. */
function HeroPreview() {
  return (
    <div className="mw-rise-slow relative">
      <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-tr from-primary/20 via-background to-secondary/25 blur-2xl" />

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl shadow-foreground/5">
        {/* window chrome */}
        <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          <span className="ml-2 min-w-0 flex-1 truncate rounded-md bg-background px-2.5 py-1 text-[10px] text-muted-foreground ring-1 ring-border">
            bizlit.app/#/competition
          </span>
          <Badge tone="good">live</Badge>
        </div>

        <div className="flex">
          {/* rail */}
          <div className="hidden w-14 shrink-0 flex-col items-center gap-2.5 bg-slate-900 py-4 sm:flex">
            <img
              src="/logo.png"
              alt=""
              className="h-8 w-8 shrink-0 rounded-lg object-cover"
            />
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <Binoculars size={15} />
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-400">
              <Mail size={15} />
            </span>
            <span className="mt-auto flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-400">
              <Bell size={15} />
            </span>
          </div>

          {/* body */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-foreground">
                  Competition watch
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  What changed since yesterday
                </p>
              </div>
              <Badge tone="brand">4 changes</Badge>
            </div>

            <ul className="divide-y divide-border">
              {FEED_ROWS.map((row) => (
                <li key={row.product} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {row.product}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {row.note}
                    </span>
                  </span>
                  <Badge tone={row.tone}>{row.chip}</Badge>
                </li>
              ))}
            </ul>

            <div className="grid grid-cols-3 divide-x divide-border border-t border-border bg-muted/40">
              {[
                { label: "Rival traffic", value: "412k" },
                { label: "Your SEO", value: "74" },
                { label: "Rank", value: "#6" },
              ].map((cell) => (
                <div key={cell.label} className="px-3 py-2.5">
                  <p className="truncate text-[9px] tracking-wide text-muted-foreground uppercase">
                    {cell.label}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-foreground">{cell.value}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-[10px] text-muted-foreground">
              <span>Next scan in 3 hours</span>
              <span className="flex items-center gap-1 font-medium text-primary">
                <Sparkles size={11} /> 4 need a decision
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** App window chrome used by the screen gallery. */
function WindowFrame({
  url,
  badge,
  children,
}: {
  url: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl shadow-foreground/5">
      <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
        <span className="ml-2 min-w-0 flex-1 truncate rounded-md bg-background px-2.5 py-1 text-[10px] text-muted-foreground ring-1 ring-border">
          {url}
        </span>
        {badge}
      </div>
      {/*
       * The gallery shows the product itself, so the screenshot is pinned to the
       * app's own light palette and stays readable in either landing theme.
       */}
      <div className="bg-white text-slate-900">{children}</div>
    </div>
  );
}

function MiniStat({ label, value, delta }: { label: string; value: ReactNode; delta?: number }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="text-[10px] tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-xl font-semibold text-slate-900">
        {value}
        {delta !== undefined ? <DeltaPill value={delta} /> : null}
      </p>
    </div>
  );
}

function RingTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
      <ProgressRing value={value} size={46} stroke={6} color={color} />
      <div className="min-w-0">
        <p className="text-[10px] tracking-wide text-slate-500 uppercase">{label}</p>
        <p className="text-lg font-semibold text-slate-900">{value}/100</p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- screen mocks */

function CompetitionScreen() {
  const competitor = DEMO.competitors[0];

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold text-slate-900">Watching</span>
        {DEMO.competitors.map((c) => (
          <span
            key={c.id}
            className={`rounded-full px-3 py-1 text-[11px] font-medium ring-1 ${
              c.id === competitor.id
                ? "bg-indigo-600 text-white ring-indigo-600"
                : "bg-white text-slate-600 ring-slate-300"
            }`}
          >
            {c.name}
          </span>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat
          label="Their traffic"
          value={compact(competitor.monthlyVisits)}
          delta={competitor.visitsChange}
        />
        <MiniStat label="SEO score" value={competitor.seoScore} />
        <MiniStat label="GEO score" value={competitor.geoScore} />
        <MiniStat label="Rating" value={competitor.rating.toFixed(1)} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-[10px] tracking-wide text-slate-500 uppercase">Traffic sources</p>
          <div className="mt-2">
            <BarList
              data={competitor.trafficSources.map((s) => ({ label: s.label, value: s.share }))}
              color="#0ea5e9"
              valueFormat={(n) => `${n}%`}
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-[10px] tracking-wide text-slate-500 uppercase">Live campaigns</p>
          <ul className="mt-2 space-y-2">
            {competitor.ads.slice(0, 2).map((ad) => (
              <li key={ad.id} className="rounded-lg bg-slate-50 px-2.5 py-2">
                <p className="text-[11px] font-medium text-slate-800">{ad.headline}</p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {ad.platform} · {ad.status}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function BusinessScreen() {
  const metrics = DEMO.metrics;

  return (
    <div className="p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <RingTile label="SEO score" value={metrics.seoScore} color="#4f46e5" />
        <RingTile label="GEO / AI visibility" value={metrics.geoScore} color="#0d9488" />
        <MiniStat
          label="Website traffic"
          value={compact(metrics.monthlyVisits)}
          delta={metrics.visitsChange}
        />
        <MiniStat label="Industry rank" value={`#${metrics.industryRank}`} />
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px]">
          <thead className="bg-slate-50">
            <tr>
              <Th>Tracked keyword</Th>
              <Th className="text-right">Volume</Th>
              <Th className="text-right">Position</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {DEMO.topSeoKeywords.slice(0, 4).map((row) => (
              <tr key={row.keyword}>
                <Td className="text-xs text-slate-700">{row.keyword}</Td>
                <Td className="text-right text-xs text-slate-600">
                  {row.volume.toLocaleString()}
                </Td>
                <Td className="text-right">
                  {row.position === null ? (
                    <Badge tone="neutral">Not ranked</Badge>
                  ) : (
                    <Badge
                      tone={row.position <= 3 ? "good" : row.position <= 10 ? "info" : "neutral"}
                    >
                      #{row.position}
                    </Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[10px] text-slate-500">
        {DEMO.profile.primaryDomain} · {metrics.indexedPages.toLocaleString()} pages
        indexed · domain authority {metrics.domainAuthority}
      </p>
    </div>
  );
}

function ClientsScreen() {
  const clients = DEMO.clients;

  return (
    <div className="p-4">
      <div className="grid grid-cols-3 gap-3">
        <MiniStat
          label="Active customers"
          value={clients.filter((c) => c.status === "active").length}
        />
        <MiniStat label="On the list" value={clients.length} />
        <MiniStat label="Send cadence" value="Weekly" />
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead className="bg-slate-50">
            <tr>
              <Th>Customer</Th>
              <Th>Email</Th>
              <Th>Status</Th>
              <Th className="text-right">Open rate</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {clients.slice(0, 4).map((c) => (
              <tr key={c.id}>
                <Td>
                  <span className="block text-xs font-medium text-slate-900">{c.name}</span>
                  <span className="text-[10px] text-slate-500">{c.company}</span>
                </Td>
                <Td className="text-xs text-slate-600">{c.email}</Td>
                <Td>
                  <Badge
                    tone={
                      c.status === "active" ? "good" : c.status === "paused" ? "warn" : "info"
                    }
                  >
                    {c.status}
                  </Badge>
                </Td>
                <Td className="text-right text-xs font-semibold text-slate-900">{c.openRate}%</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
