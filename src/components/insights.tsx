import type { ReactNode } from "react";
import { useId } from "react";
import {
  Area,
  AreaChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  Tooltip,
  XAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { TrafficPoint } from "@/lib/types";
import { cn } from "@/lib/utils";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/* ------------------------------------------------------- status stat grid */

export type StatStatus = "within" | "observe" | "critical";

const STATUSES: Record<StatStatus, { label: string; color: string }> = {
  within: { label: "On track", color: "bg-emerald-500" },
  observe: { label: "Needs attention", color: "bg-amber-500" },
  critical: { label: "At risk", color: "bg-red-500" },
};

export type StatusStat = {
  name: string;
  stat: ReactNode;
  /** Short line under the headline figure. */
  meta?: ReactNode;
  progressLabel: string;
  /** 0–1. Drives both the readout and how many of the five bars light up. */
  progress: number;
  status: StatStatus;
};

const BARS = [1, 2, 3, 4, 5];

/**
 * Bordered stat grid: status pill, headline figure and a five-segment meter per
 * cell — a readout, with nothing in it that looks clickable but is not.
 */
export function StatusStatGrid({ items, className }: { items: StatusStat[]; className?: string }) {
  return (
    <dl
      className={cn(
        "grid grid-cols-1 divide-y divide-foreground/10 overflow-hidden rounded-xl bg-card shadow-[0_0_0_1px_oklch(0_0_0/0.06),0_1px_2px_-1px_oklch(0_0_0/0.06),0_2px_4px_0_oklch(0_0_0/0.04)] sm:grid-cols-2 sm:divide-x xl:grid-cols-4 xl:divide-y-0 dark:shadow-[0_0_0_1px_oklch(1_0_0/0.08)]",
        className,
      )}
    >
      {items.map((item) => {
        const status = STATUSES[item.status];
        const filled = Math.round(clamp(item.progress, 0, 1) * BARS.length);

        return (
          <div key={item.name} className="flex flex-col gap-6 p-6">
            <div className="flex items-center justify-between gap-3">
              <dt className="truncate text-sm font-medium text-foreground">{item.name}</dt>
              <dd className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                <span
                  aria-hidden={true}
                  className={cn("size-1.5 rounded-full", status.color)}
                />
                {status.label}
              </dd>
            </div>

            <dd>
              <span className="block text-3xl font-semibold tracking-tight text-foreground tabular-nums">
                {item.stat}
              </span>
              {item.meta ? (
                <span className="mt-1 block truncate text-sm text-muted-foreground">
                  {item.meta}
                </span>
              ) : null}
            </dd>

            <dd className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{item.progressLabel}</span>
                <span className="font-medium text-foreground tabular-nums">
                  {Math.round(clamp(item.progress, 0, 1) * 100)}%
                </span>
              </div>
              <div aria-hidden={true} className="flex gap-1">
                {BARS.map((bar) => (
                  <span
                    key={bar}
                    className={cn(
                      "h-1.5 flex-1 rounded-full",
                      bar <= filled ? status.color : "bg-foreground/10",
                    )}
                  />
                ))}
              </div>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * Radial score card (0–100) — a ring with the value in the middle and the
 * supporting line underneath, sized to sit in a stat grid.
 */
export function ScoreRadialCard({
  label,
  value,
  icon,
  hint,
  color = "var(--chart-1)",
  max = 100,
  suffix = "",
  className,
}: {
  label: string;
  value: number;
  icon?: ReactNode;
  hint?: ReactNode;
  color?: string;
  max?: number;
  suffix?: string;
  className?: string;
}) {
  const progress = clamp((value / max) * 100, 0, 100);
  const gradientId = `radial-${useId().replace(/:/g, "")}`;
  const data = [{ name: label, progress, fill: `url(#${gradientId})` }];
  const config = { progress: { label, color } } satisfies ChartConfig;

  return (
    <Card className={cn("gap-0 p-0 shadow-2xs", className)}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center">
            <ChartContainer className="h-[80px] w-[80px]" config={config}>
              <RadialBarChart
                barSize={6}
                data={data}
                endAngle={-270}
                innerRadius={30}
                outerRadius={40}
                startAngle={90}
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={color} />
                    <stop
                      offset="100%"
                      stopColor={`color-mix(in srgb, ${color} 55%, white)`}
                    />
                  </linearGradient>
                </defs>
                <PolarAngleAxis
                  angleAxisId={0}
                  axisLine={false}
                  domain={[0, 100]}
                  tick={false}
                  type="number"
                />
                <RadialBar
                  angleAxisId={0}
                  background
                  cornerRadius={10}
                  dataKey="progress"
                  fill={`url(#${gradientId})`}
                />
              </RadialBarChart>
            </ChartContainer>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-base font-medium text-foreground tabular-nums">
                {Math.round(value)}
                {suffix}
              </span>
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              {icon}
              <span className="truncate">{label}</span>
            </div>
            {hint ? <div className="mt-1 text-sm font-medium text-foreground">{hint}</div> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Plain headline metric, used to keep a stat grid the same height as the rings. */
export function MetricTile({
  label,
  value,
  icon,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 p-0 shadow-2xs", className)}>
      <CardContent className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-4">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {icon}
          <span className="truncate">{label}</span>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
            {value}
          </p>
          {hint ? <div className="text-sm text-muted-foreground">{hint}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Traffic trend card — headline number, movement, then the series drawn as a
 * gradient-filled area (the same treatment as the reference design).
 */
export function TrafficTrendCard({
  label = "Website traffic",
  points,
  total,
  changePct,
  caption,
  color = "var(--chart-3)",
  icon,
  className,
}: {
  label?: string;
  points: TrafficPoint[];
  /** Visits in the current period. */
  total: number;
  /** Percent change against the previous period, e.g. `9.1` for +9.1%. */
  changePct: number;
  caption?: ReactNode;
  color?: string;
  icon?: ReactNode;
  className?: string;
}) {
  const positive = changePct >= 0;
  const stroke = positive ? color : "var(--destructive)";
  const gradientId = `traffic-trend-${useId().replace(/:/g, "")}`;
  const config = { visits: { label, color: stroke } } satisfies ChartConfig;

  // The workspace stores the movement as a percentage, so recover the absolute
  // delta from it: previous = total / (1 + pct / 100).
  const previous = changePct <= -100 ? 0 : total / (1 + changePct / 100);
  const delta = Math.round(total - previous);

  return (
    <Card className={cn("gap-0 overflow-hidden p-0 shadow-2xs", className)}>
      <CardContent className="p-0">
        <div className="p-4 pb-2">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {icon}
            <span>{label}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <p className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {total.toLocaleString()}
            </p>
            <p className="flex items-center gap-1 text-sm">
              <span
                className={cn(
                  "font-medium tabular-nums",
                  positive ? "text-emerald-600 dark:text-emerald-500" : "text-destructive",
                )}
              >
                {positive ? "+" : "−"}
                {Math.abs(delta).toLocaleString()}
              </span>
              <span
                className={cn(
                  "tabular-nums",
                  positive ? "text-emerald-600 dark:text-emerald-500" : "text-destructive",
                )}
              >
                ({positive ? "+" : "−"}
                {Math.abs(changePct).toFixed(1)}%)
              </span>
            </p>
          </div>
        </div>

        <div className="h-24">
          <ChartContainer className="h-full w-full" config={config}>
            <AreaChart data={points} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.45} />
                  <stop offset="60%" stopColor={stroke} stopOpacity={0.12} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" hide />
              <Tooltip
                cursor={{ stroke, strokeWidth: 1, strokeDasharray: "4 4" }}
                content={<ChartTooltipContent />}
              />
              <Area
                dataKey="visits"
                animationDuration={900}
                fill={`url(#${gradientId})`}
                fillOpacity={1}
                stroke={stroke}
                strokeWidth={2}
                type="monotone"
                activeDot={{
                  r: 4.5,
                  strokeWidth: 2,
                  stroke: "#ffffff",
                  fill: stroke,
                }}
              />
            </AreaChart>
          </ChartContainer>
        </div>

        {caption ? (
          <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            {caption}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
