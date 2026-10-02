import { sendSmtpMail, type OutgoingMail, type SmtpSettings } from "./smtp.ts";

/**
 * What the client mail desk writes, and to whom.
 *
 * The subjects here mirror `subjectFor` in the app (`src/lib/options.ts`), and
 * the type table mirrors `CUSTOMER_MESSAGE_TYPES` in the same file, so the
 * preview on the schedule tab and the mail that lands in the inbox are the same
 * message rather than two guesses. A test asserts the two subject functions
 * agree; if one side changes without the other, that test fails instead of the
 * workspace silently mailing something the page never showed.
 */

export interface CustomerMessageType {
  value: string;
  label: string;
  hint: string;
}

/** What a customer can be mailed — competitor alerts stay internal to the desk. */
export const CUSTOMER_MESSAGE_TYPES: CustomerMessageType[] = [
  { value: "new_stock", label: "New stock", hint: "Anything new or restocked at your competitors" },
  { value: "two_day_checkin", label: "2-day check-in", hint: "Short status note every second day" },
  { value: "platform_info", label: "Platform info", hint: "New features and data added to their dashboard" },
  { value: "deals", label: "Deals", hint: "Live competitor and platform deals worth buying" },
  { value: "review_update", label: "Review update", hint: "New reviews and what to answer" },
  { value: "weekly_report", label: "Weekly report", hint: "SEO, GEO, traffic and actions summary" },
];

/** Label for a type, falling back to a readable form of the value itself. */
export function typeLabel(value: string): string {
  const known = CUSTOMER_MESSAGE_TYPES.find((type) => type.value === value);
  if (known) return known.label;
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * The subject a customer is shown on the schedule tab — mirrored here so the
 * delivered mail and the queued preview cannot drift apart.
 */
export function subjectFor(company: string, types: string[]): string {
  const primary = types[0] ?? "weekly_report";
  switch (primary) {
    case "new_stock":
      return `New at your competitors, ${company}`;
    case "two_day_checkin":
      return "Mid-week check-in — 3 moves worth knowing";
    case "platform_info":
      return "New data on your BIZLIT desk";
    case "deals":
      return "Live deals you can promote today";
    case "competitor_alert":
      return "Competitor alert: price and promo changes";
    case "review_update":
      return "Review scan: latest customer feedback";
    default:
      return "Your weekly market watch report";
  }
}

/**
 * When this customer is due next — the server's copy of `nextSendFrom`
 * (`src/lib/schedule.ts`), because a scheduled send has no browser to compute
 * it in. Urgent types pull the date forward, exactly as the desk does.
 */
export function nextSendAt(frequency: string, types: string[], from: Date = new Date()): string {
  const days: Record<string, number> = { every_2_days: 2, daily: 1, weekly: 7, monthly: 30 };
  const base = days[frequency] ?? 7;
  const urgent = types.includes("competitor_alert") || types.includes("new_stock");
  const due = new Date(from);
  due.setDate(due.getDate() + (urgent ? Math.min(base, 2) : base));
  due.setHours(8, 0, 0, 0);
  return due.toISOString();
}

export interface UpdateRecipient {
  /** Full From header for this send, e.g. `BIZLIT <no-reply@example.com>`. */
  from: string;
  replyTo?: string;
  to: string;
  clientName: string;
  company: string;
  types: string[];
  senderName?: string;
  brandName?: string;
  signature?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

function sectionLines(types: string[]): { label: string; hint: string }[] {
  const list = types.length ? types : ["weekly_report"];
  return list.map((value) => {
    const known = CUSTOMER_MESSAGE_TYPES.find((type) => type.value === value);
    return { label: known?.label ?? typeLabel(value), hint: known?.hint ?? "" };
  });
}

/**
 * The customer update itself: one subject, a plain-text part and an HTML part.
 *
 * The body is deliberately honest about what it is — a list of the update types
 * this customer is subscribed to, signed by the workspace. It does not invent
 * figures or stock the workspace never reported; richer content (the weekly
 * report's own numbers, recent catalogue changes) can be threaded in from the
 * workspace rows when the desk grows it.
 */
export function composeClientUpdate(params: UpdateRecipient): OutgoingMail {
  const company = params.company || params.clientName;
  const senderName = params.senderName || params.brandName || "BIZLIT";
  const brand = params.brandName || "BIZLIT";
  const subject = subjectFor(company, params.types);
  const sections = sectionLines(params.types);

  const listText = sections.map((section) => `• ${section.label} — ${section.hint}`).join("\n");
  const listHtml = sections
    .map(
      (section) =>
        `<tr><td style="padding:10px 0;border-bottom:1px solid #e2e8f0;vertical-align:top;width:1%;">` +
        `<span style="display:inline-block;background:#eef2ff;color:#4f46e5;font-size:12px;font-weight:700;` +
        `border-radius:999px;padding:3px 10px;">${escapeHtml(section.label)}</span></td>` +
        `<td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#475569;font-size:13px;">` +
        `${escapeHtml(section.hint)}</td></tr>`,
    )
    .join("");

  const signature = params.signature ? `\n\n${params.signature}` : "";
  const text =
    `Hi ${firstName(params.clientName)},\n\n` +
    `${senderName} here with your latest update for ${company}.\n\n` +
    `${listText}\n` +
    `${signature}\n\n` +
    `— ${senderName}, ${brand}\n` +
    `You are receiving this because ${company} is set to get these updates from ${brand} on BIZLIT.`;

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="background:#4f46e5;padding:18px 28px;">
              <span style="color:#ffffff;font-size:16px;font-weight:800;letter-spacing:0.12em;">BIZLIT</span>
              <span style="color:#c7d2fe;font-size:12px;float:right;padding-top:3px;">${escapeHtml(brand)}</span>
            </td>
          </tr>
          <tr><td style="padding:28px;">
            <p style="margin:0 0 16px;font-size:15px;color:#0f172a;">Hi ${escapeHtml(firstName(params.clientName))},</p>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">
              ${escapeHtml(senderName)} here with your latest update for
              <strong>${escapeHtml(company)}</strong>. This send covers:
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${listHtml}</table>
            ${
              params.signature
                ? `<p style="margin:22px 0 0;font-size:14px;line-height:1.6;color:#334155;white-space:pre-line;">${escapeHtml(params.signature)}</p>`
                : ""
            }
            <p style="margin:22px 0 0;font-size:13px;color:#64748b;">— ${escapeHtml(senderName)}, ${escapeHtml(brand)}</p>
          </td></tr>
          <tr><td style="background:#f8fafc;padding:16px 28px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:11px;line-height:1.6;color:#94a3b8;">
              You are receiving this because ${escapeHtml(company)} is set to get these updates from
              ${escapeHtml(brand)} on BIZLIT. Sent to ${escapeHtml(params.to)}.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return {
    from: params.from,
    to: params.to,
    replyTo: params.replyTo,
    subject,
    text,
    html,
  };
}

/** Composes and delivers one customer update, handing back what was sent. */
export async function sendClientUpdate(
  settings: SmtpSettings,
  params: UpdateRecipient,
): Promise<{ subject: string }> {
  const mail = composeClientUpdate(params);
  await sendSmtpMail(settings, mail);
  return { subject: mail.subject };
}
