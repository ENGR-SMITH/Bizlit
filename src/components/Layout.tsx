import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useClerk } from "@clerk/clerk-react";
import {
  Bell,
  Binoculars,
  Boxes,
  Building2,
  ChevronDown,
  Mail,
  LogOut,
  Megaphone,
  Menu,
  RefreshCw,
  Share2,
  X,
} from "lucide-react";
import type { RouteId } from "../lib/hooks";
import { buildAlerts, buildHealthAlerts, mergeAlerts } from "../lib/alerts";
import { authEnabled, dbEnabled, demoMode } from "../lib/env";
import { PROVIDER_CATALOG, buildUsageBars, buildWorkspaceHealth } from "../lib/integrations";
import { useWorkspace } from "../lib/workspace";
import { relativeTime, titleCase, usd } from "../lib/format";
import { LogoUpload } from "./LogoUpload";
import { Modal } from "./Modal";
import { Badge, Logo, Meter, btnGhost, btnPrimary } from "./primitives";

type NavItem = { id: RouteId; label: string; hint: string; icon: ReactNode };

/** Grouped so the sidebar reads as two jobs, not four equal buttons. */
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Monitor",
    items: [
      {
        id: "competition",
        label: "Competition",
        hint: "Traffic, SEO, ads & reviews",
        icon: <Binoculars size={17} />,
      },
    ],
  },
  {
    label: "Grow",
    items: [
      {
        id: "business",
        label: "My Business",
        hint: "SEO, GEO & ad assets",
        icon: <Building2 size={17} />,
      },
      {
        id: "clients",
        label: "Clients",
        hint: "Email list & message schedule",
        icon: <Mail size={17} />,
      },
      {
        id: "social",
        label: "Social & reviews",
        hint: "Your reviews, social and competitor benchmarks",
        icon: <Share2 size={17} />,
      },
    ],
  },
  {
    label: "Create",
    items: [
      {
        id: "inventory",
        label: "Inventory & services",
        hint: "What you sell — the source for your ads",
        icon: <Boxes size={17} />,
      },
      {
        id: "promotion",
        label: "Promotions",
        hint: "Tell us what your next ad should include",
        icon: <Megaphone size={17} />,
      },
    ],
  },
];

/**
 * Explicit sign-out control. Only mounted when Clerk is configured, so the
 * hook is never called without a ClerkProvider above it.
 */
function LogoutButton({ collapsed }: { collapsed: boolean }) {
  const { signOut } = useClerk();
  return (
    <button
      type="button"
      onClick={() => void signOut()}
      title="Log out"
      className={`mt-1 flex w-full items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] font-semibold text-rose-300 transition hover:border-rose-500 hover:bg-rose-600 hover:text-white ${
        collapsed ? "lg:justify-center" : ""
      }`}
    >
      <LogOut size={13} />
      <span className={collapsed ? "lg:hidden" : ""}>Log out</span>
    </button>
  );
}

export const PAGE_META: Record<RouteId, { title: string; subtitle: string }> = {
  competition: {
    title: "Competition watch",
    subtitle: "Traffic, keyword gaps, ads, reviews and the audiences they target",
  },
  clients: {
    title: "Client messaging desk",
    subtitle: "Your customer list, the messages they receive and what has been sent",
  },
  business: {
    title: "My business",
    subtitle: "Your SEO & GEO scores, traffic, ad assets and stock to buy next",
  },
  social: {
    title: "Social & reviews",
    subtitle: "Your tracked reviews and social channels, plus how competitors compare",
  },
  inventory: {
    title: "Inventory & services",
    subtitle: "What you sell — the products and services your ad designs are built from",
  },
  promotion: {
    title: "Promotions",
    subtitle: "Brief our design team on your next ad, then collect the finished design",
  },
  notifications: {
    title: "Notifications",
    subtitle: "Every price, stock, ad and review alert your scans raised, newest first",
  },
};

