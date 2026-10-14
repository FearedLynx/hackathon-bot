// Text heuristics used when checking an event's own page. Each returns null when the
// page doesn't say, so callers can tell "not stated" from "stated".

export const htmlToText = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|li|h\d|div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

/** "Team required: 2 to 5 members", "teams of up to 4", "between 2 and 4 members", "teams of 3–5". */
export function teamSizeFromText(text: string): { min: number; max: number } | null {
  const t = text.replace(/[–—]/g, "-");
  const range =
    t.match(/teams?[^.\n]{0,40}?(?:between\s+)?(\d)\s*(?:-|to|and)\s*(\d+)\s*(?:members|people|participants|persons)?/i) ??
    t.match(/(\d)\s*(?:-|to)\s*(\d+)\s*(?:members|people|participants|persons)\s*(?:per|in a|each)?\s*team/i);
  if (range) {
    const [min, max] = [Number(range[1]), Number(range[2])];
    if (min >= 1 && max >= min && max <= 20) return { min, max };
  }
  const upTo = t.match(/teams?[^.\n]{0,30}?(?:up to|max(?:imum)?(?: of)?|at most|no more than)\s*(\d+)/i);
  if (upTo) return { min: 1, max: Number(upTo[1]) };
  if (/\b(individual|solo)( participants?)? only\b|\bno teams\b/i.test(t)) return { min: 1, max: 1 };
  return null;
}

export const formatTeamSize = (t: { min: number; max: number }) =>
  t.min === t.max ? `${t.min} ${t.min === 1 ? "person (solo)" : "people"}` : t.min <= 1 ? `Up to ${t.max} people` : `${t.min}–${t.max} people`;

// Phrases that only make sense if you have to be there in person. Kept specific on
// purpose: generic words like "in-person" also appear in online hackathons' copy.
const ONSITE_PATTERNS: RegExp[] = [
  /\bbring (?:one|your|a|the) (?:working |functional |own )?(?:robot|drone|rover|vehicle|bot|hardware prototype)\b[^.\n]{0,40}/i,
  /\btechnical inspection\b[^.\n]{0,40}/i,
  /\b(?:on[- ]site|in[- ]person|offline|physical) (?:only|event|round|finale?|competition|participation|attendance) (?:at|in|on)\b[^.\n]{0,50}/i,
  /\b(?:must|need to|required to|have to) (?:be present|attend in person|attend on[- ]site|travel to)\b[^.\n]{0,50}/i,
  /\b(?:venue|location) ?: ?[A-Z][^.\n]{3,60}/,
  /\bon(?:-| )campus (?:at|of)\b[^.\n]{0,50}/i,
  /\breport(?:ing)? (?:to|at) the venue\b[^.\n]{0,40}/i,
  /\b(?:timed|qualifier) runs? on (?:the|a) (?:course|track|arena)\b[^.\n]{0,30}/i,
];

/** First phrase showing the event needs physical attendance, or null. */
export function onsiteEvidence(text: string): string | null {
  for (const re of ONSITE_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0].trim().replace(/\s+/g, " ").slice(0, 90);
  }
  return null;
}

/** True when only high-school (or younger) students may join. */
export function highSchoolOnly(eligibility: string[], description: string): boolean {
  if (eligibility.some((e) => /high[- ]school students only|secondary school students only|middle school/i.test(e))) return true;
  const grades = /\b(?:grades?|class(?:es)?) ?(?:6|7|8|9)\s*(?:-|–|to)\s*(?:10|11|12)\b/i.test(description);
  const university = /\b(?:college|university|undergraduate|graduate|professionals?|adults?)\b/i.test(description);
  return grades && !university;
}

const CURRENCY = String.raw`(?:€|EUR|\$|USD|£|GBP|DKK|SEK|NOK|CHF|kr\.?|₹)`;
const AMOUNT = String.raw`\d[\d.,]*\s?(?:k|K|000)?\+?`;

/** A prize amount stated in free text, e.g. "€10,000 prize pool" or "prizes worth $5k". */
export function prizeFromText(text: string): string | null {
  const before = text.match(new RegExp(`(${CURRENCY}\\s?${AMOUNT}|${AMOUNT}\\s?${CURRENCY})(?=[^.\\n]{0,40}\\b(?:prizes?|prize pool|in cash|cash prize|awards?)\\b)`, "i"));
  const after = text.match(new RegExp(`\\b(?:prizes?|prize pool|cash prizes?|awards?)\\b[^.\\n]{0,40}?(${CURRENCY}\\s?${AMOUNT}|${AMOUNT}\\s?${CURRENCY})`, "i"));
  const amount = (before ?? after)?.[1]?.trim();
  return amount && /[1-9]/.test(amount) ? amount.replace(/\s+/g, " ") : null;
}
