import { useMemo, useState } from "react";
import {
  CalendarClock,
  Mail,
  MessageSquare,
  Plus,
  Send,
  Settings2,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Badge,
  Card,
  CardHead,
  CheckboxChip,
  Detail,
  EmptyState,
  Field,
  Segmented,
  Stat,
  Tabs,
  Td,
  Th,
  btnGhost,
  btnPrimary,
  inputClass,
} from "../components/primitives";
import { CustomerTable } from "../components/customer-table";
import { Modal } from "../components/Modal";
import { useActionToast, useToast, type ActionMessages } from "../components/Toast";
import { cadenceLabel, daysAhead, money, relativeTime, shortDate, titleCase } from "../lib/format";
import { CUSTOMER_MESSAGE_TYPES } from "../lib/options";
import { useWorkspace, useWorkspaceData } from "../lib/workspace";
import type { Client, MailAccount, MessageType, SendFrequency } from "../lib/types";

type ClientTab = "customers" | "schedule" | "activity";

const FREQUENCIES: { value: SendFrequency; label: string; days: number }[] = [
  { value: "every_2_days", label: "Every 2 days", days: 2 },
  { value: "daily", label: "Daily", days: 1 },
  { value: "weekly", label: "Weekly", days: 7 },
  { value: "monthly", label: "Monthly", days: 30 },
];

const TIER_FEE: Record<Client["tier"], number> = { starter: 180, growth: 320, premium: 480 };

const EMPTY_FORM = {
  name: "",
  email: "",
  company: "",
  industry: "Beauty & cosmetics",
  tier: "starter" as Client["tier"],
};

function subjectFor(client: Client, types: MessageType[]): string {
  const primary = types[0] ?? "weekly_report";
  switch (primary) {
    case "new_stock":
      return `New at your competitors, ${client.company}`;
    case "two_day_checkin":
      return `Mid-week check-in — 3 moves worth knowing`;
    case "platform_info":
      return `New data on your BIZLIT desk`;
    case "deals":
      return `Live deals you can promote today`;
    case "competitor_alert":
      return `Competitor alert: price and promo changes`;
    case "review_update":
      return `Review scan: latest customer feedback`;
    default:
      return `Your weekly market watch report`;
  }
}

