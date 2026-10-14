import { parseDevpostDeadline } from "../sources/devpost.ts";
import { highSchoolOnly, htmlToText, onsiteEvidence, teamSizeFromText } from "./text.ts";

export interface PageDetails {
  deadline: string | null;
  prize: string | null;
  eligibility: string[];
  allowedCountries: string[] | null; // "Only specific countries" → these
  excludedCountries: string[];
  team: { min: number; max: number } | null;
  onsite: string | null; // evidence phrase
  highSchoolOnly: boolean;
}

const section = (html: string, id: string) => {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return "";
  // Sections are siblings; cut at the next top-level section marker.
  const next = html.slice(start + 10).search(/<(?:article|section|div) id="(?:challenge-[a-z-]+|prizes|judges|judging-criteria)"/);
  return html.slice(start, next < 0 ? start + 60_000 : start + 10 + next);
};

const splitCountries = (s: string) => s.split(/,\s*/).map((c) => c.trim()).filter(Boolean);

/** Sums "₹ 15,000 in cash" style prize values per currency. */
function cashTotal(values: string[]): string | null {
  const totals = new Map<string, number>();
  for (const v of values) {
    const m = v.match(/^(\D*?)\s*([\d,.]+)\s+in cash/i);
    if (!m) continue;
    const amount = Number(m[2].replace(/,/g, ""));
    if (!(amount > 0)) continue; // "$0 in cash" placeholders aren't cash
    const currency = m[1].trim() || "$";
    totals.set(currency, (totals.get(currency) ?? 0) + amount);
  }
  if (!totals.size) return null;
  return [...totals].map(([c, n]) => `${c}${n.toLocaleString("en-US")}`).join(" + ");
}

export function parseDevpostPage(html: string): PageDetails {
  // Who can participate
  const eligHtml = html.match(/<ul id="eligibility-list"[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? "";
  const items = [...eligHtml.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  const eligibility = items.map((li) => htmlToText(li).replace(/\s+/g, " "));
  let allowedCountries: string[] | null = null;
  let excludedCountries: string[] = [];
  for (const li of items) {
    const tip = li.match(/title="([^"]+)"/)?.[1];
    if (!tip) continue;
    if (/Only specific/i.test(li)) allowedCountries = splitCountries(tip);
    else if (/excluding/i.test(li)) excludedCountries = splitCountries(tip);
  }

  // Prizes: real cash per prize, not the amount some organizers put in the title.
  const prizesHtml = section(html, "prizes");
  const overview = htmlToText(prizesHtml.match(/<div id="prizes-overview">([\s\S]*?)<\/div>\s*<\/div>/)?.[1] ?? "").replace(/\s+/g, " ");
  const prizeBlocks = [...prizesHtml.matchAll(/<div class="[^"]*\bprize\b[^"]*" id="prize_\d+">([\s\S]*?)(?=<div class="[^"]*\bprize\b[^"]*" id="prize_|$)/g)].map((m) => m[1]);
  const values = prizeBlocks.map((b) => htmlToText(b.match(/<div class="prize-value">([\s\S]*?)<\/div>/)?.[1] ?? "").replace(/\s+/g, " "));
  // Only quote the 1st prize when it names something concrete, not "awarded to the project that…".
  const firstGiftRaw = htmlToText(prizeBlocks[0]?.match(/<p>([\s\S]*?)<\/p>/)?.[1] ?? "").replace(/\s+/g, " ");
  const firstGift = /[$€£₹]|\d|gift ?card|credits?|membership|licen[cs]e|voucher|laptop|monitor|headphones|tablet|keyboard/i.test(firstGiftRaw) &&
    !/see details|to be announced|coming (out )?soon/i.test(firstGiftRaw)
    ? firstGiftRaw
    : "";
  const cash = cashTotal(values);
  const nonCash = values.filter((v) => !/in cash/i.test(v)).length;
  let prize: string | null = null;
  if (cash) prize = `${cash} cash` + (nonCash ? ` + ${nonCash} non-cash prize${nonCash === 1 ? "" : "s"}` : "");
  else if (prizeBlocks.length) {
    prize = `No cash · ${prizeBlocks.length} non-cash prize${prizeBlocks.length === 1 ? "" : "s"}` + (firstGift ? ` (1st: ${firstGift.slice(0, 70)}${firstGift.length > 70 ? "…" : ""})` : "");
  } else if (/[1-9]/.test(overview)) prize = overview;

  // Description: the organizer's own text, where on-site requirements show up.
  const description = htmlToText(section(html, "challenge-description") + section(html, "challenge-requirements"));
  const teamLine = eligibility.find((e) => /team/i.test(e)) ?? "";

  return {
    deadline: parseDevpostDeadline(html),
    prize,
    eligibility,
    allowedCountries,
    excludedCountries,
    team: teamSizeFromText(teamLine) ?? teamSizeFromText(description),
    onsite: onsiteEvidence(description),
    highSchoolOnly: highSchoolOnly(eligibility, description),
  };
}
