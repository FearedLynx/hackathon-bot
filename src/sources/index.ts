import type { RawEvent } from "../types.ts";
import { fetchDevEvents } from "./devevents.ts";
import { fetchDevpost } from "./devpost.ts";
import { fetchLuma, type LumaFeed } from "./luma.ts";
import { fetchMlh } from "./mlh.ts";
import { fetchSites } from "./sites.ts";

/**
 * Fetches every source; one failing source doesn't block the others. Order matters:
 * when two sources list the same event, the earlier (richer) one is kept.
 */
export async function fetchAllSources(
  lumaFeeds: LumaFeed[] = [],
  today = new Date().toISOString().slice(0, 10),
): Promise<{ events: RawEvent[]; errors: string[] }> {
  const sources: [string, () => Promise<RawEvent[]>][] = [
    ["sites", () => fetchSites(today)],
    ["devpost", fetchDevpost],
    ["mlh", () => fetchMlh()],
    ...lumaFeeds.map((f): [string, () => Promise<RawEvent[]>] => [`luma:${f.slug}`, () => fetchLuma([f])]),
    ["dev.events", fetchDevEvents],
  ];
  const results = await Promise.allSettled(sources.map(([, fetch]) => fetch()));
  const events: RawEvent[] = [];
  const errors: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") events.push(...r.value);
    else errors.push(`${sources[i][0]}: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
  });
  return { events, errors };
}