export function ClientsPage() {
  const toast = useToast();
  const actionToast = useActionToast();
  const workspace = useWorkspaceData();
  const { actions } = useWorkspace();
  const clients = workspace.clients;
  const sent = workspace.sentMessages;
  const [account, setAccount] = useState<MailAccount>(workspace.mailAccount);

  const [tab, setTab] = useState<ClientTab>("customers");
  const [addOpen, setAddOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [openClientId, setOpenClientId] = useState<string | null>(null);

  const [queued, setQueued] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<"active" | "paused" | "prospect" | "all">("active");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);

  const openClient = clients.find((c) => c.id === openClientId) ?? null;

  const visible = clients
    .filter((c) => (statusFilter === "all" ? true : c.status === statusFilter))
    .filter((c) =>
      search.trim() === ""
        ? true
        : `${c.name} ${c.email} ${c.company}`.toLowerCase().includes(search.trim().toLowerCase()),
    );

  const dueQueue = useMemo(
    () =>
      [...clients]
        .filter((c) => c.status !== "paused")
        .sort((a, b) => new Date(a.nextSendAt).getTime() - new Date(b.nextSendAt).getTime()),
    [clients],
  );

  const stats = useMemo(() => {
    const active = clients.filter((c) => c.status === "active");
    const avgOpen = active.length
      ? Math.round(active.reduce((sum, c) => sum + c.openRate, 0) / active.length)
      : 0;
    return { active: active.length, total: clients.length, avgOpen };
  }, [clients]);

  function updateClient(id: string, patch: Partial<Client>, messages: ActionMessages) {
    void actionToast(() => actions.updateClient(id, patch), messages);
  }

  function addClient() {
    if (!form.name.trim() || !form.email.trim()) {
      toast("A name and an email address are required.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) {
      toast("That email address does not look valid.");
      return;
    }
    if (clients.some((c) => c.email.toLowerCase() === form.email.trim().toLowerCase())) {
      toast("That email is already on your customer list.");
      return;
    }
    void actionToast(
      () =>
        actions.addClient({
          name: form.name.trim(),
          email: form.email.trim(),
          company: form.company.trim() || form.name.trim(),
          industry: form.industry,
          tier: form.tier,
          frequency: account.sendFrequency,
          messageTypes: account.messageTypes,
        }),
      {
        success: `${form.name.trim()} added to the active customer list.`,
        failure: "That customer could not be added.",
      },
    );
    setForm(EMPTY_FORM);
    setAddOpen(false);
  }

  function sendTo(ids: string[]) {
    if (!ids.length) {
      toast("Select at least one customer to mail.");
      return;
    }
    void actionToast(() => actions.sendMessages(ids), {
      success: `${ids.length} personalised email${ids.length > 1 ? "s" : ""} queued for sending.`,
      failure: "Those emails could not be queued.",
    });
    setQueued([]);
  }

  function toggleQueued(id: string) {
    setQueued((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  /** Message types are a workspace setting now, so they are edited on the account. */
  function toggleAccountMessageType(type: MessageType) {
    setAccount((prev) => ({
      ...prev,
      messageTypes: prev.messageTypes.includes(type)
        ? prev.messageTypes.filter((t) => t !== type)
        : [...prev.messageTypes, type],
    }));
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Active customers"
          value={stats.active}
          icon={<Users size={16} />}
          hint={`${stats.total} on the list`}
        />
        <Stat
          label="Emails due next 48h"
          value={dueQueue.filter((c) => new Date(c.nextSendAt) < new Date(daysAhead(2))).length}
          icon={<CalendarClock size={16} />}
          hint="auto-sent on the schedule"
        />
        <Stat
          label="Average open rate"
          value={`${stats.avgOpen}%`}
          icon={<Mail size={16} />}
          hint="across active customers"
        />
      </div>

      {/* Actions live here so each tab stays a read-only view. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <button type="button" className={btnPrimary} onClick={() => setAddOpen(true)}>
          <Plus size={14} /> Add customer
        </button>
        <button type="button" className={btnGhost} onClick={() => setAccountOpen(true)}>
          <Settings2 size={14} /> Configuration
        </button>
        <span className="ml-auto text-[11px] text-slate-500">
          Sending from <span className="font-medium text-slate-700">{account.loginEmail}</span> ·{" "}
          {account.dailyDigest ? "daily digest on" : "digest off"}
        </span>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "customers", label: "Customer list", icon: <Users size={13} />, count: clients.length },
          {
            value: "schedule",
            label: "Send queue",
            icon: <Send size={13} />,
            count: dueQueue.filter((c) => new Date(c.nextSendAt) < new Date(daysAhead(2))).length,
          },
          { value: "activity", label: "Sent activity", icon: <Mail size={13} />, count: sent.length },
        ]}
      />

      {tab === "customers" ? (
        <Card>
          <CardHead
            icon={<Users size={16} />}
            title="Customer list"
            subtitle="Everyone who can be mailed, with their schedule"
            action={
              <Segmented
                size="sm"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "active", label: "Active" },
                  { value: "paused", label: "Paused" },
                  { value: "prospect", label: "Prospects" },
                  { value: "all", label: "All" },
                ]}
              />
            }
          />

          <CustomerTable
            clients={visible}
            messageTypeCount={account.messageTypes.length}
            sendFrequency={account.sendFrequency}
            search={search}
            onSearchChange={setSearch}
            onOpen={setOpenClientId}
            onEmail={(id) => sendTo([id])}
            onToggleStatus={(c) => {
              const next = c.status === "paused" ? "active" : "paused";
              updateClient(c.id, { status: next }, {
                success: `${c.name} is now ${next === "active" ? "receiving" : "paused from"} sends.`,
                failure: `${c.name}'s status could not be saved.`,
              });
            }}
            onRemove={(c) => {
              void actionToast(() => actions.removeClient(c.id), {
                success: `${c.name} removed from the customer list.`,
                failure: `${c.name} could not be removed.`,
              });
            }}
          />

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
            <p className="text-[11px] text-slate-500">
              Open a customer to change their status. The send cadence and message types are set
              once for everyone in Configuration.
            </p>
            <span className="text-[11px] text-slate-400">
              {clients.filter((c) => c.status === "active").length} active of {clients.length} total
            </span>
          </div>
        </Card>
      ) : null}

      {tab === "schedule" ? (
        <Card>
          <CardHead
            icon={<Send size={16} />}
            title="Customers to mail"
            subtitle="Queue is ordered by the next scheduled send"
            action={
              <button
                type="button"
                className={btnPrimary}
                onClick={() => sendTo(queued.length ? queued : dueQueue.slice(0, 3).map((c) => c.id))}
              >
                <Send size={13} /> {queued.length ? `Send ${queued.length}` : "Send next 3"}
              </button>
            }
          />
          {dueQueue.length === 0 ? (
            <EmptyState
              title="Nothing queued"
              hint="Add a customer and they will appear here with their next send date."
            />
          ) : (
            <ul className="grid gap-2 px-4 py-4 md:grid-cols-2">
              {dueQueue.map((c) => (
                <li
                  key={c.id}
                  className="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-3"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                    aria-label={`Queue ${c.name}`}
                    checked={queued.includes(c.id)}
                    onChange={() => toggleQueued(c.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {c.name}{" "}
                      <span className="text-[11px] font-normal text-slate-500">{c.email}</span>
                    </p>
                    <p className="truncate text-[11px] text-slate-600">
                      {subjectFor(c, account.messageTypes)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {cadenceLabel(account.sendFrequency)} · due {shortDate(c.nextSendAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === "activity" ? (
        <Card>
          <CardHead
            icon={<Mail size={16} />}
            title="Recent email activity"
            subtitle={`Sent from ${account.loginEmail} · ${sent.length} messages logged`}
          />
          {sent.length === 0 ? (
            <EmptyState
              title="Nothing sent yet"
              hint="Emails you queue from the send queue are logged here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px]">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Customer</Th>
                    <Th>Subject</Th>
                    <Th>Message types</Th>
                    <Th>Sent</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sent.slice(0, 25).map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/70">
                      <Td className="font-medium text-slate-900">{m.clientName}</Td>
                      <Td className="text-xs text-slate-600">{m.subject}</Td>
                      <Td>
                        <span className="flex flex-wrap gap-1">
                          {m.types.map((t) => (
                            <Badge key={t}>{titleCase(t)}</Badge>
                          ))}
                        </span>
                      </Td>
                      <Td className="text-xs text-slate-500">{relativeTime(m.sentAt)}</Td>
                      <Td>
                        <Badge
                          tone={
                            m.status === "clicked"
                              ? "good"
                              : m.status === "opened"
                                ? "info"
                                : m.status === "bounced"
                                  ? "bad"
                                  : "neutral"
                          }
                        >
                          {m.status}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {/* ---- Add customer -------------------------------------------------- */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a current active customer"
        subtitle="New customers start receiving alerts from their first scheduled send"
        icon={<UserPlus size={16} />}
        width="lg"
        footer={
          <>
            <button type="button" className={btnGhost} onClick={() => setAddOpen(false)}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} onClick={addClient}>
              <Plus size={14} /> Add customer
            </button>
          </>
        }
      >
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Customer name">
            <input
              className={inputClass}
              placeholder="e.g. Amina Yusuf"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Customer email">
            <input
              className={inputClass}
              placeholder="name@theirstore.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Company / store">
            <input
              className={inputClass}
              placeholder="e.g. Glow House Store"
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
            />
          </Field>
          <Field label="Industry">
            <select
              className={inputClass}
              value={form.industry}
              onChange={(e) => setForm({ ...form, industry: e.target.value })}
            >
              {[
                "Beauty & cosmetics",
                "Fashion",
                "Phones & electronics",
                "Home appliances",
                "Auto parts",
              ].map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </Field>
          <Field label="Plan">
            <select
              className={inputClass}
              value={form.tier}
              onChange={(e) => setForm({ ...form, tier: e.target.value as Client["tier"] })}
            >
              <option value="starter">Starter — {money(TIER_FEE.starter)}/mo</option>
              <option value="growth">Growth — {money(TIER_FEE.growth)}/mo</option>
              <option value="premium">Premium — {money(TIER_FEE.premium)}/mo</option>
            </select>
          </Field>
        </div>
      </Modal>

      {/* ---- Email account ------------------------------------------------- */}
      <Modal
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        title="Configuration"
        subtitle="What everyone receives, how often, and the mailbox it is sent from"
        icon={<Settings2 size={16} />}
        footer={
          <>
            <button type="button" className={btnGhost} onClick={() => setAccountOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={btnPrimary}
              onClick={() => {
                void actionToast(() => actions.saveMailAccount(account), {
                  success: "Configuration saved — everyone now sends on the same cadence.",
                  failure: "The configuration could not be saved.",
                });
                setAccountOpen(false);
              }}
            >
              Save configuration
            </button>
          </>
        }
      >
        <div className="space-y-3 px-4 py-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">Send cadence</p>
            <Segmented
              size="sm"
              value={account.sendFrequency}
              onChange={(v) => setAccount({ ...account, sendFrequency: v })}
              options={FREQUENCIES.map((f) => ({ value: f.value, label: f.label }))}
            />
            <p className="mt-1.5 text-[11px] text-slate-500">
              Everyone on your list is mailed on the same schedule. Saving applies it to all{" "}
              {clients.length} customer{clients.length === 1 ? "" : "s"}.
            </p>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <p className="mb-1.5 text-xs font-medium text-slate-600">What customers receive</p>
            <div className="flex flex-wrap gap-2">
              {CUSTOMER_MESSAGE_TYPES.map((t) => (
                <CheckboxChip
                  key={t.value}
                  checked={account.messageTypes.includes(t.value)}
                  onChange={() => toggleAccountMessageType(t.value)}
                >
                  {t.label}
                </CheckboxChip>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              The same set goes to everyone on your list when you save.
            </p>
          </div>

          <Field label="Sender name">
            <input
              className={inputClass}
              value={account.senderName}
              onChange={(e) => setAccount({ ...account, senderName: e.target.value })}
            />
          </Field>
          <Field
            label="Login email (alerts are sent from here)"
            hint="Also the address customers reply to by default"
          >
            <input
              className={inputClass}
              value={account.loginEmail}
              onChange={(e) => setAccount({ ...account, loginEmail: e.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Reply-to address">
              <input
                className={inputClass}
                value={account.replyTo}
                onChange={(e) => setAccount({ ...account, replyTo: e.target.value })}
              />
            </Field>
            <Field label="Second email (owner copies)">
              <input
                className={inputClass}
                value={account.secondaryEmail}
                onChange={(e) => setAccount({ ...account, secondaryEmail: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Timezone">
            <input
              className={inputClass}
              value={account.timezone}
              onChange={(e) => setAccount({ ...account, timezone: e.target.value })}
            />
          </Field>
          <Field label="Email signature">
            <textarea
              className={`${inputClass} h-20 resize-none`}
              value={account.signature}
              onChange={(e) => setAccount({ ...account, signature: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={account.dailyDigest}
              onChange={(e) => setAccount({ ...account, dailyDigest: e.target.checked })}
            />
            Send me a daily digest of everything that was sent
          </label>
        </div>
      </Modal>

      {/* ---- One customer's schedule --------------------------------------- */}
      <Modal
        open={openClient !== null}
        onClose={() => setOpenClientId(null)}
        title={openClient?.name ?? "Customer"}
        subtitle={openClient ? `${openClient.company} · ${openClient.email}` : undefined}
        icon={<MessageSquare size={16} />}
        footer={
          openClient ? (
            <>
              <button
                type="button"
                className={btnGhost}
                onClick={() => {
                  void actionToast(() => actions.removeClient(openClient.id), {
                    success: `${openClient.name} removed from the list.`,
                    failure: `${openClient.name} could not be removed.`,
                  });
                  setOpenClientId(null);
                }}
              >
                <Trash2 size={14} /> Remove
              </button>
              <button
                type="button"
                className={btnPrimary}
                onClick={() => sendTo([openClient.id])}
              >
                <Send size={14} /> Send update now
              </button>
            </>
          ) : null
        }
      >
        {openClient ? (
          <div className="space-y-4 px-4 py-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Status</span>
              <Segmented
                size="sm"
                value={openClient.status}
                onChange={(v) =>
                  updateClient(openClient.id, { status: v }, {
                    success: `${openClient.name} is now ${v}.`,
                    failure: `${openClient.name}'s status could not be saved.`,
                  })
                }
                options={[
                  { value: "active", label: "Active" },
                  { value: "paused", label: "Paused" },
                  { value: "prospect", label: "Prospect" },
                ]}
              />
            </div>

            <dl className="grid gap-2 sm:grid-cols-2">
              <Detail label="Plan">{titleCase(openClient.tier)}</Detail>
              <Detail label="Monthly fee">{money(openClient.monthlyFee)}</Detail>
              <Detail label="Next send">{shortDate(openClient.nextSendAt)}</Detail>
              <Detail label="Open rate">{openClient.openRate}%</Detail>
              <Detail label="Last contacted">{relativeTime(openClient.lastContacted)}</Detail>
              <Detail label="Industry">{openClient.industry}</Detail>
            </dl>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
