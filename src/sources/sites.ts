import { htmlToText, prizeFromText, teamSizeFromText, formatTeamSize } from "../details/text.ts";
import { USER_AGENT, type RawEvent } from "../types.ts";

// Flagship hackathons that publish only on their own website (not Devpost/Luma/MLH).
// Each site is read for schema.org Event data first, then plain-text dates.

interface Site {
  name: string;
  urls: (year: number) => string[]; // tried in order; first that yields an upcoming event wins
  infoUrls?: string[]; // extra pages (FAQ) for team size / deadline
  location: string;
  country: string;
}

export const SITES: Site[] = [
  {
    name: "Junction",
    urls: (y) => [`https://${y}.hackjunction.com`, `https://${y + 1}.hackjunction.com`],
    location: "Espoo, Finland",
    country: "FI",
  },
  {
    name: "hackaTUM",
    urls: () => ["https://hack.tum.de"],
    infoUrls: ["https://hack.tum.de/faq/"],
    location: "Garching (Munich), Germany",
    country: "DE",
  },
  {
    name: "HackUPC",
    urls: () => ["https://hackupc.com"],
    location: "Barcelona, Spain",
    country: "ES",
  },
];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = String.raw`(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)`;
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const monthIndex = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase());

/**
 * First upcoming date range in text: "27-29 November 2026", "November 13–15, 2026",
 * or "April 24-26" (year inferred as the next occurrence).
 */
export function parseTextDateRange(text: string, today: string): { start: string; end: string } | null {
  const t = text.replace(/[–—]/g, "-");
  const candidates: { start: string; end: string }[] = [];
  for (const m of t.matchAll(new RegExp(String.raw`\b(\d{1,2})\s*-\s*(\d{1,2})\.?\s+${MONTH}\s+(\d{4})`, "gi"))) {
    const mi = monthIndex(m[3]);
    candidates.push({ start: iso(+m[4], mi, +m[1]), end: iso(+m[4], mi, +m[2]) });
  }
  for (const m of t.matchAll(new RegExp(String.raw`\b${MONTH}\s+(\d{1,2})\s*-\s*(\d{1,2})(?:,?\s+(\d{4}))?`, "gi"))) {
    const mi = monthIndex(m[1]);
    let year = m[4] ? +m[4] : +today.slice(0, 4);
    if (!m[4] && iso(year, mi, +m[3]) < today) year++;
    candidates.push({ start: iso(year, mi, +m[2]), end: iso(year, mi, +m[3]) });
  }
  return candidates.filter((c) => c.end >= today && c.start <= c.end).sort((a, b) => a.start.localeCompare(b.start))[0] ?? null;
}

/** "Applications close at Midnight 25.10.2026 GMT +03" / "Registration deadline: October 25, 2026". */
export function parseDeadlineText(text: string): string | null {
  const t = text.replace(/\s+/g, " ");
  // The first mention is often a question ("When is the deadline?"), so try each one.
  for (const [ctx] of t.matchAll(/(?:applications?|registrations?|sign[- ]?ups?)[^?]{0,40}?(?:close|closes|deadline|until|ends?|by)[^?]{0,60}/gi)) {
    const tz = ctx.match(/(?:GMT|UTC)\s?([+-])\s?0?(\d{1,2})/i);
    const offset = tz ? `${tz[1]}${tz[2].padStart(2, "0")}:00` : "Z";
    let date: string | null = null;
    const dmy = ctx.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
    if (dmy) date = iso(+dmy[3], +dmy[2] - 1, +dmy[1]);
    const mdy = ctx.match(new RegExp(String.raw`${MONTH}\s+(\d{1,2}),?\s+(\d{4})`, "i"));
    if (!date && mdy) date = iso(+mdy[3], monthIndex(mdy[1]), +mdy[2]);
    if (!date) continue;
    const ms = Date.parse(`${date}T23:59:00${offset}`);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  }
  return null;
}

interface LdEvent {
  "@type"?: string | string[];
  name?: string;
  startDate?: string;
  endDate?: string;
}

function ldEvents(html: string): LdEvent[] {
  const out: LdEvent[] = [];
  for (const [, json] of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const o = JSON.parse(json);
      for (const x of Array.isArray(o) ? o : (o["@graph"] ?? [o])) if (/Event/.test(String(x["@type"]))) out.push(x);
    } catch {
      // ignore malformed blocks
    }
  }
  return out;
}

/** FAQ questions/answers from JSON-LD, where sites often state deadlines and team sizes. */
function ldFaqText(html: string): string {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      if (o["@type"] === "Question" && typeof o.name === "string") out.push(o.name);
      if (o["@type"] === "Answer" && typeof o.text === "string") out.push(o.text);
      Object.values(o).forEach(walk);
    }
  };
  for (const [, json] of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      walk(JSON.parse(json));
    } catch {
      // ignore malformed blocks
    }
  }
  return out.join("\n");
}

const metaDescription = (html: string) =>
  html.match(/<meta[^>]+(?:name|property)="(?:og:)?description"[^>]+content="([^"]*)"/i)?.[1]?.replace(/&#x27;|&#39;/g, "'") ?? "";

export async function fetchSite(site: Site, today: string): Promise<RawEvent | null> {
  const get = async (url: string) => {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    return res.ok ? res.text() : null;
  };
  for (const url of site.urls(+today.slice(0, 4))) {
    const html = await get(url).catch(() => null);
    if (!html) continue;
    const extra = (await Promise.all((site.infoUrls ?? []).map((u) => get(u).catch(() => null)))).join("\n");
    const text = `${metaDescription(html)}\n${ldFaqText(html)}\n${htmlToText(html)}\n${htmlToText(extra)}`;
    const ld = ldEvents(html).find((e) => e.startDate);
    const range = ld?.startDate
      ? { start: ld.startDate.slice(0, 10), end: (ld.endDate ?? ld.startDate).slice(0, 10) }
      : parseTextDateRange(text, today);
    if (!range || range.end < today) continue;
    const team = teamSizeFromText(text);
    return {
      source: "site",
      sourceId: `${site.name.toLowerCase()}-${range.start.slice(0, 4)}`,
      title: ld?.name?.trim() || `${site.name} ${range.start.slice(0, 4)}`,
      url,
      sourceUrl: url,
      start: range.start,
      end: range.end,
      location: site.location,
      country: site.country,
      mode: "in-person",
      prize: prizeFromText(text),
      teamSize: team ? formatTeamSize(team) : null,
      themes: [],
      regDeadline: parseDeadlineText(text),
    };
  }
  return null;
}

export async function fetchSites(today: string): Promise<RawEvent[]> {
  const results = await Promise.allSettled(SITES.map((s) => fetchSite(s, today)));
  return results.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
}
