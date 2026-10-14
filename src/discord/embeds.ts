import { durationDays, formatRange } from "../dates.ts";
import type { Category, EventRow } from "../types.ts";

export const CATEGORY_LABEL: Record<Category, string> = {
  denmark: "🇩🇰 Denmark",
  europe: "🇪🇺 Europe on-site",
  "online-short": "💻 Online (≤5 days)",
  "online-long": "🗓️ Online (long-form)",
};

const CATEGORY_COLOR: Record<Category, number> = {
  denmark: 0xc8102e,
  europe: 0x003399,
  "online-short": 0x2ecc71,
  "online-long": 0x95a5a6,
};

const PRIZE_UNKNOWN = "Not listed – see event page";
const FLAGSHIP_COLOR = 0xf1c40f;

/** Prize as stated on the event page when we've checked it, else what the listing says. */
export const prizeOf = (e: Pick<EventRow, "prize" | "prize_detail">) => e.prize_detail ?? e.prize;

const titleOf = (e: Pick<EventRow, "title" | "flagship">, max: number) => truncate((e.flagship ? "⭐ " : "") + e.title, max);

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** "DK" -> 🇩🇰 */
const flag = (code: string) =>
  String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

export function place(e: Pick<EventRow, "mode" | "location" | "country">): string {
  if (e.mode === "online") return "Online";
  const where = [e.location, e.country && flag(e.country)].filter(Boolean).join(" ") || "TBA";
  return e.mode === "hybrid" ? `${where} (+ online)` : where;
}

const dates = (e: EventRow) => {
  const d = durationDays(e.start_date, e.end_date);
  return `${formatRange(e.start_date, e.end_date)} (${d} day${d === 1 ? "" : "s"})`;
};

export const calendarUrl = (e: Pick<EventRow, "id">, baseUrl: string) => `${baseUrl}/cal/${e.id}`;

/**
 * Registration deadline as a Discord timestamp, which every viewer sees in their own
 * time zone. Devpost registration stays open until the submission deadline.
 */
export function deadlineText(e: EventRow, style: "long" | "short"): string {
  if (e.reg_deadline) {
    const t = Math.floor(Date.parse(e.reg_deadline) / 1000);
    return `<t:${t}:${style === "long" ? "F" : "f"}> (<t:${t}:R>)`;
  }
  if (e.source === "devpost") return `by ${formatRange(e.end_date, e.end_date)} (end of submissions)`;
  // Luma has no deadline: registration runs until the event starts or fills up.
  if (e.reg_status) return style === "long" ? `No fixed deadline · ${e.reg_status}` : e.reg_status.toLowerCase();
  return style === "long" ? "Not published – check event page" : "not published";
}

export function sourcesText(e: EventRow): string {
  const lines = [`• Event page: <${e.url}>`];
  if (e.source_url !== e.url) lines.push(`• Listed on ${e.source}: <${e.source_url}>`);
  else lines.push(`• Listed on: ${e.source}`);
  lines.push(`• Info last changed: ${e.updated_at.slice(0, 16)} UTC`);
  return lines.join("\n");
}

export function eventEmbed(e: EventRow, baseUrl: string) {
  const deadline =
    deadlineText(e, "long") + (e.source === "devpost" && e.reg_deadline ? "\n-# Registration closes with submissions" : "");
  const fields = [
    { name: "⏳ Registration deadline", value: deadline, inline: false },
    { name: "📅 Dates", value: dates(e), inline: true },
    { name: "📆 Calendar", value: `[Add to calendar](${calendarUrl(e, baseUrl)})`, inline: true },
    { name: "📍 Where", value: truncate(place(e), 1024), inline: true },
    { name: "🏆 Prize", value: truncate(prizeOf(e) ?? PRIZE_UNKNOWN, 1024), inline: true },
    { name: "👥 Team size", value: e.team_size ?? "Not listed – check event page", inline: true },
    { name: "🏷️ Category", value: CATEGORY_LABEL[e.category], inline: true },
  ];
  if (e.eligibility) fields.push({ name: "🎓 Who can join", value: truncate(e.eligibility, 1024), inline: false });
  if (e.verify_note) fields.push({ name: "⚠️ Check before joining", value: truncate(e.verify_note, 1024), inline: false });
  if (e.themes) fields.push({ name: "🧩 Themes", value: truncate(e.themes, 1024), inline: false });
  const checked = e.deadline_checked && (e.source === "devpost" || e.source === "luma");
  return {
    title: titleOf(e, 256),
    url: e.url,
    color: e.flagship ? FLAGSHIP_COLOR : CATEGORY_COLOR[e.category],
    fields,
    footer: {
      text: `${e.flagship ? "⭐ Flagship hackathon · " : ""}Source: ${e.source}${checked ? " · details checked on the event page" : ""}`,
    },
  };
}

export function eventButtons(e: EventRow, baseUrl: string) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: "Interested", emoji: { name: "✅" }, custom_id: `int:${e.id}` },
        { type: 2, style: 2, label: "Remind me", emoji: { name: "⏰" }, custom_id: `rem:${e.id}` },
        { type: 2, style: 2, label: "Sources", emoji: { name: "🔗" }, custom_id: `src:${e.id}` },
        { type: 2, style: 5, label: "Add to calendar", emoji: { name: "📆" }, url: calendarUrl(e, baseUrl) },
        { type: 2, style: 5, label: "Open", url: e.url },
      ],
    },
    {
      type: 1,
      components: [{ type: 2, style: 4, label: "Remove", emoji: { name: "🗑️" }, custom_id: `rmv:${e.id}` }],
    },
  ];
}

/** Compact multi-event list: registration deadline | dates | add to calendar. */
export function listEmbed(
  title: string,
  rows: (EventRow & { remind?: number })[],
  opts: { baseUrl: string; footer?: string; emptyText?: string; extra?: (e: EventRow) => string | null },
) {
  let description = "";
  let shown = 0;
  for (const e of rows) {
    const entry =
      `**[${titleOf(e, 80)}](${e.url})**${e.remind ? " ⏰" : ""}\n` +
      `⏳ ${deadlineText(e, "short")} │ 📅 ${formatRange(e.start_date, e.end_date)} │ [📆 Add to calendar](${calendarUrl(e, opts.baseUrl)})\n` +
      `📍 ${truncate(place(e), 50)} · 🏆 ${truncate(prizeOf(e) ?? "not listed", 60)}` +
      `${opts.extra?.(e) ? ` (${opts.extra(e)})` : ""}${e.team_size ? ` · 👥 ${e.team_size}` : ""}`;
    // Stay under Discord's 4096-char limit without cutting an entry in half.
    if (description.length + entry.length + 2 > 4000) break;
    description += (description ? "\n\n" : "") + entry;
    shown++;
  }
  const footer = [opts.footer, shown < rows.length ? `${rows.length - shown} more not shown` : null].filter(Boolean).join(" · ");
  return {
    title,
    description: description || opts.emptyText || "Nothing found.",
    color: 0x5865f2,
    ...(footer ? { footer: { text: footer } } : {}),
  };
}
