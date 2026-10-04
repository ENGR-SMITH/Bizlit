import { useState } from "react";
import { SignIn, SignUp } from "@clerk/clerk-react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeSwitch, useLandingDark } from "../components/templates/odoo/theme";

/*
 * Sign up / sign in, wearing the landing page.
 *
 * The same frame opens the page: a white 60px bar with the `bizlit` mark in
 * Caveat on the left and the violet day/night switch on the right. The form
 * sits in one rounded card beside a deep-violet panel — the footer's own
 * violet, carrying the page's one display line — over the palest landing
 * band.
 *
 * Clerk renders the form fields and runs the flow, but nothing else: its
 * header, logo and footer links are suppressed, and its skin is driven from
 * the landing's palette. That suppression lives in `index.css` under
 * `.od-auth` — Clerk's stylesheet is unlayered, so a utility class can never
 * win against it. The page carries `theme-odoo`, so the switch flips it
 * exactly as it flips the landing — and the choice is remembered between the
 * two.
 */

/**
 * The Clerk widget's skin. The day and night values are the same ones
 * `--od-violet-solid` and friends hold in `index.css`; they are repeated here
 * because Clerk takes colours as values, not as CSS variables.
 */
function clerkAppearance(dark: boolean) {
  return {
    variables: {
      colorPrimary: dark ? "#7c3aed" : "#6d28d9",
      colorText: dark ? "#f3effe" : "#17102b",
      colorTextSecondary: dark ? "#948cb0" : "#6f6889",
      colorBackground: dark ? "#1c1333" : "#ffffff",
      colorInputBackground: dark ? "#1c1333" : "#ffffff",
      colorInputText: dark ? "#f3effe" : "#17102b",
      colorDanger: "#e11d48",
      borderRadius: "0.75rem",
      fontFamily: "inherit",
    },
    elements: {
      rootBox: "w-full",
      socialButtonsBlockButton:
        "rounded-xl border border-[var(--od-border)] bg-[var(--od-surface)] text-[var(--od-body)] hover:bg-[var(--od-band)]",
      socialButtonsBlockButtonText: "text-sm font-medium text-[var(--od-ink)]",
      dividerLine: "bg-[var(--od-border)]",
      dividerText: "text-[11px] text-[var(--od-muted)]",
      formFieldLabel: "text-xs font-semibold text-[var(--od-body)]",
      formFieldInput:
        "rounded-xl border border-[var(--od-border)] bg-[var(--od-surface)] text-sm text-[var(--od-ink)] focus:border-[var(--od-violet)] focus:ring-2 focus:ring-[rgba(109,40,217,0.16)]",
      formFieldInputShowPasswordButton: "text-[var(--od-muted)] hover:text-[var(--od-ink)]",
      formButtonPrimary:
        "rounded-xl bg-[var(--od-violet-solid)] text-sm font-semibold text-white hover:bg-[var(--od-violet-deep)]",
      identityPreview: "rounded-xl border border-[var(--od-border)] bg-[var(--od-band-soft)]",
      identityPreviewText: "text-xs text-[var(--od-body)]",
      identityPreviewEditButton: "text-xs text-[var(--od-violet)]",
      alert: "rounded-xl",
      alertText: "text-xs",
      otpCodeFieldInput: "rounded-xl border border-[var(--od-border)]",
    },
  };
}

/**
 * Move between the auth paths client-side. Clerk is mounted on real paths, so
 * the URL has to change with the tab — a reload would also work, this is just
 * smoother.
 */
