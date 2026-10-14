import { normalizeCountryCode } from "../classify.ts";
import { USER_AGENT, type Mode, type RawEvent } from "../types.ts";

// MLH season pages embed their data as JSON in <script data-page="app">.
interface MlhEvent {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  url: string;
  location: string | null;
  formatType: string;
  websiteUrl: string | null;
  region: string;
  venueAddress?: { city?: string; state?: string; country?: string } | null;
}

/** MLH seasons run Aug–Jul and are named after the year they end in. */
export const mlhSeason = (now = new Date()) =>
  now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();

function mode(formatType: string): Mode {
  if (formatType.includes("hybrid")) return "hybrid";
  if (formatType === "physical") return "in-person";
  return "online";
}

export function parseMlh(html: string): RawEvent[] {
  const m = html.match(/<script data-page="app" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("MLH: page data not found");
  const events: MlhEvent[] = JSON.parse(m[1]).props?.upcomingEvents ?? [];
  return events
    .filter((e) => e.region === "EMEA" || mode(e.formatType) !== "in-person")
    .map((e) => ({
      source: "mlh",
      sourceId: e.id,
      title: e.name.trim(),
      url: e.websiteUrl || `https://www.mlh.com${e.url}`,
      sourceUrl: `https://www.mlh.com${e.url}`,
      start: e.startsAt.slice(0, 10),
      end: e.endsAt.slice(0, 10),
      location: e.location?.trim() || null,
      country: normalizeCountryCode(e.venueAddress?.country),
      mode: mode(e.formatType),
      prize: null,
      teamSize: null,
      themes: [],
    }));
}

export async function fetchMlh(now = new Date()): Promise<RawEvent[]> {
  const res = await fetch(`https://www.mlh.com/seasons/${mlhSeason(now)}/events`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`MLH HTTP ${res.status}`);
  return parseMlh(await res.text());
}