export function Layout({
  route,
  navigate,
  children,
}: {
  route: RouteId;
  navigate: (route: RouteId) => void;
  children: ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data, actions, refresh } = useWorkspace();

  // Plan usage and monitoring health both come from rows the app already holds,
  // so the settings modal can report them without calling any provider.
  const usage = useMemo(() => buildUsageBars(data?.providerStatus ?? []), [data?.providerStatus]);
  const health = useMemo(
    () =>
      buildWorkspaceHealth({
        scanRuns: data?.scanRuns ?? [],
        integrationConnections: data?.integrationConnections ?? [],
        reviewConnections: data?.reviewConnections ?? [],
        socialAccounts: data?.socialAccounts ?? [],
      }),
    [data?.scanRuns, data?.integrationConnections, data?.reviewConnections, data?.socialAccounts],
  );

  // The badge counts the same list the Notifications page renders, health alerts
  // included: a scan failing for days is exactly the kind of thing the count is
  // there to surface, and two different totals for one destination is a bug the
  // user would have to reconcile by hand.
  const alerts = useMemo(
    () => (data ? mergeAlerts(buildAlerts(data), buildHealthAlerts(health)) : []),
    [data, health],
  );

  const badges: Record<RouteId, number> = {
    competition: data
      ? data.competitors.flatMap((c) => c.ads).filter((a) => a.status === "active").length
      : 0,
    clients: data ? data.clients.filter((c) => c.status === "active").length : 0,
    business: alerts.filter((a) => a.page === "business").length,
    social: data ? data.latestReviewScan.flagged : 0,
    inventory: data ? data.inventory.filter((i) => i.status === "active").length : 0,
    promotion: data ? data.promotionBriefs.length : 0,
    notifications: alerts.length,
  };

  const meta = PAGE_META[route];
  const brand = data?.profile.brandName || "BIZLIT";
  const logoUrl = data?.profile.logoUrl ?? "";

  function openItem(id: RouteId) {
    navigate(id);
    setNavOpen(false);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        <aside
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className={`fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col overflow-hidden border-r border-slate-800 bg-slate-900 text-slate-300 transition-all duration-200 lg:sticky lg:top-0 lg:bottom-auto lg:h-screen lg:translate-x-0 ${
            navOpen ? "translate-x-0" : "-translate-x-full"
          } ${hovered ? "w-64" : "w-64 lg:w-[76px]"}`}
        >
          {/* Close control for the mobile drawer; the brand lives in the top bar. */}
          <div className="flex items-center justify-end px-3 pt-3 lg:hidden">
            <button
              type="button"
              onClick={() => setNavOpen(false)}
              className="rounded p-1 text-slate-400 hover:text-white"
              aria-label="Close navigation"
            >
              <X size={16} />
            </button>
          </div>

          {/* App brand: the logo mark is always visible, the name once the rail is wide. */}
          <div
            className={`flex items-center gap-2.5 px-3 pt-3 pb-1 ${hovered ? "" : "lg:justify-center"}`}
          >
            <img
              src="/logo.png"
              alt="BIZLIT logo"
              className="h-9 w-9 shrink-0 rounded-xl object-cover ring-1 ring-white/10"
            />
            <span
              className={`text-sm font-semibold tracking-tight text-white ${hovered ? "" : "lg:hidden"}`}
            >
              BIZLIT
            </span>
          </div>

          <nav className="mt-2 flex-1 overflow-y-auto px-3 pb-4">
            {NAV_GROUPS.map((group, index) => (
              <div
                key={group.label}
                className={index > 0 ? "mt-5 border-t border-slate-800 pt-5" : ""}
              >
                <p
                  className={`mb-2 px-3 text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase ${
                    hovered ? "" : "lg:hidden"
                  }`}
                >
                  {group.label}
                </p>

                <div className="space-y-2">
                  {group.items.map((item) => {
                    const active = route === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        title={item.hint}
                        aria-current={active ? "page" : undefined}
                        onClick={() => openItem(item.id)}
                        className={`group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition ${
                          hovered ? "" : "lg:justify-center"
                        } ${
                          active
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-slate-300 hover:bg-slate-800 hover:text-white"
                        }`}
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${
                            active
                              ? "bg-white/20 text-white"
                              : "bg-slate-800 text-slate-400 group-hover:text-white"
                          }`}
                        >
                          {item.icon}
                        </span>
                        <span
                          className={`min-w-0 flex-1 truncate text-sm font-medium ${
                            hovered ? "" : "lg:hidden"
                          }`}
                        >
                          {item.label}
                        </span>
                        {badges[item.id] > 0 ? (
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                              hovered ? "" : "lg:hidden"
                            } ${
                              active ? "bg-white/25 text-white" : "bg-slate-800 text-slate-300"
                            }`}
                          >
                            {badges[item.id]}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Sign-out sits at the bottom of the rail. */}
          <div className="mt-auto border-t border-slate-800 px-3 py-3">
            {authEnabled ? <LogoutButton collapsed={!hovered} /> : null}
          </div>
        </aside>

        {navOpen ? (
          <button
            type="button"
            aria-label="Close navigation overlay"
            onClick={() => setNavOpen(false)}
            className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          />
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setNavOpen(true)}
                  className="rounded-lg border border-slate-200 p-2 text-slate-600 lg:hidden"
                  aria-label="Open navigation"
                >
                  <Menu size={16} />
                </button>
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900">
                    {meta.title}
                  </h1>
                  <p className="hidden text-xs text-slate-500 sm:block">{meta.subtitle}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {demoMode ? (
                  <Badge tone="warn">Demo data</Badge>
                ) : dbEnabled ? null : (
                  <Badge tone="info">Sample data</Badge>
                )}
                <button
                  type="button"
                  onClick={() => navigate("notifications")}
                  className="relative rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50"
                  aria-label="Notifications"
                  title="Notifications"
                >
                  <Bell size={16} />
                  {alerts.length ? (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
                      {alerts.length}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  title="Business profile"
                  aria-label="Business profile"
                  className="flex items-center gap-2 rounded-lg border border-slate-200 py-1 pr-2.5 pl-1 text-slate-600 transition hover:bg-slate-50"
                >
                  <Logo
                    src={logoUrl}
                    name={brand}
                    size={26}
                    className="bg-indigo-500 text-[10px] text-white"
                  />
                  <span className="hidden max-w-40 truncate text-xs font-medium text-slate-700 sm:block">
                    {brand}
                  </span>
                  <ChevronDown size={13} className="text-slate-400" />
                </button>
              </div>
            </div>

            {data?.isSample && !demoMode ? (
              <div className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-[11px] text-amber-800 sm:px-6">
                No monitoring results yet for {brand}. The screens below show sample data so you can
                see the layout — your first scans will replace it automatically.
              </div>
            ) : null}

          </header>

          <main className="flex-1 px-4 py-5 sm:px-6">{children}</main>

          <footer className="border-t border-slate-200 px-4 py-4 text-[11px] text-slate-400 sm:px-6">
            {brand} · competitor and client monitoring workspace.{" "}
            {demoMode
              ? "Demo mode: connect Clerk and Supabase to run on your own data."
              : "Scans run on the cadence set per source; customer emails are delivered over your mail account and logged in your workspace."}
          </footer>
        </div>
      </div>

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Business profile"
        subtitle="Your logo and workspace identity"
        icon={<Building2 size={16} />}
        footer={
          <button type="button" className={btnPrimary} onClick={() => setSettingsOpen(false)}>
            Done
          </button>
        }
      >
        <div className="space-y-5 px-4 py-4">
          <div>
            <p className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Business logo
            </p>
            <LogoUpload
              logoUrl={logoUrl}
              brandName={brand}
              onPick={(file) => actions.uploadLogo(file)}
              onRemove={() => actions.removeLogo()}
            />
          </div>

          <dl className="grid gap-2 sm:grid-cols-2">
            {[
              { label: "Brand name", value: data?.profile.brandName || "—" },
              { label: "Industry", value: data?.profile.industry || "—" },
              { label: "Website", value: data?.profile.primaryDomain || "—" },
              { label: "Alerts to", value: data?.profile.notificationEmail || "—" },
              { label: "Currency", value: data?.profile.currency || "—" },
              { label: "Timezone", value: data?.profile.timezone || "—" },
            ].map((row) => (
              <div key={row.label} className="rounded-lg bg-slate-50 px-3 py-2">
                <dt className="text-[10px] tracking-wide text-slate-500 uppercase">{row.label}</dt>
                <dd className="truncate text-xs font-medium text-slate-800">{row.value}</dd>
              </div>
            ))}
          </dl>

          <div className="border-t border-slate-100 pt-4">
            <p className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Integrations
            </p>
            <ul className="space-y-2">
              {(data?.providerStatus ?? []).map((provider) => (
                <li
                  key={provider.provider}
                  className="rounded-lg border border-slate-200 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800">{provider.label}</span>
                    <Badge tone={provider.configured ? "good" : "neutral"}>
                      {provider.configured ? "Configured" : "Not configured"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">{provider.description}</p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {provider.configured
                      ? `${provider.connections} connection${provider.connections === 1 ? "" : "s"} · ${provider.requests} call${provider.requests === 1 ? "" : "s"} · ${usd(provider.costUsd)} recorded`
                      : `Add ${provider.envKeys.join(" + ")} to the server, then deploy the gateway functions.`}
                  </p>
                  {/* A capability this provider is configured for in general but
                      switched off here — a missing extra secret, not a fault. */}
                  {provider.inactiveFeatures.map((feature) => (
                    <p key={feature} className="mt-1 text-[10px] text-amber-600">
                      {feature}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </div>

          {usage.length ? (
            <div className="border-t border-slate-100 pt-4">
              <p className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Plan usage this month
              </p>
              <ul className="space-y-2.5">
                {usage.map((bar) => (
                  <li key={bar.provider} className="rounded-lg border border-slate-200 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-800">{bar.label}</span>
                      <Badge
                        tone={bar.level === "full" ? "bad" : bar.level === "warn" ? "warn" : "good"}
                      >
                        {bar.capped ? `${Math.round(bar.pct)}% used` : "No cap"}
                      </Badge>
                    </div>
                    {bar.capped ? (
                      <Meter
                        value={Math.min(100, bar.pct)}
                        tone={bar.level === "full" ? "bad" : bar.level === "warn" ? "warn" : "brand"}
                        className="mt-2"
                      />
                    ) : null}
                    <p className="mt-1.5 text-[10px] text-slate-400">
                      {bar.cap > 0
                        ? `${bar.units} of ${bar.cap} monthly units`
                        : bar.capUsd > 0
                          ? `${usd(bar.costUsd)} of ${usd(bar.capUsd)} monthly spend`
                          : `${bar.units} units recorded`}
                      {` · ${bar.requests} call${bar.requests === 1 ? "" : "s"}`}
                      {bar.errors ? ` · ${bar.errors} failed` : ""}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] text-slate-400">
                Counted from the gateway's own call log. A provider at 100% refuses the next scan
                until its cap is raised or the month rolls over.
              </p>
            </div>
          ) : null}

          <div className="border-t border-slate-100 pt-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Monitoring health
              </p>
              <button
                type="button"
                className={btnGhost}
                onClick={() => void refresh()}
              >
                <RefreshCw size={13} /> Refresh
              </button>
            </div>

            {health.ok ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                Nothing needs attention — no scans failed in the last 7 days and every connection is
                still authorised.
                {health.pendingScans ? ` ${health.pendingScans} scan${health.pendingScans === 1 ? "" : "s"} still running.` : ""}
              </p>
            ) : (
              <ul className="space-y-2">
                {health.failedScans.slice(0, 5).map((run) => (
                  <li key={run.id} className="rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-rose-900">
                        {run.sourceName || `${titleCase(run.sourceType)} scan`} failed
                      </span>
                      <span className="shrink-0 text-[10px] text-rose-700">
                        {relativeTime(run.startedAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-rose-800">
                      {run.error || "The provider did not return a result. Re-run the scan."}
                    </p>
                  </li>
                ))}
                {health.failedScans.length > 5 ? (
                  <li className="text-[10px] text-slate-400">
                    +{health.failedScans.length - 5} more failed scans this week
                  </li>
                ) : null}

                {health.needsReconnect.map((item) => (
                  <li
                    key={`${item.provider}-${item.label}`}
                    className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2"
                  >
                    <p className="text-xs font-semibold text-amber-900">
                      {item.label} needs reconnecting
                    </p>
                    <p className="mt-0.5 text-[11px] text-amber-800">
                      {PROVIDER_CATALOG[item.provider].label} rejected the saved credentials. Remove
                      and re-add the connection on the page that owns it.
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-[11px] text-slate-500">
            Other business details come from your setup answers. Re-run setup from the workspace to
            change competitors and clients.
          </p>
        </div>
      </Modal>
    </div>
  );
}
