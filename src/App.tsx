import { ClerkLoaded, ClerkLoading, SignedIn, SignedOut } from "@clerk/clerk-react";
import { AlertTriangle } from "lucide-react";
import { Layout } from "./components/Layout";
import { PullToRefresh } from "./components/PullToRefresh";
import { ToastProvider } from "./components/Toast";
import { btnPrimary } from "./components/primitives";
import { authEnabled } from "./lib/env";
import { useHashRoute, usePublicRoute } from "./lib/hooks";
import { RefreshProvider } from "./lib/refresh";
import { useWorkspace, WorkspaceLoading, WorkspaceProvider } from "./lib/workspace";
import { CompetitionPage } from "./pages/CompetitionPage";
import { ClientsPage } from "./pages/ClientsPage";
import { BusinessPage } from "./pages/BusinessPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { SocialPage } from "./pages/SocialPage";
import { InventoryPage } from "./pages/InventoryPage";
import { PromotionPage } from "./pages/PromotionPage";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { OnboardingPage } from "./pages/OnboardingPage";

function AppShell() {
  const { route, navigate } = useHashRoute();

  return (
    <Layout route={route} navigate={navigate}>
      {/* The monitoring pages share one workspace, so they share one drag-down
          refresh instead of a reload control each — including the review sync
          that Social & reviews used to run from a button of its own. */}
      {route === "competition" ? (
        <PullToRefresh>
          <CompetitionPage />
        </PullToRefresh>
      ) : null}
      {route === "clients" ? <ClientsPage /> : null}
      {route === "business" ? (
        <PullToRefresh>
          <BusinessPage />
        </PullToRefresh>
      ) : null}
      {route === "social" ? (
        <PullToRefresh>
          <SocialPage />
        </PullToRefresh>
      ) : null}
      {route === "inventory" ? <InventoryPage /> : null}
      {route === "promotion" ? <PromotionPage /> : null}
      {route === "notifications" ? <NotificationsPage /> : null}
    </Layout>
  );
}

function LoadError({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-rose-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-rose-600">
          <AlertTriangle size={18} />
          <p className="text-sm font-semibold">We could not load your workspace</p>
        </div>
        <p className="mt-2 text-xs text-slate-600">
          {message ?? "Check your Supabase connection settings and try again."}
        </p>
        <button type="button" className={`${btnPrimary} mt-4`} onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}

/** Signed out → the marketing landing page, or the auth screen behind it. */
function PublicArea() {
  const { route } = usePublicRoute();
  if (route === "sign-in" || route === "sign-up") {
    return <LoginPage initialMode={route} />;
  }
  return <LandingPage />;
}

/** Signed in → make sure the business profile exists before showing the app. */
function WorkspaceGate() {
  const { data, loading, error, needsOnboarding, refresh } = useWorkspace();

  if (loading) return <WorkspaceLoading />;
  if (needsOnboarding) return <OnboardingPage />;
  if (!data) return <LoadError message={error} onRetry={() => void refresh()} />;
  return <AppShell />;
}

export function App() {
  return (
    <ToastProvider>
      {authEnabled ? (
        <>
          {/*
           * Clerk's own `SignedIn`/`SignedOut` render **nothing at all** until
           * the session is resolved, and they are the only thing here — so while
           * Clerk initialises, or if it never finishes, the page was completely
           * blank. That is the worst possible failure: no spinner, no message, and
           * nothing to tell the user whether to wait or to look at the console.
           * The loader covers that gap; the boundary above it covers a crash.
           */}
          <ClerkLoading>
            <WorkspaceLoading label="Checking your session…" />
          </ClerkLoading>
          <ClerkLoaded>
            <SignedOut>
              <PublicArea />
            </SignedOut>
            <SignedIn>
              <WorkspaceProvider>
                <RefreshProvider>
                  <WorkspaceGate />
                </RefreshProvider>
              </WorkspaceProvider>
            </SignedIn>
          </ClerkLoaded>
        </>
      ) : (
        <WorkspaceProvider>
          {/* Above the shell, so the cap and the in-flight refresh are shared by
              every page rather than starting over on each navigation. */}
          <RefreshProvider>
            <AppShell />
          </RefreshProvider>
        </WorkspaceProvider>
      )}
    </ToastProvider>
  );
}
