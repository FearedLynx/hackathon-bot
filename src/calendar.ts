import { formatRange } from "./dates.ts";
import type { EventRow } from "./types.ts";

type CalEvent = Pick<
  EventRow,
  "id" | "title" | "url" | "start_date" | "end_date" | "location" | "mode" | "category" | "reg_deadline"
>;

const compactDate = (iso: string) => iso.replaceAll("-", "");
const nextDay = (iso: string) => new Date(Date.parse(iso) + 86_400_000).toISOString().slice(0, 10);
/** 2026-10-21T03:45:00.000Z -> 20261021T034500Z */
const compactUtc = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const where = (e: CalEvent) => (e.mode === "online" ? "Online" : e.location ?? "");

function details(e: CalEvent) {
  const lines = [`Dates: ${formatRange(e.start_date, e.end_date)}`];
  if (e.reg_deadline) lines.push(`Registration deadline: ${new Date(e.reg_deadline).toUTCString()}`);
  lines.push(`More info: ${e.url}`);
  return lines.join("\n");
}

/**
 * Google Calendar "add event" link. Long online events become a block of weeks, so for
 * those the deadline is the more useful calendar entry when we know it.
 */
export function googleCalendarUrl(e: CalEvent): string {
  const deadlineOnly = e.category === "online-long" && e.reg_deadline;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: deadlineOnly ? `Deadline: ${e.title}` : e.title,
    dates: deadlineOnly
      ? `${compactUtc(e.reg_deadline!)}/${compactUtc(e.reg_deadline!)}`
      : `${compactDate(e.start_date)}/${compactDate(nextDay(e.end_date))}`,
    details: details(e),
    location: where(e),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

const escapeIcs = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Folds lines longer than 75 octets, as RFC 5545 requires. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** .ics with the event itself (all-day) and, if known, the deadline with a 1-day reminder. */
export function icsFile(e: CalEvent, now = new Date()): string {
  const stamp = compactUtc(now.toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//hackathon-bot//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:event-${e.id}@hackathon-bot`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compactDate(e.start_date)}`,
    `DTEND;VALUE=DATE:${compactDate(nextDay(e.end_date))}`,
    `SUMMARY:${escapeIcs(e.title)}`,
    `LOCATION:${escapeIcs(where(e))}`,
    `URL:${e.url}`,
    `DESCRIPTION:${escapeIcs(details(e))}`,
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ];
  if (e.reg_deadline) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:deadline-${e.id}@hackathon-bot`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${compactUtc(e.reg_deadline)}`,
      `DTEND:${compactUtc(e.reg_deadline)}`,
      `SUMMARY:${escapeIcs(`Deadline: ${e.title}`)}`,
      `URL:${e.url}`,
      `DESCRIPTION:${escapeIcs(details(e))}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcs(`Deadline tomorrow: ${e.title}`)}`,
      "TRIGGER:-P1D",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Small page behind the "Add to calendar" link: pick Google or Apple/Outlook. */
export function calendarPage(e: CalEvent, baseUrl: string): string {
  const title = escapeHtml(e.title);
  const deadline = e.reg_deadline
    ? `<p>⏳ Registration deadline: <strong id="dl">${escapeHtml(new Date(e.reg_deadline).toUTCString())}</strong></p>
       <script>document.getElementById("dl").textContent=new Date(${JSON.stringify(e.reg_deadline)}).toLocaleString(undefined,{dateStyle:"full",timeStyle:"short"});</script>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Add to calendar · ${title}</title>
<style>
  :root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--text:#1b1d21;--muted:#5b616e;--accent:#5865f2}
  @media (prefers-color-scheme:dark){:root{--bg:#1e1f22;--card:#2b2d31;--text:#f2f3f5;--muted:#b5bac1}}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box}
  main{background:var(--card);border-radius:12px;padding:24px;max-width:420px;width:100%;box-shadow:0 2px 12px #0002}
  h1{font-size:1.25rem;margin:0 0 8px} p{margin:4px 0;color:var(--muted)}
  a.btn{display:block;text-align:center;margin-top:12px;padding:12px;border-radius:8px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600}
  a.btn.alt{background:transparent;color:var(--accent);border:2px solid var(--accent)}
  .src{display:block;margin-top:16px;text-align:center;color:var(--muted);font-size:.9rem}
</style></head>
<body><main>
  <h1>${title}</h1>
  <p>📅 ${escapeHtml(formatRange(e.start_date, e.end_date))} · ${escapeHtml(where(e))}</p>
  ${deadline}
  <a class="btn" href="${escapeHtml(googleCalendarUrl(e))}" target="_blank" rel="noopener">Google Calendar</a>
  <a class="btn alt" href="${baseUrl}/cal/${e.id}.ics">Apple / Outlook (.ics)</a>
  <a class="src" href="${escapeHtml(e.url)}" target="_blank" rel="noopener">Event page ↗</a>
</main></body></html>`;
}
