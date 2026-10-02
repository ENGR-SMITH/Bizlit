import { useId, useState } from "react";
import type { CSSProperties } from "react";
import type { TrafficPoint } from "../lib/types";
import { compact } from "../lib/format";

/**
 * Smooth curve through the points: Catmull-Rom converted to cubic beziers.
 * The 1/6 tension keeps the line honest — it passes through every sample
 * without the overshoot spikes a looser tension would draw between them.
 */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;

  let d = `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

/** `useId()` contains colons, which are awkward inside `url(#…)` references. */
function useSvgId(prefix: string) {
  return `${prefix}-${useId().replace(/:/g, "")}`;
}

/**
 * Which bars get an axis label when the series is longer than the row can hold.
 *
 * The stored series grow now — a year of traffic months, two months of daily
 * readings — and a label under every bar would be a grey smear at this size.
 * The indices are spread evenly across the whole run and always include both
 * ends, so the axis still reads first-to-last without crowding the middle.
 */
export function axisLabelIndices(length: number, max = 7): number[] {
  if (length <= 0) return [];
  if (length <= max) return Array.from({ length }, (_, i) => i);

  const picked: number[] = [];
  const seen = new Set<number>();
  for (let k = 0; k < max; k += 1) {
    const index = Math.round((k * (length - 1)) / (max - 1));
    if (!seen.has(index)) {
      seen.add(index);
      picked.push(index);
    }
  }
  return picked;
}

/**
 * One bar with rounded top corners — SVG's `rx` would round the baseline end
 * too, so the corners are drawn explicitly. Zero-height bars draw nothing.
 */
function barPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  if (height <= 0 || width <= 0) return "";
  const r = Math.min(radius, height, width / 2);
  return [
    `M ${x},${y + height}`,
    `L ${x},${y + r}`,
    `Q ${x},${y} ${x + r},${y}`,
    `L ${x + width - r},${y}`,
    `Q ${x + width},${y} ${x + width},${y + r}`,
    `L ${x + width},${y + height}`,
    "Z",
  ].join(" ");
}

/**
 * The workspace trend chart: gradient-filled bars rising from a grounded zero
 * baseline, hairline gridlines and a grounding rule, and a hover state that
 * lifts one bar, dims the rest and shows a clamped tooltip with the period and
 * its value. The bars rise in sequence from the baseline on mount.
 */
