import { DEFAULT_LUMA_FEEDS, type LumaFeed } from "./sources/luma.ts";
import type { Category, Env } from "./types.ts";

export type PostMode = "instant" | "daily" | "both";
export const ALL_CATEGORIES: Category[] = ["denmark", "europe", "online-short", "online-long"];

/** Bot settings, editable from Discord with /config and stored in the `settings` table. */
export interface Settings {
  mode: PostMode;
  dailyHour: number; // local hour of the digest + reminders
  timezone: string; // IANA name
  channelId: string;
  categories: Category[]; // which categories get announced
  lastDigestDate: string | null; // local date of the last digest run
  lumaFeeds: LumaFeed[]; // Luma calendars / city pages to watch
  flagships: string[]; // title fragments that mark a prestigious hackathon
}

/** Prestigious hackathons, matched case-insensitively against titles. */
export const DEFAULT_FLAGSHIPS = [
  "junction",
  "hackatum",
  "hackzurich",
  "start hack",
  "hackupc",
  "ethglobal",
  "eth global",
  "space apps",
  "hack kosice",
  "tum.ai makeathon",
  "hackmit",
  "treehacks",
  "cal hacks",
  "pennapps",
  "hack the north",
];

function parseList(raw: string | undefined, fallback: string[]): string[] {
  if (raw === undefined) return fallback;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string" && x.trim() !== "") : fallback;
  } catch {
    return fallback;
  }
}

function parseFeeds(raw: string | undefined): LumaFeed[] {
  if (!raw) return DEFAULT_LUMA_FEEDS;
  try {
    const feeds = JSON.parse(raw) as LumaFeed[];
    return Array.isArray(feeds) ? feeds.filter((f) => f && f.id && f.slug && (f.kind === "calendar" || f.kind === "place")) : DEFAULT_LUMA_FEEDS;
  } catch {
    return DEFAULT_LUMA_FEEDS;
  }
}

export const isValidTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export function parseSettings(stored: Record<string, string>, defaultChannelId: string): Settings {
  const mode = stored.mode;
  const hour = Number(stored.daily_hour);
  const categories = (stored.categories ?? ALL_CATEGORIES.join(","))
    .split(",")
    .filter((c): c is Category => (ALL_CATEGORIES as string[]).includes(c));
  return {
    mode: mode === "instant" || mode === "daily" || mode === "both" ? mode : "instant",
    dailyHour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 10,
    timezone: stored.timezone && isValidTimezone(stored.timezone) ? stored.timezone : "Europe/Copenhagen",
    channelId: stored.channel_id || defaultChannelId,
    categories,
    lastDigestDate: stored.last_digest_date || null,
    lumaFeeds: parseFeeds(stored.luma_feeds),
    flagships: parseList(stored.flagships, DEFAULT_FLAGSHIPS),
  };
}

export async function getSettings(env: Env): Promise<Settings> {
  const rows = (await env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>()).results;
  return parseSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])), env.CHANNEL_ID);
}

export async function setSetting(env: Env, key: string, value: string) {
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  )
    .bind(key, value)
    .run();
}

/** Re-marks flagship events after the list or the events change. */
export async function updateFlagships(env: Env, flagships: string[]) {
  const match = flagships.map(() => "instr(lower(title), ?) > 0").join(" OR ") || "0";
  await env.DB.prepare(`UPDATE events SET flagship = CASE WHEN ${match} THEN 1 ELSE 0 END`)
    .bind(...flagships.map((f) => f.toLowerCase()))
    .run();
}

/** Local date (YYYY-MM-DD) and hour in a time zone. */
export function localTime(timezone: string, now = new Date()): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
