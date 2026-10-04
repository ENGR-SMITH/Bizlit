import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * The small pieces the Odoo landing page is assembled from: Odoo's marker
 * strokes, its hand-drawn arrows, the shared button classes and the page
 * container. Every geometry number lives in `.theme-odoo` (src/index.css) —
 * these components only name it, so nothing is invented twice.
 */

/** Button classes, matching the odoo.com control (0.4rem radius, 600 weight). */
export const odBtn = "od-btn od-btn-primary";
export const odBtnLight = "od-btn od-btn-light";
export const odBtnLg = "od-btn od-btn-primary od-btn-lg";
export const odBtnSm = "od-btn od-btn-primary od-btn-sm";

/**
 * A marker stroke painted behind a word — Odoo's `x_wd_*_highlight_*`.
 * The artwork keeps its drawn proportions (`background-size: contain`) and the
 * phrase is held on one line, exactly as Odoo's own markup behaves.
 */
export function Mark({
  children,
  tone = "yellow",
  className,
}: {
  children: ReactNode;
  tone?: "yellow" | "yellow-03" | "coral" | "blue" | "blue-bold";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "od-mark",
        tone === "yellow-03" && "od-mark-03",
        tone === "coral" && "od-mark-coral",
        tone === "blue" && "od-mark-blue",
        tone === "blue-bold" && "od-mark-blue-bold",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Odoo's pen line, sitting under a word rather than behind it. */
export function Underline({
  children,
  tone = "pen",
  className,
}: {
  children: ReactNode;
  tone?: "pen" | "teal";
  className?: string;
}) {
  return (
    <span className={cn("od-underline", tone === "teal" && "od-underline-teal", className)}>
      {children}
    </span>
  );
}

/**
 * One of odoo.com's hand-drawn arrows, at the width the original page gives
 * it. Rotation and offsets stay at the call site, the way Odoo passes them in
 * as utility classes.
 */
export function Doodle({
  src,
  width,
  height,
  className,
}: {
  src: string;
  width: number;
  height?: number;
  className?: string;
}) {
  return (
    <img
      src={src}
      width={width}
      height={height}
      alt=""
      aria-hidden
      loading="lazy"
      className={cn("block", className)}
    />
  );
}

/**
 * odoo.com's Bootstrap container: a 32px gutter (16px a side) and the same
 * width ladder its stylesheet uses — 540 / 720 / 960 / 1140 / 1320px.
 */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 min-[576px]:max-w-[540px] min-[768px]:max-w-[720px] min-[992px]:max-w-[960px] min-[1200px]:max-w-[1140px] min-[1400px]:max-w-[1320px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A grey band. odoo.com keeps these contiguous through the middle of the page
 * and closes the run with 10rem corners — a leaf on the features band.
 */
export function Band({
  children,
  id,
  className,
  leaf = false,
}: {
  children: ReactNode;
  id?: string;
  className?: string;
  leaf?: boolean;
}) {
  return (
    <section id={id} className={cn("bg-[var(--od-band)]", leaf && "od-leaf", className)}>
      <Container>{children}</Container>
    </section>
  );
}
