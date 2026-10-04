import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * The landing's day/night choice, in one place: the key it is remembered
 * under, the reading of that key (falling back to the system preference), the
 * hook that paints it on a page wrapper, and the switch itself.
 *
 * The header and the auth screens both render the switch; they previously
 * carried their own copies of this logic. The workspace never carries the
 * `.theme-odoo` class, so none of this reaches it.
 */

/** Where the choice is kept — shared by the landing page and the auth screens. */
export const THEME_KEY = "bizlit-landing-theme";

/** The visitor's last choice, falling back to what their system asks for. */
export function storedDark(): boolean {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "dark") return true;
    if (stored === "light") return false;
  } catch {
    /* a browser that blocks storage still gets the system preference */
  }
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

/**
 * The choice, painted on every `.theme-odoo` wrapper — the landing page and
 * the auth screens, never the workspace — and remembered for the next visit.
 * Page wrapper and switch both read this, so they can never disagree.
 */
export function useLandingDark() {
  const [dark, setDark] = useState(storedDark);

  useEffect(() => {
    document
      .querySelectorAll(".theme-odoo")
      .forEach((wrapper) => wrapper.classList.toggle("theme-odoo-dark", dark));
    try {
      window.localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {
      /* nothing to remember with */
    }
  }, [dark]);

  return [dark, setDark] as const;
}

/**
 * The 56px pill: a track, a thumb that slides, and a sun and a moon on it.
 * The geometry lives in `index.css` (`od-theme-switch`); this is only its
 * markup, so the header and the auth screens draw the same control.
 */
export function ThemeSwitch({
  dark,
  onToggle,
  className,
}: {
  dark: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={dark ? "Switch to the day theme" : "Switch to the night theme"}
      title={dark ? "Day theme" : "Night theme"}
      onClick={onToggle}
      className={cn("od-theme-switch", className)}
    >
      <span aria-hidden className="od-theme-switch-thumb" />
      <span aria-hidden className="od-theme-switch-cell" data-on={!dark}>
        <Sun size={15} />
      </span>
      <span aria-hidden className="od-theme-switch-cell" data-on={dark}>
        <Moon size={15} />
      </span>
    </button>
  );
}