function goToPath(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

const COPY = {
  "sign-up": {
    heading: "Create your account",
    sub: "Takes a minute — then we ask a few questions about your business.",
  },
  "sign-in": {
    heading: "Welcome back",
    sub: "Sign in to pick up where your monitoring left off.",
  },
} as const;

export function LoginPage({
  initialMode = "sign-up",
}: {
  initialMode?: "sign-in" | "sign-up";
}) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">(initialMode);
  const [dark, setDark] = useLandingDark();
  const copy = COPY[mode];

  return (
    <div
      className={cn(
        "theme-odoo od-auth flex min-h-screen flex-col bg-[var(--od-band-soft)]",
        dark && "theme-odoo-dark",
      )}
    >
      {/* The landing header, trimmed to what this page needs: the mark, the
          day/night switch, and the way home. */}
      <header className="border-b border-[var(--od-border)] bg-[var(--od-surface)]">
        <div className="mx-auto flex h-[60px] w-full max-w-[1120px] items-center justify-between gap-4 px-4">
          <a href="/" className="flex shrink-0 items-center gap-2" aria-label="BIZLIT home">
            <img src="/logo.png" alt="" className="h-9 w-9 rounded-lg object-cover" />
            <span
              className="text-[2rem] leading-none font-bold tracking-tight text-[var(--od-ink)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              bizlit
            </span>
          </a>

          <div className="flex items-center gap-3">
            <ThemeSwitch dark={dark} onToggle={() => setDark((v) => !v)} />
            <a
              href="/"
              className="hidden items-center gap-1.5 text-sm font-medium text-[var(--od-body)] no-underline transition-colors hover:text-[var(--od-violet)] sm:inline-flex"
            >
              <ArrowLeft size={15} />
              Back to home
            </a>
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-8 lg:py-12">
        <div className="grid w-full max-w-[1120px] overflow-hidden rounded-[1.5rem] border border-[var(--od-border)] bg-[var(--od-surface)] shadow-[0_40px_80px_-60px_rgba(23,16,43,0.6)] lg:grid-cols-[1.05fr_1fr]">
          {/* The footer's panel, standing beside the form. */}
          <aside className="od-auth-panel relative hidden flex-col items-center justify-center overflow-hidden p-10 text-center text-white lg:flex">
            <span
              aria-hidden
              className="pointer-events-none absolute -top-24 -right-20 h-72 w-72 rounded-full"
              style={{
                backgroundImage: "radial-gradient(circle, rgba(168,85,247,0.4), transparent 65%)",
              }}
            />

            <h1
              className="relative max-w-[16ch] text-[3.25rem] leading-[1.05] font-bold text-white"
              style={{ fontFamily: "var(--font-display)" }}
            >
              &ldquo;Know what your competitors did before your customers do.&rdquo;
            </h1>
          </aside>

          <section className="p-6 sm:p-9">
            <h2
              className="text-[2rem] leading-none font-bold text-[var(--od-ink)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {copy.heading}
            </h2>
            <p className="mt-2 text-sm text-[var(--od-muted)]">{copy.sub}</p>

            {/* Our card, our headings, our switcher — Clerk only draws the form. */}
            <div className="mt-6 flex rounded-full border border-[var(--od-border)] bg-[var(--od-band)] p-1">
              {(
                [
                  { value: "sign-in", label: "I already have one" },
                  { value: "sign-up", label: "Create account" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  aria-pressed={mode === tab.value}
                  onClick={() => {
                    setMode(tab.value);
                    // Clerk is mounted on a real path, so keep the URL in step.
                    goToPath(tab.value === "sign-up" ? "/sign-up" : "/sign-in");
                  }}
                  className={cn(
                    "flex-1 cursor-pointer rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                    mode === tab.value
                      ? "bg-[var(--od-violet-solid)] text-white shadow-[0_12px_24px_-14px_rgba(109,40,217,0.9)]"
                      : "text-[var(--od-body)] hover:text-[var(--od-ink)]",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="mt-6">
              {mode === "sign-up" ? (
                <SignUp routing="path" path="/sign-up" appearance={clerkAppearance(dark)} />
              ) : (
                <SignIn routing="path" path="/sign-in" appearance={clerkAppearance(dark)} />
              )}
            </div>

            <p className="mt-6 text-center text-xs text-[var(--od-muted)]">
              After signing up you will be asked a few questions about your business so the
              monitoring starts on the right competitors and clients.
            </p>
          </section>
        </div>
      </main>

      <footer className="px-4 pb-8 text-center text-xs text-[var(--od-muted)]">
        No credit card required · Cancel whenever you like
      </footer>
    </div>
  );
}
