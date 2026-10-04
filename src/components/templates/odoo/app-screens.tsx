import { useState } from "react";
import type { ReactNode } from "react";
import { BarChart3, Binoculars, Users } from "lucide-react";
import { Badge, Td, Th } from "@/components/primitives";
import { BarList, DeltaPill, ProgressRing } from "@/components/charts";
import { sampleWorkspace } from "@/data/sample";
import { compact } from "@/lib/format";
import { Band, Mark } from "./bits";

/*
 * Odoo gives its product a full-width screenshot band in the middle of the
 * page, so this is ours: the real workspace layouts, rendered from the app's
 * own primitives with the sample workspace behind them, swapped by a small
 * slider. Everything below is the app's own light palette on purpose — it is
 * the product itself, not the marketing page.
 */

const DEMO = sampleWorkspace();

type ScreenId = "competition" | "business" | "clients";

const SCREENS: { id: ScreenId; label: string; icon: ReactNode; render: () => ReactNode }[] = [
  {
    id: "competition",
    label: "Competition",
    icon: <Binoculars size={14} />,
    render: () => <CompetitionScreen />,
  },
  {
    id: "business",
    label: "My Business",
    icon: <BarChart3 size={14} />,
    render: () => <BusinessScreen />,
  },
  {
    id: "clients",
    label: "Clients",
    icon: <Users size={14} />,
    render: () => <ClientsScreen />,
  },
];

export function ScreensBand() {
  const [screen, setScreen] = useState<ScreenId>("competition");
  const active = SCREENS.find((s) => s.id === screen) ?? SCREENS[0];

  return (
    <Band id="screens" className="overflow-hidden pt-[3rem] pb-[3rem] lg:pb-[12rem]">
      <h2 className="od-d2 mb-[4rem] lg:text-center">
        Every screen, <Mark tone="coral">before</Mark> you sign up.
      </h2>
      <p className="mx-auto max-w-2xl text-[1.25rem] text-[var(--od-body)] lg:text-center">
        The real workspace layouts, shown with sample data. Pick one and look around.
      </p>

      <div className="mt-8 flex justify-center">
        <div
          role="tablist"
          aria-label="Workspace screens"
          className="flex gap-1 overflow-x-auto rounded-full bg-[var(--od-surface)] p-1 ring-1 ring-[var(--od-border)]"
        >
          {SCREENS.map((s) => {
            const isActive = s.id === active.id;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setScreen(s.id)}
                className={`inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-[var(--od-violet-solid)] font-semibold text-white"
                    : "font-medium text-[var(--od-ink)] hover:text-[var(--od-violet)]"
                }`}
              >
                {s.icon}
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="od-tile-shadow mt-7 rounded-2xl bg-[var(--od-surface)] p-2 sm:p-3">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900">
          {active.render()}
        </div>
      </div>

      <p className="mt-4 text-center text-sm text-[var(--od-muted)]">
        Screens shown with sample data. Your own workspace fills in as soon as your first scan
        completes.
      </p>
    </Band>
  );
}

/* --------------------------------------------------------- screen mocks */

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
              color="#8b5cf6"
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
        <RingTile label="SEO score" value={metrics.seoScore} color="#6366f1" />
        <RingTile label="GEO / AI visibility" value={metrics.geoScore} color="#a855f7" />
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
        {DEMO.profile.primaryDomain} · {metrics.indexedPages.toLocaleString()} pages indexed ·
        domain authority {metrics.domainAuthority}
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
                    tone={c.status === "active" ? "good" : c.status === "paused" ? "warn" : "info"}
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
