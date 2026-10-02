import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { domainFromUrl } from "../lib/format";

type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "brand";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-600 ring-slate-200",
  good: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warn: "bg-amber-50 text-amber-700 ring-amber-200",
  bad: "bg-rose-50 text-rose-700 ring-rose-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  brand: "bg-indigo-50 text-indigo-700 ring-indigo-200",
};

const TONE_BAR: Record<Tone, string> = {
  neutral: "bg-slate-400",
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-rose-500",
  info: "bg-sky-500",
  brand: "bg-indigo-500",
};

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}
    >
      {children}
    </section>
  );
}

export function CardHead({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
      <div className="flex items-start gap-2.5">
        {icon ? (
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            {icon}
          </span>
        ) : null}
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </header>
  );
}

export function Tabs<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: { value: T; label: string; icon?: ReactNode; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              active
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {opt.icon}
            {opt.label}
            {opt.count !== undefined ? (
              <span
                className={`rounded-full px-1.5 text-[10px] font-semibold ${
                  active ? "bg-white/25 text-white" : "bg-slate-100 text-slate-500"
                }`}
              >
                {opt.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Business logo: uploaded image when set, initials block otherwise. */
export function Logo({
  src,
  name,
  size = 36,
  className = "",
}: {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "BIZ";

  if (src) {
    return (
      <img
        src={src}
        alt={`${name} logo`}
        style={{ height: size, width: size }}
        className={`shrink-0 rounded-xl bg-white object-cover ring-1 ring-slate-200 ${className}`}
      />
    );
  }

  return (
    <span
      aria-hidden
      style={{ height: size, width: size, fontSize: Math.round(size * 0.36) }}
      className={`flex shrink-0 items-center justify-center rounded-xl font-semibold ${className}`}
    >
      {initials}
    </span>
  );
}

/**
 * A monitored site's own logo, taken from the favicon it publishes. Falls back
 * to the brand initials block when the site has no favicon or it will not load.
 */
export function SiteLogo({
  website,
  name,
  size = 28,
  className = "",
}: {
  website: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const domain = domainFromUrl(website);

  if (!domain || failed) {
    return (
      <Logo name={name} size={size} className={className || "bg-slate-100 text-slate-500"} />
    );
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${
        size > 32 ? 128 : 64
      }`}
      alt={`${name} logo`}
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={{ height: size, width: size }}
      className={`shrink-0 rounded-lg bg-white object-contain ring-1 ring-slate-200 ${className}`}
    />
  );
}

const NOTICE_TONE = {
  warn: "border-amber-200 bg-amber-50/70 text-amber-900",
  info: "border-indigo-200 bg-indigo-50/70 text-indigo-900",
  bad: "border-rose-200 bg-rose-50/70 text-rose-900",
} as const;

/**
 * A one-line summary that keeps its detail list collapsed, so a page opens with
 * the headline rather than every item it is flagging.
 */
export function Notice({
  tone = "warn",
  icon,
  title,
  children,
  defaultOpen = false,
}: {
  tone?: keyof typeof NOTICE_TONE;
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`rounded-xl border ${NOTICE_TONE[tone]}`}>
      <div className="flex items-start gap-3 px-4 py-3">
        {icon ? (
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/80">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{title}</p>
            {children ? (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-medium underline-offset-2 opacity-80 hover:underline hover:opacity-100"
              >
                {open ? "Hide details" : "See details"}
                <ChevronDown size={12} className={`transition ${open ? "rotate-180" : ""}`} />
              </button>
            ) : null}
          </div>
          {children && open ? <div className="mt-1.5">{children}</div> : null}
        </div>
      </div>
    </section>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  delta,
  hint,
  icon,
  visual,
}: {
  label: string;
  value: ReactNode;
  delta?: number;
  hint?: string;
  icon?: ReactNode;
  /** Compact chart shown beside the value — a ring for scores, a sparkline for trends. */
  visual?: ReactNode;
}) {
  const tone: Tone = delta === undefined ? "neutral" : delta >= 0 ? "good" : "bad";
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
        {icon ? <span className="text-slate-400">{icon}</span> : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
        {visual ? <div className="shrink-0">{visual}</div> : null}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {delta !== undefined ? (
          <Badge tone={tone}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
          </Badge>
        ) : null}
        {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
      </div>
    </Card>
  );
}

export function Meter({
  value,
  max = 100,
  tone = "brand",
  className = "",
}: {
  value: number;
  max?: number;
  tone?: Tone;
  className?: string;
}) {
  const width = Math.max(2, Math.min(100, (value / max) * 100));
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-slate-100 ${className}`}>
      <div className={`h-full rounded-full ${TONE_BAR[tone]}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export function ScoreRing({
  score,
  label,
  tone = "brand",
}: {
  score: number;
  label: string;
  tone?: Tone;
}) {
  const stroke =
    tone === "good" ? "#059669" : tone === "warn" ? "#d97706" : tone === "bad" ? "#e11d48" : "#4f46e5";
  const r = 34;
  const c = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, score)) / 100) * c;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#e2e8f0" strokeWidth="8" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
        />
      </svg>
      <div>
        <p className="text-2xl font-semibold text-slate-900">{score}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-slate-400">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

export const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50";

export const btnGhost =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50";

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-md font-medium transition ${
            size === "sm" ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs"
          } ${
            value === opt.value
              ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function CheckboxChip({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
        checked
          ? "bg-indigo-600 text-white ring-indigo-600"
          : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

export function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 text-sm text-slate-700 ${className}`}>{children}</td>;
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  /** The way out of the empty state — a page with nothing on it should not be a dead end. */
  action?: ReactNode;
}) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * A destructive action that takes two clicks: the first arms it, the second
 * performs it.
 *
 * It guards the removal of a watched source, and those deletes cascade —
 * removing a competitor takes its scans, keywords, posts and reviews with it,
 * and there is no undo. So the first click only states the intent; the copy
 * around the button is where the collateral is named.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  icon,
  busy = false,
  onConfirm,
  className = "",
}: {
  label: string;
  /** What the button says once armed — never the same as `label`, so the state is visible. */
  confirmLabel: string;
  icon?: ReactNode;
  busy?: boolean;
  onConfirm: () => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
        armed
          ? "bg-rose-600 text-white hover:bg-rose-700"
          : "border border-rose-300 bg-white text-rose-700 hover:bg-rose-50"
      } ${className}`}
    >
      {icon}
      {armed ? confirmLabel : label}
    </button>
  );
}

/** Small label/value pair used inside detail modals. */
export function Detail({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg bg-slate-50 px-3 py-2 ${className}`}>
      <dt className="text-[10px] tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-0.5 text-xs font-medium text-slate-800">{children}</dd>
    </div>
  );
}

export const changeTone: Record<string, Tone> = {
  new_product: "info",
  price_change: "brand",
  stock_change: "warn",
  promotion: "good",
  removed: "bad",
};
