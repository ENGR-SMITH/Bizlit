import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { odBtnSm, Container } from "./bits";
import { ThemeSwitch, useLandingDark } from "./theme";

/*
 * The odoo.com header: a flat white 60px bar pinned to the top, logo on the
 * left, the menu in the middle and the two account actions on the right. It
 * fades away as you scroll down and comes back the moment you scroll up, which
 * is how odoo.com's own `o_header_fade_out` bar behaves.
 *
 * "Sources" opens a full-width panel instead of a plain menu — the same shape
 * as Odoo's app mega-menu, laid out in groups.
 */

type PanelGroup = { title: string; items: string[] };

const LINKS: { id: string; label: string; panel?: PanelGroup[] }[] = [
  {
    id: "sources",
    label: "Sources",
    panel: [
      {
        title: "Watch",
        items: ["Competitor sites", "Supplier catalogues", "Price moves", "Stock moves", "Promotions"],
      },
      {
        title: "Measure",
        items: ["Google positions", "Local map pack", "AI answers (GEO)", "Traffic & channels", "Keyword gaps"],
      },
      {
        title: "Reach out",
        items: ["Customer lists", "Review replies", "Weekly digest", "Ad briefs", "Buy list"],
      },
    ],
  },
  { id: "screens", label: "Product" },
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "Help" },
];

function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function Header() {
  const [open, setOpen] = useState<string | null>(null);
  // The day/night choice is shared with the auth screens — see `./theme`.
  const [dark, setDark] = useLandingDark();
  const [mobile, setMobile] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const barRef = useRef<HTMLElement | null>(null);
  // Read through refs inside the scroll listener so it never needs re-binding.
  const menuOpen = useRef(false);
  menuOpen.current = open !== null || mobile;

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const goingDown = y > lastY.current;
      lastY.current = y;
      // Never hide the bar while a menu is open, or the menu goes with it.
      setHidden(goingDown && y > 320 && !menuOpen.current);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobile ? "hidden" : "unset";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [mobile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(null);
        setMobile(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(id: string) {
    setOpen(null);
    setMobile(false);
    jump(id);
  }

  return (
    <header
      ref={barRef}
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b border-[var(--od-border)] bg-[var(--od-surface)] transition-transform duration-300",
        hidden && "-translate-y-full",
      )}
    >
      <Container className="max-w-none px-4 lg:px-8">
        <div className="flex h-[60px] items-center justify-between gap-4">
          {/* logo */}
          <a href="/" className="flex shrink-0 items-center gap-2" aria-label="BIZLIT home">
            <img src="/logo.png" alt="" className="h-9 w-9 rounded-lg object-cover" />
            <span
              className="text-[2rem] leading-none font-bold tracking-tight text-[var(--od-ink)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              bizlit
            </span>
          </a>

          {/* primary nav */}
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
            {LINKS.map((link) => (
              <div key={link.id} className="relative">
                {link.panel ? (
                  <button
                    type="button"
                    aria-expanded={open === link.id}
                    onClick={() => setOpen(open === link.id ? null : link.id)}
                    className={cn(
                      "cursor-pointer rounded px-3 py-2 text-[15px] font-medium transition-colors",
                      open === link.id
                        ? "text-[var(--od-violet)]"
                        : "text-[var(--od-ink)] hover:text-[var(--od-violet)]",
                    )}
                  >
                    {link.label}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => go(link.id)}
                    className="cursor-pointer rounded px-3 py-2 text-[15px] font-medium text-[var(--od-ink)] transition-colors hover:text-[var(--od-violet)]"
                  >
                    {link.label}
                  </button>
                )}
              </div>
            ))}
          </nav>

          {/* account actions */}
          <div className="flex shrink-0 items-center gap-2">
            {/* day / night */}
            <ThemeSwitch dark={dark} onToggle={() => setDark((v) => !v)} className="me-1" />
            <a
              href="/sign-in"
              className="hidden px-3 py-2 text-[15px] font-medium text-[var(--od-ink)] transition-colors hover:text-[var(--od-violet)] sm:block"
            >
              Sign in
            </a>
            <a href="/sign-up" className={odBtnSm}>
              Start free
            </a>
            <button
              type="button"
              className="flex cursor-pointer items-center p-2 text-[var(--od-ink)] lg:hidden"
              aria-label={mobile ? "Close menu" : "Open menu"}
              aria-expanded={mobile}
              onClick={() => setMobile((v) => !v)}
            >
              {mobile ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </Container>

      {/* the sources panel */}
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="absolute inset-x-0 top-full hidden border-b border-[var(--od-border)] bg-[var(--od-surface)] shadow-[0_24px_40px_-24px_rgba(23,16,43,0.25)] lg:block"
          >
            <Container>
              <div className="grid gap-8 py-8 lg:grid-cols-[repeat(3,minmax(0,1fr))_1.2fr]">
                {LINKS.find((l) => l.id === open)?.panel?.map((group) => (
                  <div key={group.title}>
                    <p className="mb-3 text-xs font-semibold tracking-wider text-[var(--od-muted)] uppercase">
                      {group.title}
                    </p>
                    <ul className="space-y-2">
                      {group.items.map((item) => (
                        <li key={item}>
                          <button
                            type="button"
                            onClick={() => go("sources")}
                            className="cursor-pointer text-[15px] text-[var(--od-body)] transition-colors hover:text-[var(--od-violet)]"
                          >
                            {item}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

                <div className="rounded-lg bg-[var(--od-band)] p-5">
                  <p
                    className="text-2xl text-[var(--od-ink)]"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    Everything is scanned for you
                  </p>
                  <p className="mt-2 text-sm text-[var(--od-body)]">
                    Pick a cadence per source — daily, weekly or monthly — and the desk fills
                    itself in. No tabs to open, no spreadsheets to keep.
                  </p>
                  <button
                    type="button"
                    onClick={() => go("screens")}
                    className="mt-4 cursor-pointer text-sm font-semibold text-[var(--od-violet)] hover:underline"
                  >
                    See the workspace →
                  </button>
                </div>
              </div>
            </Container>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* mobile menu */}
      <AnimatePresence>
        {mobile ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden border-t border-[var(--od-border)] bg-[var(--od-surface)] lg:hidden"
          >
            <Container className="py-4">
              <ul className="divide-y divide-[var(--od-border)]">
                {LINKS.map((link) => (
                  <li key={link.id}>
                    <button
                      type="button"
                      onClick={() => go(link.id)}
                      className="w-full cursor-pointer py-3 text-left text-[15px] font-medium text-[var(--od-ink)]"
                    >
                      {link.label}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-col gap-2">
                <a href="/sign-in" className="od-btn od-btn-light">
                  Sign in
                </a>
                <a href="/sign-up" className="od-btn od-btn-primary">
                  Start free
                </a>
              </div>
            </Container>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
