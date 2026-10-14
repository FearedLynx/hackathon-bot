import { countryFromName, normalizeCountryCode } from "../classify.ts";
import { USER_AGENT, type Mode, type RawEvent } from "../types.ts";

// Luma (luma.com / lu.ma) hosts many European hackathons that aren't on Devpost or MLH,
// e.g. the European Defense Tech Hackathons. We read calendars (an organizer's page)
// and discover places (a city's feed) through Luma's public JSON endpoints.

export interface LumaFeed {
  kind: "calendar" | "place";
  id: string; // cal-… or discplace-…
  slug: string; // luma.com/<slug>
}

/** Checked on every run. */
export const PRIORITY_LUMA_FEEDS: LumaFeed[] = [
  { kind: "calendar", id: "cal-QCQbg4FodJDriFO", slug: "eurodefensetech" }, // European Defense Tech Hackathons
  { kind: "place", id: "discplace-CmmHAjPdBSsqmJf", slug: "copenhagen" },
];

/** Checked in rotation (a few per run) to stay within the Workers subrequest limit. */
export const DEFAULT_LUMA_FEEDS: LumaFeed[] = [
  ...PRIORITY_LUMA_FEEDS,
  { kind: "calendar", id: "cal-4BIGfE8WhTFQj9H", slug: "ethglobal" },
  { kind: "place", id: "discplace-e7EG0Ef6S2aQnvN", slug: "stockholm" },
  { kind: "place", id: "discplace-Q5DXX8la0vuCuz2", slug: "oslo" },
  { kind: "place", id: "discplace-gEii5B2Ju5KKRNH", slug: "helsinki" },
  { kind: "place", id: "discplace-gCfX0s3E9Hgo3rG", slug: "berlin" },
  { kind: "place", id: "discplace-xZzD6rDcDK12oi7", slug: "hamburg" },
  { kind: "place", id: "discplace-P00kEGGGHNLEYGe", slug: "munich" },
  { kind: "place", id: "discplace-QCcNk3HXowOR97j", slug: "london" },
  { kind: "place", id: "discplace-FC4SDMUVXiFtMOr", slug: "amsterdam" },
  { kind: "place", id: "discplace-NdLrh1xJfeotJZC", slug: "paris" },
  { kind: "place", id: "discplace-tSRc3NkTycobe0w", slug: "zurich" },
  { kind: "place", id: "discplace-PTcuEQVHuySJe8N", slug: "warsaw" },
  { kind: "place", id: "discplace-3YgdIjqj7Pveid3", slug: "vienna" },
  { kind: "place", id: "discplace-6xx9LRci5NFgdJ5", slug: "prague" },
  { kind: "place", id: "discplace-mgGFFo5EDdyekyE", slug: "lisbon" },
  { kind: "place", id: "discplace-WcS4REeayDPXV4n", slug: "barcelona" },
  { kind: "place", id: "discplace-03jiEcS4mvwJuDa", slug: "madrid" },
  { kind: "place", id: "discplace-9AyCYUvGH7xiqhh", slug: "milan" },
  { kind: "place", id: "discplace-ffI8KmAB4gC5LMC", slug: "dublin" },
];

export const FEEDS_PER_RUN = 6;

/** Priority feeds every run, plus a rotating slice of the rest (all covered every few hours). */
export function feedsForRun(feeds: LumaFeed[], runIndex: number): LumaFeed[] {
  const priority = new Set(PRIORITY_LUMA_FEEDS.map((f) => f.id));
  const always = feeds.filter((f) => priority.has(f.id));
  const rest = feeds.filter((f) => !priority.has(f.id));
  const n = Math.max(0, FEEDS_PER_RUN - always.length);
  if (rest.length <= n) return [...always, ...rest];
  const start = (runIndex * n) % rest.length;
  return [...always, ...[...rest, ...rest].slice(start, start + n)];
}

