import { parseDevpostRange } from "../dates.ts";
import { USER_AGENT, type RawEvent } from "../types.ts";

// Unofficial JSON endpoint behind devpost.com/hackathons. Online only: Devpost's
// in-person locations are free text without a country, so we can't classify them.
const BASE =
  "https://devpost.com/api/hackathons?status%5B%5D=upcoming&status%5B%5D=open" +
  "&challenge_type%5B%5D=online&per_page=40";
const MAX_PAGES = 3;

interface DevpostHackathon {
  id: number;
  title: string;
  url: string;
  displayed_location?: { location: string | null };
  submission_period_dates: string;
  themes?: { name: string }[];
  prize_amount?: string | null;
  prizes_counts?: { cash?: number; other?: number };
  invite_only?: boolean;
}

interface DevpostResponse {
  hackathons: DevpostHackathon[];
  meta: { total_count: number; per_page: number };
}

/** "$<span data-currency-value>138,000</span>" -> "$138,000"; zero/empty -> null. */
export function cleanPrize(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return /[1-9]/.test(text) ? text : null;
}

/**
 * Devpost's prize_amount only counts cash entered as such. Many events list prizes as
 * "other" (credits, hardware…) and put the value in the title, e.g. "UnivaBio ($40,000 in prizes)".
 */
export function describePrize(h: Pick<DevpostHackathon, "title" | "prize_amount" | "prizes_counts">): string | null {
  const amount = cleanPrize(h.prize_amount);
  if (amount) return amount;
  const fromTitle = h.title.match(/[$€£₹]\s?\d[\d,.]*\s?k?\+?/i)?.[0].replace(/\s+/g, "");
  if (fromTitle) return `${fromTitle} in prizes (per title)`;
  const { cash = 0, other = 0 } = h.prizes_counts ?? {};
  if (other > 0) return `${other} non-cash prize${other === 1 ? "" : "s"}`;
  if (cash > 0) return "Cash prize (amount not listed)";
  return null;
}

/** Exact submission deadline from a Devpost event page (registration stays open until then). */
export function parseDevpostDeadline(html: string): string | null {
  const iso =
    html.match(/Deadline[\s\S]{0,600}?data-iso-date="([^"]+)"/)?.[1] ?? html.match(/data-iso-date="([^"]+)"/)?.[1];
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export async function fetchDevpostDeadline(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Devpost page HTTP ${res.status}`);
  return parseDevpostDeadline(await res.text());
}

export function mapDevpost(h: DevpostHackathon): RawEvent | null {
  if (h.invite_only) return null;
  const range = parseDevpostRange(h.submission_period_dates);
  if (!range) return null;
  return {
    source: "devpost",
    sourceId: String(h.id),
    title: h.title.trim(),
    url: h.url,
    sourceUrl: h.url,
    start: range.start,
    end: range.end,
    location: "Online",
    country: null,
    mode: "online",
    prize: describePrize(h),
    teamSize: null,
    themes: (h.themes ?? []).map((t) => t.name),
  };
}

export async function fetchDevpost(): Promise<RawEvent[]> {
  const out: RawEvent[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${BASE}&page=${page}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`Devpost HTTP ${res.status}`);
    const data = (await res.json()) as DevpostResponse;
    for (const h of data.hackathons) {
      const e = mapDevpost(h);
      if (e) out.push(e);
    }
    if (page * data.meta.per_page >= data.meta.total_count) break;
  }
  return out;
}
