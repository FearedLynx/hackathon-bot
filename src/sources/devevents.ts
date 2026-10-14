import { countryFromName } from "../classify.ts";
import { USER_AGENT, type Mode, type RawEvent } from "../types.ts";

// dev.events listing pages carry one schema.org JSON-LD block per event.
const PAGES = [
  "https://dev.events/hackathons/EU/DK/tech",
  "https://dev.events/hackathons/EU/tech",
  "https://dev.events/hackathons/online/tech",
];

interface JsonLdEvent {
  "@type"?: string;
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  eventAttendanceMode?: string;
  location?: { name?: string; address?: { addressLocality?: string; addressRegion?: string } };
}

function mode(attendance: string | undefined): Mode {
  if (attendance?.includes("Online")) return "online";
  if (attendance?.includes("Mixed")) return "hybrid";
  return "in-person";
}

export function parseDevEvents(html: string, pageUrl: string): RawEvent[] {
  const out: RawEvent[] = [];
  for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let j: JsonLdEvent;
    try {
      j = JSON.parse(json);
    } catch {
      continue;
    }
    if (!j.name || !j.startDate || !j.url) continue;
    // Listings are padded with sponsored masterclasses; keep only hackathons.
    if (!/hack/i.test(`${j.name} ${j.description ?? ""}`)) continue;
    const m = mode(j.eventAttendanceMode);
    out.push({
      source: "dev.events",
      sourceId: new URL(j.url).pathname.split("/").filter(Boolean).pop() ?? j.url,
      title: j.name.trim(),
      url: j.url,
      sourceUrl: pageUrl,
      start: j.startDate.slice(0, 10),
      end: (j.endDate ?? j.startDate).slice(0, 10),
      location: m === "online" ? "Online" : j.location?.name ?? null,
      country: countryFromName(j.location?.address?.addressRegion),
      mode: m,
      prize: null,
      teamSize: null,
      themes: [],
    });
  }
  return out;
}

export async function fetchDevEvents(): Promise<RawEvent[]> {
  const seen = new Set<string>();
  const out: RawEvent[] = [];
  for (const page of PAGES) {
    const res = await fetch(page, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`dev.events HTTP ${res.status} for ${page}`);
    for (const e of parseDevEvents(await res.text(), page)) {
      if (seen.has(e.sourceId)) continue;
      seen.add(e.sourceId);
      out.push(e);
    }
  }
  return out;
}
