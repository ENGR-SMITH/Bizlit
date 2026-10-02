import { useMemo, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Globe2,
  Loader2,
  Mail,
  Plus,
  Store,
  Target,
  Trash2,
  Users,
} from "lucide-react";
import {
  Badge,
  Card,
  CardHead,
  CheckboxChip,
  Field,
  btnGhost,
  btnPrimary,
  inputClass,
} from "../components/primitives";
import { LogoUpload } from "../components/LogoUpload";
import { SocialSuggestions, useSuggestionChoices } from "../components/SocialSuggestions";
import { useWorkspace } from "../lib/workspace";
import {
  AD_PLATFORMS,
  CURRENCIES,
  GOALS,
  INDUSTRIES,
  CUSTOMER_MESSAGE_TYPES,
  PLATFORM_TYPES,
  REPORT_DAYS,
  SOCIAL_PLATFORMS,
  TEAM_SIZES,
  detectedTimezone,
} from "../lib/options";
import { normaliseWebsite, titleCase } from "../lib/format";
import {
  // The keys the gateway scrapes against, not the display labels in `../lib/options`.
  SOCIAL_PLATFORMS as SOCIAL_PLATFORM_KEYS,
  normaliseSocialHandle,
  platformLabel,
} from "../lib/social";
import type {
  Cadence,
  ClientSeedInput,
  ContactDiscoveryResult,
  MonitoringSourceInput,
  OnboardingInput,
  SendFrequency,
} from "../lib/types";

const STEPS = [
  { id: "business", title: "Your business", body: "Who you are and what you sell", icon: <Building2 size={16} /> },
  { id: "presence", title: "Online presence", body: "Your site, socials and ad channels", icon: <Globe2 size={16} /> },
  { id: "competitors", title: "Competitors", body: "The businesses you track", icon: <Target size={16} /> },
  { id: "clients", title: "Clients & messaging", body: "Who gets your updates", icon: <Mail size={16} /> },
  { id: "goals", title: "Goals & confirm", body: "What winning looks like", icon: <CheckCircle2 size={16} /> },
];

function emptySource(cadence: Cadence, category = ""): MonitoringSourceInput {
  return { name: "", website: "", category, cadence };
}