export function BarChart({
  data,
  color = "#4f46e5",
  valueFormat = compact,
  height = 140,
}: {
  data: TrafficPoint[];
  color?: string;
  valueFormat?: (n: number) => string;
  height?: number;
}) {
  const gradientId = useSvgId("bar-fill");
  const [hover, setHover] = useState<number | null>(null);

  const w = 320;
  const h = 110;
  const chartHeight = height - 24;

  if (!data.length) return null;

  // Bars are lengths, so they are grounded at zero — the height of a bar is
  // the value itself — with a little headroom above the tallest for its cap.
  const max = Math.max(...data.map((d) => d.visits), 0) * 1.08 || 1;
  const slot = w / data.length;
  const barW = Math.min(slot * 0.6, 46);
  // Long series label a few points, not every one — see `axisLabelIndices`.
  const labelled = new Set(axisLabelIndices(data.length));

  const bars = data.map((d, i) => {
    const barH = Math.max((d.visits / max) * h, 0);
    const cx = slot * (i + 0.5);
    return { ...d, cx, barH, x: cx - barW / 2, y: h - barH };
  });

  const active = hover === null ? null : bars[hover];

  // Keep the tooltip inside the card: pull it back toward the middle near the
  // edges, and flip it below the bar top when there is no room above.
  const activePct = active ? (active.cx / w) * 100 : 0;
  const tooltipLeft = Math.min(88, Math.max(12, activePct));
  const flipBelow = active ? active.y < 36 : false;

  return (
    <div style={{ height }} className="flex flex-col justify-end">
      <div className="relative">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="w-full"
          style={{ height: chartHeight }}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`color-mix(in srgb, ${color} 62%, white)`} />
              <stop offset="100%" stopColor={color} />
            </linearGradient>
          </defs>

          {/* Hairline grid — present, but never louder than the data. */}
          {[0.25, 0.5, 0.75].map((g) => (
            <line
              key={g}
              x1="0"
              x2={w}
              y1={h * g}
              y2={h * g}
              stroke="#e2e8f0"
              strokeOpacity={0.7}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* The baseline every bar stands on. */}
          <line
            x1="0"
            x2={w}
            y1={h}
            y2={h}
            stroke="#e2e8f0"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />

          {/* The bars: rounded caps, gradient bodies, staggered rise. */}
          {bars.map((b, i) => (
            <path
              key={`${b.label}-${i}`}
              className="chart-rise transition-opacity duration-150"
              d={barPath(b.x, b.y, barW, b.barH, 6)}
              fill={`url(#${gradientId})`}
              opacity={hover === null || hover === i ? 1 : 0.45}
              style={{
                // A long series would otherwise finish its rise seconds later.
                animationDelay: `${Math.min(i * 60, 720)}ms`,
                filter:
                  hover === i
                    ? `drop-shadow(0 3px 8px color-mix(in srgb, ${color} 45%, transparent))`
                    : undefined,
              }}
            />
          ))}

          {/* One hover zone per bar, the full height of the slot. */}
          {bars.map((b, i) => (
            <rect
              key={`zone-${b.label}-${i}`}
              x={slot * i}
              y={0}
              width={slot}
              height={h}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>

        {active ? (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left shadow-xl"
            style={{
              left: `${tooltipLeft}%`,
              top: `${(active.y / h) * chartHeight}px`,
              transform: flipBelow
                ? "translate(-50%, 10px)"
                : "translate(-50%, calc(-100% - 10px))",
            }}
          >
            <div className="flex items-center gap-1.5">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: color }}
              />
              <span className="text-[10px] font-medium tracking-wide text-slate-400 uppercase">
                {active.label}
              </span>
            </div>
            <p className="mt-0.5 text-xs font-bold text-slate-900 tabular-nums">
              {valueFormat(active.visits)}
            </p>
          </div>
        ) : null}
      </div>

      {/* Labels line up under their own bars; the ends sit flush. */}
      <div className="relative mt-1 h-4">
        {data.map((d, i) =>
          labelled.has(i) ? (
            <span
              key={`${d.label}-${i}`}
              className="absolute top-0 text-[10px] whitespace-nowrap text-slate-400"
              style={{
                left: `${((slot * (i + 0.5)) * 100) / w}%`,
                transform: "translateX(-50%)",
              }}
            >
              {d.label}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

/**
 * Ranked horizontal bars: gradient-filled tracks that grow in left-to-right in
 * rank order, with the value set in tabular figures and a hover lift.
 */
export function BarList({
  data,
  color = "#4f46e5",
  valueFormat = compact,
}: {
  data: { label: string; value: number }[];
  color?: string;
  valueFormat?: (n: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="space-y-3">
      {data.map((d, i) => (
        <li key={d.label} className="group">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-slate-600 transition-colors group-hover:text-slate-900">
              {d.label}
            </span>
            <span className="shrink-0 font-semibold text-slate-900 tabular-nums">
              {valueFormat(d.value)}
            </span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="chart-grow h-full rounded-full transition-[filter] group-hover:brightness-110"
              style={{
                width: `${Math.max((d.value / max) * 100, 0)}%`,
                background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 55%, white))`,
                animationDelay: `${i * 70}ms`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Tiny trend line with a soft gradient underneath — for tables and tiles. */
export function Sparkline({
  values,
  color = "#4f46e5",
}: {
  values: number[];
  color?: string;
}) {
  const gradientId = useSvgId("spark-fill");
  const w = 100;
  const h = 28;
  if (!values.length) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : w;

  // A lone value still reads as a flat line across the tile.
  const pts =
    values.length === 1
      ? [
          { x: 0, y: h - ((values[0] - min) / span) * h },
          { x: w, y: h - ((values[0] - min) / span) * h },
        ]
      : values.map((v, i) => ({ x: i * step, y: h - ((v - min) / span) * h }));

  const linePath = smoothPath(pts);
  const areaPath = `${linePath} L ${w},${h} L 0,${h} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-7 w-24">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        className="chart-draw"
        d={linePath}
        fill="none"
        pathLength={100}
        strokeDasharray={100}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Compact circular percentage — the score ring used inside summary stat cards.
 * The stroke is a gradient and it sweeps to its value on mount.
 */
export function ProgressRing({
  value,
  max = 100,
  size = 52,
  stroke = 6,
  color = "#4f46e5",
}: {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  color?: string;
}) {
  const gradientId = useSvgId("ring-fill");
  const safeMax = max > 0 ? max : 100;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (pct / 100) * circumference;
  const offset = circumference - dash;

  return (
    <div className="relative shrink-0" style={{ height: size, width: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} />
            <stop offset="100%" stopColor={`color-mix(in srgb, ${color} 55%, white)`} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          style={{ stroke: `color-mix(in srgb, ${color} 16%, transparent)` }}
          strokeWidth={stroke}
        />
        <circle
          className="chart-ring"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={
            {
              strokeDashoffset: offset,
              "--ring-len": `${circumference}`,
              "--ring-off": `${offset}`,
            } as CSSProperties
          }
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-slate-900 tabular-nums">
        {Math.round(pct)}%
      </span>
    </div>
  );
}

export function Stars({ rating, size = 12 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`${rating} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, rating - i + 1));
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 20 20">
            <defs>
              <linearGradient id={`star-${i}-${Math.round(fill * 100)}`}>
                <stop offset={`${fill * 100}%`} stopColor="#f59e0b" />
                <stop offset={`${fill * 100}%`} stopColor="#e2e8f0" />
              </linearGradient>
            </defs>
            <path
              d="M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z"
              fill={`url(#star-${i}-${Math.round(fill * 100)})`}
            />
          </svg>
        );
      })}
    </span>
  );
}

export function DeltaPill({ value, suffix = "%" }: { value: number; suffix?: string }) {
  const good = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
        good ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
      }`}
    >
      {good ? "▲" : "▼"} {Math.abs(value).toFixed(1)}
      {suffix}
    </span>
  );
}
