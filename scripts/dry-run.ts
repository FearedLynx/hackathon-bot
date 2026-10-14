// Fetches all sources live and prints what the bot would track, grouped by category.
// Run with: npm run dry-run   (no Discord or Cloudflare needed)
import { classify, dedupeEvents, MAX_SHORT_DAYS } from "../src/classify.ts";
import { durationDays, formatRange, todayIso } from "../src/dates.ts";
import { fetchAllSources } from "../src/sources/index.ts";
import { DEFAULT_LUMA_FEEDS } from "../src/sources/luma.ts";

const today = todayIso();
const fetched = await fetchAllSources(DEFAULT_LUMA_FEEDS);
const errors = fetched.errors;
const events = dedupeEvents(fetched.events);
for (const e of errors) console.error(`! ${e}`);

const groups = new Map<string, string[]>();
let skipped = 0;
for (const e of events) {
  const cat = classify(e);
  if (!cat || e.end < today) {
    skipped++;
    continue;
  }
  const line = `${formatRange(e.start, e.end).padEnd(26)} ${String(durationDays(e.start, e.end)).padStart(3)}d  ${e.title.slice(0, 50).padEnd(50)}  ${(e.location ?? "").slice(0, 28).padEnd(28)} ${e.country ?? "  "}  ${e.prize ?? ""}  [${e.source}]`;
  groups.set(cat, [...(groups.get(cat) ?? []), line]);
}

console.log(`Fetched ${fetched.events.length} listings (${fetched.events.length - events.length} duplicates), tracking ${events.length - skipped}, skipped ${skipped} (ended, >${MAX_SHORT_DAYS}d on-site, or outside Europe)\n`);
for (const cat of ["denmark", "europe", "online-short", "online-long"]) {
  const lines = groups.get(cat) ?? [];
  console.log(`== ${cat} (${lines.length})`);
  for (const l of lines.sort()) console.log("  " + l);
  console.log();
}
