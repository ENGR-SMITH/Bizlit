import { useState } from "react";
import { SignIn, SignUp } from "@clerk/clerk-react";
import { BarChart3, Binoculars, Mail } from "lucide-react";
import { configSummary } from "../lib/env";

/**
 * Clerk renders the form fields and runs the flow, but nothing else: this page
 * supplies the frame, headings and the sign-in / sign-up switcher. The widget is
 * themed to the workspace palette and its own header, logo and footer links are
 * hidden so it reads as part of our design rather than Clerk's default card —
 * and so nobody is ever bounced out to Clerk's hosted pages.
 */
const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: "#4f46e5",
    colorText: "#0f172a",
    colorTextSecondary: "#64748b",
    colorBackground: "#ffffff",
    colorInputBackground: "#ffffff",
    colorInputText: "#0f172a",
    colorDanger: "#e11d48",
    borderRadius: "0.5rem",
    fontFamily: "inherit",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full shadow-none",
    card: "w-full border-0 bg-transparent p-0 shadow-none",
    header: "hidden",
    headerTitle: "hidden",
    headerSubtitle: "hidden",
    logoBox: "hidden",
    logoImage: "hidden",
    footer: "hidden",
    footerAction: "hidden",
    socialButtonsBlockButton:
      "rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
    socialButtonsBlockButtonText: "text-xs font-medium text-slate-700",
    dividerLine: "bg-slate-200",
    dividerText: "text-[11px] text-slate-400",
    formFieldLabel: "text-xs font-medium text-slate-600",
    formFieldInput:
      "rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100",
    formFieldInputShowPasswordButton: "text-slate-400 hover:text-slate-600",
    formButtonPrimary: "rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700",
    identityPreview: "rounded-lg border border-slate-200 bg-slate-50",
    identityPreviewText: "text-xs text-slate-700",
    identityPreviewEditButton: "text-xs text-indigo-600",
    alert: "rounded-lg",
    alertText: "text-xs",
    otpCodeFieldInput: "rounded-lg border border-slate-300",
  },
} as const;

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
  const copy = COPY[mode];

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between bg-slate-900 px-10 py-12 text-slate-300 lg:flex">
        <div>
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt="BIZLIT logo"
              className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-white/10"
            />
            <div>
              <p className="text-base font-semibold text-white">BIZLIT</p>
              <p className="text-xs text-slate-400">Competitor monitoring</p>
            </div>
          </div>

          <h1 className="mt-12 max-w-md text-3xl font-semibold leading-tight text-white">
            Know what your competitors did — before your customers do.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-400">
            Create your account, tell us about your business once, and your dashboard fills with
            competitor price moves, new listings, ad signals, review drops and your own SEO and GEO
            scores.
          </p>

          <ul className="mt-10 space-y-4">
            {[
              { icon: <Binoculars size={16} />, title: "Competitor watch", body: "Their traffic, keyword gaps, social channels, ads, customer reviews and new listings." },
              { icon: <BarChart3 size={16} />, title: "Your own scores", body: "SEO, GEO, traffic, industry rank and the inventory you should stock next." },
              { icon: <Mail size={16} />, title: "Client messaging", body: "Scheduled alerts and check-ins to your own customers, on your cadence." },
            ].map((item) => (
              <li key={item.title} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-indigo-300">
                  {item.icon}
                </span>
                <div>
                  <p className="text-sm font-medium text-white">{item.title}</p>
                  <p className="text-xs text-slate-400">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[11px] text-slate-500">
          Auth: {configSummary.auth} · Data: {configSummary.database}
        </p>
      </aside>

      <main className="flex items-center justify-center bg-slate-50 px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-4 flex items-center justify-center gap-2 lg:hidden">
            <img
              src="/logo.png"
              alt="BIZLIT logo"
              className="h-9 w-9 shrink-0 rounded-xl object-cover"
            />
            <span className="text-base font-semibold text-slate-900">BIZLIT</span>
          </div>

          <a
            href="/"
            className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-indigo-600"
          >
            ← Back to home
          </a>

          {/* Our card, our headings, our switcher — Clerk only draws the form. */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">{copy.heading}</h2>
            <p className="mt-1 text-xs text-slate-500">{copy.sub}</p>

            <div className="mt-4 flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              {(
                [
                  { value: "sign-up", label: "Create account" },
                  { value: "sign-in", label: "I already have one" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => {
                    setMode(tab.value);
                    // Clerk is mounted on a real path, so keep the URL in step.
                    goToPath(tab.value === "sign-up" ? "/sign-up" : "/sign-in");
                  }}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    mode === tab.value
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-600 hover:bg-white hover:text-slate-900"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="mt-4">
              {mode === "sign-up" ? (
                <SignUp routing="path" path="/sign-up" appearance={CLERK_APPEARANCE} />
              ) : (
                <SignIn routing="path" path="/sign-in" appearance={CLERK_APPEARANCE} />
              )}
            </div>
          </div>

          <p className="mt-4 text-center text-[11px] text-slate-500">
            After signing up you will be asked a few questions about your business so the monitoring
            starts on the right competitors and clients.
          </p>
        </div>
      </main>
    </div>
  );
}