export function OnboardingPage() {
  const { user } = useUser();
  const { completeOnboarding, profile, actions } = useWorkspace();
  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");

  const [form, setForm] = useState<OnboardingInput>(() => ({
    brandName: "",
    legalName: "",
    industry: INDUSTRIES[0],
    niche: "",
    primaryDomain: "",
    secondaryDomains: [],
    platformType: "website",
    country: "",
    currency: "USD",
    timezone: detectedTimezone(),
    teamSize: TEAM_SIZES[1],
    primaryGoal: GOALS[0],
    goals: [GOALS[0], GOALS[1]],
    adPlatforms: ["Meta Ads", "Google Ads"],
    socialHandles: {},
    notificationEmail: email,
    reportDay: "Friday",
    competitors: [emptySource("daily")],
    clientCadence: "weekly",
    clientMessageTypes: ["new_stock", "deals"],
    loginEmail: email,
    signature: "",
    seedClients: [],
  }));

  const patch = (changes: Partial<OnboardingInput>) => setForm((prev) => ({ ...prev, ...changes }));

  /**
   * The competitor social section: which card is expanded, and the handle being
   * typed into it. One open at a time and one draft, because the section is an
   * accordion — this is already the longest step in the wizard, and it has to stay
   * scannable at the moment the user least wants a wall of inputs.
   */
  const [socialsOpenFor, setSocialsOpenFor] = useState<number | null>(null);
  const [socialDraft, setSocialDraft] = useState<{ platform: string; handle: string }>({
    platform: SOCIAL_PLATFORM_KEYS[0],
    handle: "",
  });
  const [socialError, setSocialError] = useState<string | null>(null);

  /** The same accordion, for reading a competitor's own site instead of typing. */
  const [discoveryOpenFor, setDiscoveryOpenFor] = useState<number | null>(null);
  const [discovery, setDiscovery] = useState<ContactDiscoveryResult | null>(null);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discoveryNote, setDiscoveryNote] = useState<string | null>(null);
  const {
    choices: discoveryChoices,
    toggle: toggleChoice,
    edit: editChoice,
    accepted,
  } = useSuggestionChoices(discovery);

  const filledCompetitors = form.competitors.filter((c) => c.name.trim() || c.website.trim());
  const filledClients = form.seedClients.filter((c) => c.email.trim());
  const recordedSocials = filledCompetitors.reduce(
    (total, c) => total + (c.socials?.length ?? 0),
    0,
  );

  const stepError = useMemo(() => {
    if (step === 0 && !form.brandName.trim()) return "Enter your business name to continue.";
    if (step === 0 && !form.industry.trim()) return "Pick the industry you sell in.";
    if (step === 2 && filledCompetitors.some((c) => !c.website.trim()))
      return "Every competitor needs a website address.";
    // Checked here rather than after normalising, at submit: a domain that cannot
    // be read as one is caught while the user is still on the step, instead of
    // being stored as an empty website no scan can open.
    if (step === 2 && filledCompetitors.some((c) => !normaliseWebsite(c.website)))
      return "That competitor website does not look like a web address — try rival.com.";
    if (step === 3 && form.clientMessageTypes.length === 0)
      return "Choose at least one kind of message your clients receive.";
    return null;
  }, [step, form, filledCompetitors]);

  function updateSource(
    key: "competitors",
    index: number,
    changes: Partial<MonitoringSourceInput>,
  ) {
    patch({
      [key]: form[key].map((row, i) => (i === index ? { ...row, ...changes } : row)),
    } as Partial<OnboardingInput>);
  }

  function addSource(key: "competitors") {
    patch({
      [key]: [...form[key], emptySource("daily")],
    } as Partial<OnboardingInput>);
  }

  function removeSource(key: "competitors", index: number) {
    const next = form[key].filter((_, i) => i !== index);
    patch({ [key]: next.length ? next : [emptySource("daily")] } as Partial<OnboardingInput>);
  }

  function toggleSocials(index: number) {
    setSocialsOpenFor((open) => (open === index ? null : index));
    setSocialError(null);
    setSocialDraft({ platform: SOCIAL_PLATFORM_KEYS[0], handle: "" });
  }

  /**
   * Records the typed handle against one competitor.
   *
   * The handle is reduced to the bare username first — the same rule the
   * Competition page enforces, and the reason a pasted profile URL does not end up
   * embedded inside the URL the scraper builds, which would quietly return nothing.
   *
   * Adding a platform that is already recorded replaces it instead of erroring,
   * which is what both the unique index and `mergeSocialChannel` do: one handle per
   * platform is the model, so a duplicate is a correction, not a mistake.
   */
  function addSocial(index: number) {
    const handle = normaliseSocialHandle(socialDraft.handle);
    if (!handle) {
      setSocialError("Add their handle or paste the profile URL — e.g. @glowmartbeauty.");
      return;
    }

    const existing = form.competitors[index]?.socials ?? [];
    updateSource("competitors", index, {
      socials: [
        ...existing.filter((row) => row.platform !== socialDraft.platform),
        { platform: socialDraft.platform, handle },
      ],
    });
    setSocialDraft({ platform: socialDraft.platform, handle: "" });
    setSocialError(null);
  }

  function toggleDiscovery(index: number) {
    setDiscoveryOpenFor((open) => (open === index ? null : index));
    setDiscoveryNote(null);
    setDiscovery(null);
  }

  /**
   * Asks the gateway to read one competitor's website.
   *
   * Preview mode, because this runs before the competitor row exists. It authors
   * nothing: the proposals come back here and only a human accepting them writes
   * anything, which is what stops a footer link to the site's web agency becoming
   * a billed scrape target.
   */
  async function findSocials(index: number) {
    const website = normaliseWebsite(form.competitors[index]?.website ?? "");
    if (!website) {
      setDiscoveryNote("Add their website first — that is what gets read.");
      return;
    }

    setDiscoveryBusy(true);
    setDiscoveryNote(null);
    try {
      const result = await actions.previewCompetitorSocials({
        url: website,
        label: form.competitors[index]?.name,
      });

      if (!result) {
        setDiscoveryNote("Discovery is not available in this mode — add their handles by hand.");
        return;
      }
      if (result.status === "unavailable") {
        setDiscoveryNote(result.reason ?? "Discovery is not configured on this deployment.");
        return;
      }
      if (result.status === "running") {
        setDiscoveryNote(
          "Their site is still being read. Check again in a moment — the same run is picked up, not a new one.",
        );
        return;
      }
      if (result.status === "failed") {
        setDiscoveryNote(result.reason ?? "Their website could not be read.");
        return;
      }
      setDiscovery(result);
    } catch (cause) {
      setDiscoveryNote(cause instanceof Error ? cause.message : "Their website could not be read.");
    } finally {
      setDiscoveryBusy(false);
    }
  }

  /** Adds the ticked proposals to this competitor, replacing any platform already held. */
  function acceptFound(index: number) {
    const handles = accepted
      .map((row) => ({ ...row, handle: normaliseSocialHandle(row.handle) }))
      .filter((row) => row.handle);
    if (!handles.length) {
      setDiscoveryNote("That handle does not look like a profile — check it and try again.");
      return;
    }

    const platforms = new Set(handles.map((row) => row.platform));
    const existing = form.competitors[index]?.socials ?? [];
    updateSource("competitors", index, {
      socials: [...existing.filter((row) => !platforms.has(row.platform)), ...handles],
    });
    setDiscovery(null);
    setDiscoveryNote(null);
  }

  function removeSocial(index: number, platform: string) {
    const existing = form.competitors[index]?.socials ?? [];
    updateSource("competitors", index, {
      socials: existing.filter((row) => row.platform !== platform),
    });
  }

  function updateSeedClient(index: number, changes: Partial<ClientSeedInput>) {
    patch({
      seedClients: form.seedClients.map((row, i) => (i === index ? { ...row, ...changes } : row)),
    });
  }

  function chooseLogo(file: File) {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  function clearLogo() {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(null);
    setLogoPreview("");
  }

  async function finish() {
    setSubmitting(true);
    setError(null);
    try {
      await completeOnboarding({
        ...form,
        notificationEmail: form.notificationEmail || email,
        loginEmail: form.loginEmail || email,
        // One normaliser for the whole app, so a site typed as "rival.com" is
        // stored as the same URL the add/edit forms would store. Without it, the
        // same competitor can arrive twice under two spellings, and a scrape built
        // from a bare host is not a URL at all.
        competitors: filledCompetitors.map((c) => ({ ...c, website: normaliseWebsite(c.website) })),
        seedClients: filledClients,
      });
      // Uploaded after the business row exists, because the file is stored
      // under the signed-in user's folder in the brand-assets bucket.
      if (logoFile) await actions.uploadLogo(logoFile);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not save your answers. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt="BIZLIT logo"
              className="h-10 w-10 shrink-0 rounded-xl object-cover"
            />
            <div>
              <p className="text-base font-semibold text-slate-900">
                {profile?.onboardingComplete ? "Business settings" : "Set up your monitoring"}
              </p>
              <p className="text-xs text-slate-500">
                {email ? `Signed in as ${email}` : "A few questions so the app works for your business"}
              </p>
            </div>
          </div>
          <Badge tone="brand">
            Step {step + 1} of {STEPS.length}
          </Badge>
        </header>

        <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
          <nav className="h-max rounded-xl border border-slate-200 bg-white p-2">
            <ol className="space-y-1">
              {STEPS.map((s, i) => {
                const done = i < step;
                const active = i === step;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => (i <= step ? setStep(i) : undefined)}
                      className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition ${
                        active ? "bg-indigo-50" : done ? "hover:bg-slate-50" : "opacity-60"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                          active
                            ? "bg-indigo-600 text-white"
                            : done
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {done ? <Check size={12} /> : i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-medium text-slate-800">{s.title}</span>
                        <span className="block text-[11px] text-slate-500">{s.body}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="space-y-5">
            {step === 0 ? (
              <Card>
                <CardHead
                  icon={<Building2 size={16} />}
                  title="Tell us about your business"
                  subtitle="This drives which competitors and keywords we monitor"
                />
                <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
                  <Field label="Business / brand name">
                    <input
                      className={inputClass}
                      placeholder="e.g. Glow House Store"
                      value={form.brandName}
                      onChange={(e) => patch({ brandName: e.target.value })}
                    />
                  </Field>
                  <Field label="Registered name (optional)">
                    <input
                      className={inputClass}
                      placeholder="e.g. Glow House Ltd"
                      value={form.legalName}
                      onChange={(e) => patch({ legalName: e.target.value })}
                    />
                  </Field>
                  <Field label="Industry">
                    <select
                      className={inputClass}
                      value={form.industry}
                      onChange={(e) => patch({ industry: e.target.value })}
                    >
                      {INDUSTRIES.map((i) => (
                        <option key={i}>{i}</option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Niche you sell in"
                    hint="Be specific — beauty, phones, boutique fashion instead of a brand"
                  >
                    <input
                      className={inputClass}
                      placeholder="e.g. vegan cosmetics"
                      value={form.niche}
                      onChange={(e) => patch({ niche: e.target.value })}
                    />
                  </Field>
                  <Field label="Country / market">
                    <input
                      className={inputClass}
                      placeholder="e.g. Kenya"
                      value={form.country}
                      onChange={(e) => patch({ country: e.target.value })}
                    />
                  </Field>
                  <Field label="Currency">
                    <select
                      className={inputClass}
                      value={form.currency}
                      onChange={(e) => patch({ currency: e.target.value })}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Timezone">
                    <input
                      className={inputClass}
                      value={form.timezone}
                      onChange={(e) => patch({ timezone: e.target.value })}
                    />
                  </Field>
                  <Field label="Team size">
                    <select
                      className={inputClass}
                      value={form.teamSize}
                      onChange={(e) => patch({ teamSize: e.target.value })}
                    >
                      {TEAM_SIZES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="border-t border-slate-100 px-4 py-4">
                  <p className="mb-3 text-xs font-medium text-slate-600">
                    Business logo <span className="font-normal text-slate-400">(optional)</span>
                  </p>
                  <LogoUpload
                    logoUrl={logoPreview}
                    brandName={form.brandName}
                    onPick={chooseLogo}
                    onRemove={clearLogo}
                    hint="Shown in your sidebar so you always know which workspace you are in."
                  />
                </div>
              </Card>
            ) : null}

            {step === 1 ? (
              <Card>
                <CardHead
                  icon={<Globe2 size={16} />}
                  title="Your online presence"
                  subtitle="We score SEO, GEO and social for these properties"
                />
                <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
                  <Field label="Main website domain">
                    <input
                      className={inputClass}
                      placeholder="yourstore.com"
                      value={form.primaryDomain}
                      onChange={(e) => patch({ primaryDomain: e.target.value })}
                    />
                  </Field>
                  <Field label="Other domains" hint="Comma separated, e.g. shop.yourstore.com">
                    <input
                      className={inputClass}
                      placeholder="shop.yourstore.com"
                      value={form.secondaryDomains.join(", ")}
                      onChange={(e) =>
                        patch({
                          secondaryDomains: e.target.value
                            .split(",")
                            .map((d) => d.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </Field>
                  <Field label="Where you sell">
                    <select
                      className={inputClass}
                      value={form.platformType}
                      onChange={(e) => patch({ platformType: e.target.value })}
                    >
                      {PLATFORM_TYPES.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Email for alerts and reports">
                    <input
                      className={inputClass}
                      placeholder={email || "you@yourstore.com"}
                      value={form.notificationEmail}
                      onChange={(e) => patch({ notificationEmail: e.target.value })}
                    />
                  </Field>
                </div>

                <div className="border-t border-slate-100 px-4 py-4">
                  <p className="mb-2 text-xs font-medium text-slate-600">Social accounts you run</p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {SOCIAL_PLATFORMS.map((platform) => (
                      <Field key={platform} label={platform}>
                        <input
                          className={inputClass}
                          placeholder="@handle"
                          value={form.socialHandles[platform] ?? ""}
                          onChange={(e) =>
                            patch({
                              socialHandles: { ...form.socialHandles, [platform]: e.target.value },
                            })
                          }
                        />
                      </Field>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-100 px-4 py-4">
                  <p className="mb-2 text-xs font-medium text-slate-600">
                    Where do you advertise?
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {AD_PLATFORMS.map((platform) => (
                      <CheckboxChip
                        key={platform}
                        checked={form.adPlatforms.includes(platform)}
                        onChange={() =>
                          patch({
                            adPlatforms: form.adPlatforms.includes(platform)
                              ? form.adPlatforms.filter((p) => p !== platform)
                              : [...form.adPlatforms, platform],
                          })
                        }
                      >
                        {platform}
                      </CheckboxChip>
                    ))}
                  </div>
                </div>
              </Card>
            ) : null}

            {step === 2 ? (
              <Card>
                <CardHead
                  icon={<Target size={16} />}
                  title="Which competitors do you want to track?"
                  subtitle="We compare their traffic, keywords, ads, socials and customer reviews against yours"
                />
                <div className="space-y-3 px-4 py-4">
                  {form.competitors.map((source, index) => {
                    const socials = source.socials ?? [];
                    const open = socialsOpenFor === index;
                    return (
                      <div
                        key={`competitor-${index}`}
                        className="rounded-xl border border-slate-200 p-3"
                      >
                        <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto]">
                          <Field label="Competitor name">
                            <input
                              className={inputClass}
                              placeholder="e.g. GlowMart Beauty"
                              value={source.name}
                              onChange={(e) =>
                                updateSource("competitors", index, { name: e.target.value })
                              }
                            />
                          </Field>
                          <Field label="Website">
                            <input
                              className={inputClass}
                              placeholder="https://competitor.com"
                              value={source.website}
                              onChange={(e) =>
                                updateSource("competitors", index, { website: e.target.value })
                              }
                            />
                          </Field>
                          <div className="flex items-end">
                            <button
                              type="button"
                              onClick={() => removeSource("competitors", index)}
                              className="rounded-lg border border-slate-300 p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                              aria-label="Remove competitor"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        {/* Collapsed by default: the socials are worth offering
                            here, next to the website they were read from, but they
                            must not be what the user has to scroll past. */}
                        <div className="mt-3 border-t border-slate-100 pt-3">
                          <button
                            type="button"
                            onClick={() => toggleSocials(index)}
                            aria-expanded={open}
                            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                          >
                            <ChevronDown
                              size={13}
                              className={`transition ${open ? "rotate-180" : ""}`}
                            />
                            Add their social profiles
                            {socials.length ? (
                              <span className="font-normal text-slate-500">
                                — {socials.length} recorded
                              </span>
                            ) : null}
                          </button>

                          {open ? (
                            <div className="mt-2.5 space-y-2.5">
                              <p className="text-[11px] text-slate-500">
                                Optional. Their public posts are read as a market signal — never
                                republished as your own creative.
                              </p>
                              <div className="flex flex-wrap items-end gap-2">
                                <div className="w-40">
                                  <Field label="Platform">
                                    <select
                                      className={inputClass}
                                      aria-label="Platform"
                                      value={socialDraft.platform}
                                      onChange={(e) =>
                                        setSocialDraft({
                                          ...socialDraft,
                                          platform: e.target.value,
                                        })
                                      }
                                    >
                                      {SOCIAL_PLATFORM_KEYS.map((platform) => (
                                        <option key={platform} value={platform}>
                                          {platformLabel(platform)}
                                        </option>
                                      ))}
                                    </select>
                                  </Field>
                                </div>
                                <div className="min-w-52 flex-1">
                                  <Field
                                    label="Handle or profile URL"
                                    hint="@brand, brand and a pasted profile URL all save the same handle."
                                  >
                                    <input
                                      className={inputClass}
                                      placeholder="@glowmartbeauty"
                                      value={socialDraft.handle}
                                      onChange={(e) =>
                                        setSocialDraft({ ...socialDraft, handle: e.target.value })
                                      }
                                    />
                                  </Field>
                                </div>
                                <button
                                  type="button"
                                  className={btnGhost}
                                  onClick={() => addSocial(index)}
                                >
                                  <Plus size={14} /> Add
                                </button>
                              </div>

                              {socialError ? (
                                <p className="text-[11px] text-amber-600">{socialError}</p>
                              ) : null}

                              {socials.length ? (
                                <ul className="space-y-1.5">
                                  {socials.map((row) => (
                                    <li
                                      key={row.platform}
                                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5"
                                    >
                                      <span className="text-xs text-slate-700">
                                        <span className="font-medium">
                                          {platformLabel(row.platform)}
                                        </span>
                                        {" · "}
                                        {row.handle}
                                      </span>
                                      <button
                                        type="button"
                                        aria-label={`Remove ${platformLabel(row.platform)} profile`}
                                        onClick={() => removeSocial(index, row.platform)}
                                        className="rounded p-1 text-slate-400 transition hover:bg-white hover:text-rose-600"
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          ) : null}
                        </div>

                        {/* The second way in, next to the first: read their site and
                            propose what it finds, rather than typing the handles. */}
                        <div className="mt-2 border-t border-slate-100 pt-3">
                          <button
                            type="button"
                            onClick={() => toggleDiscovery(index)}
                            aria-expanded={discoveryOpenFor === index}
                            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                          >
                            <ChevronDown
                              size={13}
                              className={`transition ${
                                discoveryOpenFor === index ? "rotate-180" : ""
                              }`}
                            />
                            Find them automatically
                          </button>

                          {discoveryOpenFor === index ? (
                            <div className="mt-2.5 space-y-2.5">
                              <p className="text-[11px] text-slate-500">
                                We read their website and propose the profiles it mentions. You choose
                                what to keep — nothing is saved from the read alone.
                              </p>
                              <button
                                type="button"
                                className={btnGhost}
                                disabled={discoveryBusy}
                                onClick={() => void findSocials(index)}
                              >
                                {discoveryBusy ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <Globe2 size={13} />
                                )}
                                {discoveryBusy ? "Reading their site…" : "Read their website"}
                              </button>

                              {discoveryNote ? (
                                <p className="text-[11px] text-amber-600">{discoveryNote}</p>
                              ) : null}

                              {discovery ? (
                                <>
                                  <SocialSuggestions
                                    result={discovery}
                                    choices={discoveryChoices}
                                    onToggle={toggleChoice}
                                    onEdit={editChoice}
                                  />
                                  <button
                                    type="button"
                                    className={btnPrimary}
                                    disabled={!accepted.length}
                                    onClick={() => acceptFound(index)}
                                  >
                                    <Plus size={14} /> Add {accepted.length} profile
                                    {accepted.length === 1 ? "" : "s"}
                                  </button>
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  <button type="button" className={btnGhost} onClick={() => addSource("competitors")}>
                    <Plus size={14} /> Add another competitor
                  </button>
                  <p className="text-[11px] text-slate-500">
                    You can leave this blank and add competitors later from the Competition page.
                  </p>
                </div>
              </Card>
            ) : null}

            {step === 3 ? (
              <Card>
                <CardHead
                  icon={<Users size={16} />}
                  title="Clients and the messages they receive"
                  subtitle="Your own retail customers — the people this service is sold to"
                />
                <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
                  <Field
                    label="Email address you send from"
                    hint="Used as the login and reply-to for client updates"
                  >
                    <input
                      className={inputClass}
                      placeholder={email || "watch@yourstore.com"}
                      value={form.loginEmail}
                      onChange={(e) => patch({ loginEmail: e.target.value })}
                    />
                  </Field>
                  <Field label="Default messaging frequency">
                    <select
                      className={inputClass}
                      value={form.clientCadence}
                      onChange={(e) => patch({ clientCadence: e.target.value as SendFrequency })}
                    >
                      <option value="every_2_days">Every 2 days</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Email signature">
                      <textarea
                        className={`${inputClass} h-20 resize-none`}
                        placeholder="— BIZLIT Desk · alerts for your store"
                        value={form.signature}
                        onChange={(e) => patch({ signature: e.target.value })}
                      />
                    </Field>
                  </div>
                </div>

                <div className="border-t border-slate-100 px-4 py-4">
                  <p className="mb-2 text-xs font-medium text-slate-600">
                    Default message types clients receive
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {CUSTOMER_MESSAGE_TYPES.map((type) => (
                      <CheckboxChip
                        key={type.value}
                        checked={form.clientMessageTypes.includes(type.value)}
                        onChange={() =>
                          patch({
                            clientMessageTypes: form.clientMessageTypes.includes(type.value)
                              ? form.clientMessageTypes.filter((t) => t !== type.value)
                              : [...form.clientMessageTypes, type.value],
                          })
                        }
                      >
                        {type.label}
                      </CheckboxChip>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-100 px-4 py-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-slate-600">
                      Current active customers ({form.seedClients.length})
                    </p>
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() =>
                        patch({
                          seedClients: [
                            ...form.seedClients,
                            {
                              name: "",
                              email: "",
                              company: "",
                              frequency: form.clientCadence,
                              messageTypes: form.clientMessageTypes,
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={14} /> Add customer
                    </button>
                  </div>

                  {form.seedClients.length === 0 ? (
                    <p className="rounded-lg bg-slate-50 px-3 py-3 text-[11px] text-slate-500">
                      No customers yet. You can add your customer list now, or from the Clients page
                      after setup.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {form.seedClients.map((client, index) => (
                        <div
                          key={`client-${index}`}
                          className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_1.2fr_1fr_auto]"
                        >
                          <Field label="Customer name">
                            <input
                              className={inputClass}
                              placeholder="e.g. Aisha Bello"
                              value={client.name}
                              onChange={(e) => updateSeedClient(index, { name: e.target.value })}
                            />
                          </Field>
                          <Field label="Email">
                            <input
                              className={inputClass}
                              placeholder="name@theirstore.com"
                              value={client.email}
                              onChange={(e) => updateSeedClient(index, { email: e.target.value })}
                            />
                          </Field>
                          <Field label="Store">
                            <input
                              className={inputClass}
                              placeholder="e.g. Glow House Store"
                              value={client.company}
                              onChange={(e) => updateSeedClient(index, { company: e.target.value })}
                            />
                          </Field>
                          <div className="flex items-end">
                            <button
                              type="button"
                              onClick={() =>
                                patch({
                                  seedClients: form.seedClients.filter((_, i) => i !== index),
                                })
                              }
                              className="rounded-lg border border-slate-300 p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                              aria-label="Remove customer"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            ) : null}

            {step === 4 ? (
              <Card>
                <CardHead
                  icon={<Store size={16} />}
                  title="What does winning look like?"
                  subtitle="We use this to rank your weekly report and the stock recommendations"
                />
                <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
                  <Field label="Main goal right now">
                    <select
                      className={inputClass}
                      value={form.primaryGoal}
                      onChange={(e) => patch({ primaryGoal: e.target.value })}
                    >
                      {GOALS.map((g) => (
                        <option key={g}>{g}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Weekly report day">
                    <select
                      className={inputClass}
                      value={form.reportDay}
                      onChange={(e) => patch({ reportDay: e.target.value })}
                    >
                      {REPORT_DAYS.map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>
                  </Field>
                  <div className="sm:col-span-2">
                    <p className="mb-2 text-xs font-medium text-slate-600">Everything that matters to you</p>
                    <div className="flex flex-wrap gap-2">
                      {GOALS.map((goal) => (
                        <CheckboxChip
                          key={goal}
                          checked={form.goals.includes(goal)}
                          onChange={() =>
                            patch({
                              goals: form.goals.includes(goal)
                                ? form.goals.filter((g) => g !== goal)
                                : [...form.goals, goal],
                            })
                          }
                        >
                          {goal}
                        </CheckboxChip>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-100 px-4 py-4">
                  <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Confirm your setup
                  </p>
                  <dl className="grid gap-2 sm:grid-cols-2">
                    {[
                      { label: "Business", value: form.brandName || "—" },
                      { label: "Industry", value: form.industry },
                      { label: "Website", value: form.primaryDomain || "—" },
                      { label: "Alerts to", value: form.notificationEmail || email || "—" },
                      { label: "Competitors monitored", value: `${filledCompetitors.length}` },
                      { label: "Social profiles recorded", value: `${recordedSocials}` },
                      { label: "Clients receiving updates", value: `${filledClients.length}` },
                      {
                        label: "Message types",
                        value: form.clientMessageTypes.map((t) => titleCase(t)).join(", ") || "—",
                      },
                    ].map((row) => (
                      <div key={row.label} className="rounded-lg bg-slate-50 px-3 py-2">
                        <dt className="text-[10px] tracking-wide text-slate-500 uppercase">{row.label}</dt>
                        <dd className="text-xs font-medium text-slate-800">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </Card>
            ) : null}

            {error ? (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200 ring-inset">
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                className={btnGhost}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
              >
                <ArrowLeft size={14} /> Back
              </button>

              <div className="flex items-center gap-3">
                {stepError ? <span className="text-[11px] text-amber-600">{stepError}</span> : null}
                {step < STEPS.length - 1 ? (
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={Boolean(stepError)}
                    onClick={() => setStep((s) => s + 1)}
                  >
                    Continue <ArrowRight size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={submitting}
                    onClick={finish}
                  >
                    {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {submitting ? "Creating your workspace…" : "Finish setup"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
