import { durationDays } from "./dates.ts";
import type { Category, RawEvent } from "./types.ts";

/** Longest in-person / "short" online event we care about. */
export const MAX_SHORT_DAYS = 5;

export const EUROPE = new Set([
  "AD", "AL", "AT", "BA", "BE", "BG", "BY", "CH", "CY", "CZ", "DE", "DK", "EE", "ES",
  "FI", "FO", "FR", "GB", "GL", "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU",
  "LV", "MC", "MD", "ME", "MK", "MT", "NL", "NO", "PL", "PT", "RO", "RS", "SE", "SI",
  "SK", "SM", "UA", "XK",
  "EU", // somewhere in Europe, exact country unknown
]);

const COUNTRY_NAMES: Record<string, string> = {
  denmark: "DK", danmark: "DK", germany: "DE", france: "FR", spain: "ES", italy: "IT",
  switzerland: "CH", netherlands: "NL", "the netherlands": "NL", belgium: "BE",
  luxembourg: "LU", austria: "AT", sweden: "SE", norway: "NO", finland: "FI",
  iceland: "IS", ireland: "IE", "united kingdom": "GB", uk: "GB", england: "GB",
  scotland: "GB", wales: "GB", "northern ireland": "GB", portugal: "PT", poland: "PL",
  czechia: "CZ", "czech republic": "CZ", slovakia: "SK", hungary: "HU", romania: "RO",
  bulgaria: "BG", greece: "GR", croatia: "HR", slovenia: "SI", serbia: "RS",
  estonia: "EE", latvia: "LV", lithuania: "LT", ukraine: "UA", cyprus: "CY",
  malta: "MT", albania: "AL", "bosnia and herzegovina": "BA", "north macedonia": "MK",
  montenegro: "ME", moldova: "MD", kosovo: "XK", monaco: "MC", liechtenstein: "LI",
  andorra: "AD", "san marino": "SM", "faroe islands": "FO", greenland: "GL",
};

export function countryFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  return COUNTRY_NAMES[name.trim().toLowerCase()] ?? null;
}

export function normalizeCountryCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  if (c === "UK") return "GB";
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

/** Returns the category to file the event under, or null if it doesn't match our criteria. */
export function classify(e: RawEvent): Category | null {
  const days = durationDays(e.start, e.end);
  if (days < 1) return null;
  const onlineCategory: Category = days <= MAX_SHORT_DAYS ? "online-short" : "online-long";

  if (e.mode !== "online" && e.country) {
    if (days > MAX_SHORT_DAYS) return null;
    if (e.country === "DK") return "denmark";
    if (EUROPE.has(e.country)) return "europe";
    // A hybrid event far away is still joinable remotely.
    return e.mode === "hybrid" ? onlineCategory : null;
  }
  if (e.mode === "in-person") return null; // unknown location
  return onlineCategory;
}

/** Two listings are the same event if titles normalize equal and starts are ≤3 days apart. */
export const isSameEvent = (keyA: string, startA: string, keyB: string, startB: string) =>
  keyA === keyB && Math.abs(Date.parse(startA) - Date.parse(startB)) <= 3 * 86_400_000;

/** Drops cross-source duplicates, keeping the first occurrence (sources are ordered by data quality). */
export function dedupeEvents<T extends RawEvent>(events: T[]): T[] {
  const kept: { key: string; e: T }[] = [];
  for (const e of events) {
    const key = dedupeKey(e.title);
    if (!kept.some((k) => isSameEvent(k.key, k.e.start, key, e.start))) kept.push({ key, e });
  }
  return kept.map((k) => k.e);
}

/** Normalized title used to spot the same hackathon listed by two sources. */
export const dedupeKey = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(hackathon|hackaton|the)\b/g, "")
    .replace(/\b(19|20)\d{2}\b/g, "") // "Junction 2026" and "Junction" are the same event
    .replace(/\s+/g, " ")
    .trim();