interface LumaEntry {
  event: {
    api_id: string;
    name: string;
    start_at: string;
    end_at: string | null;
    timezone: string | null;
    url: string;
    location_type: string;
    geo_address_info?: { city?: string; city_state?: string; country?: string; country_code?: string } | null;
  };
  registration_availability?: string;
  waitlist_active?: boolean;
  ticket_info?: { is_sold_out?: boolean; require_approval?: boolean; is_free?: boolean } | null;
  tags?: { name: string }[];
}

// Whole words only: "Hacking" talks and "Growth Hacker" meetups aren't hackathons.
const HACKATHON_NAME = /hackat?hon|\bhacks?\b|\bhack ?days?\b|buildathon|datathon|ideathon|game ?jam|codefest/i;

export const isHackathon = (e: LumaEntry) =>
  (e.tags ?? []).some((t) => /hackathon/i.test(t.name)) || HACKATHON_NAME.test(e.event.name);

/** Calendar date of a UTC timestamp in the event's own time zone. */
function localDate(iso: string, timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(iso),
    );
  } catch {
    return iso.slice(0, 10);
  }
}

/** Luma has no registration deadline; registration runs until the event or until it fills up. */
export function registrationStatus(e: LumaEntry): string | null {
  if (e.ticket_info?.is_sold_out) return "Sold out";
  if (e.waitlist_active || e.registration_availability === "waitlist") return "Waitlist only";
  if (e.registration_availability && e.registration_availability !== "open") return "Registration closed";
  if (e.registration_availability === "open") return e.ticket_info?.require_approval ? "Open – approval required" : "Open";
  return null;
}

export function mapLuma(e: LumaEntry, feed: LumaFeed): RawEvent {
  const ev = e.event;
  const geo = ev.geo_address_info ?? {};
  const mode: Mode = ev.location_type === "offline" ? "in-person" : "online";
  return {
    source: "luma",
    sourceId: ev.api_id,
    title: ev.name.trim(),
    url: `https://luma.com/${ev.url}`,
    sourceUrl: `https://luma.com/${feed.slug}`,
    start: localDate(ev.start_at, ev.timezone),
    end: localDate(ev.end_at ?? ev.start_at, ev.timezone),
    location: mode === "online" ? "Online" : geo.city_state ?? geo.city ?? null,
    // No country but a European time zone: file it as Europe (🇪🇺) rather than guess a country.
    country:
      normalizeCountryCode(geo.country_code) ??
      countryFromName(geo.country) ??
      (mode === "in-person" && ev.timezone?.startsWith("Europe/") ? "EU" : null),
    mode,
    prize: null,
    teamSize: null,
    themes: [],
    regStatus: registrationStatus(e),
  };
}

const feedUrl = (f: LumaFeed) =>
  f.kind === "calendar"
    ? `https://api.lu.ma/calendar/get-items?calendar_api_id=${f.id}&period=future&pagination_limit=50`
    : `https://api.lu.ma/discover/get-paginated-events?discover_place_api_id=${f.id}&pagination_limit=50`;

export async function fetchLuma(feeds: LumaFeed[]): Promise<RawEvent[]> {
  const out: RawEvent[] = [];
  for (const feed of feeds) {
    const res = await fetch(feedUrl(feed), { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`Luma HTTP ${res.status} for ${feed.slug}`);
    const { entries = [] } = (await res.json()) as { entries?: LumaEntry[] };
    for (const e of entries) if (isHackathon(e)) out.push(mapLuma(e, feed));
  }
  return out;
}

/** Looks up luma.com/<slug> and returns it as a feed, if it's a calendar or a city page. */
export async function resolveLumaFeed(input: string): Promise<LumaFeed | null> {
  const slug = input.trim().replace(/^https?:\/\/(www\.)?(lu\.ma|luma\.com)\//, "").replace(/[/?#].*$/, "");
  if (!/^[\w-]+$/.test(slug)) return null;
  const res = await fetch(`https://luma.com/${slug}`, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  const m = (await res.text()).match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  const data = JSON.parse(m[1]).props?.pageProps?.initialData?.data ?? {};
  if (data.calendar?.api_id && data.upcoming) return { kind: "calendar", id: data.calendar.api_id, slug };
  if (data.place?.api_id) return { kind: "place", id: data.place.api_id, slug };
  return null;
}
