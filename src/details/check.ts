import { USER_AGENT, type EventRow } from "../types.ts";
import { parseDevpostPage } from "./devpost-page.ts";
import { formatTeamSize, highSchoolOnly, htmlToText, onsiteEvidence, prizeFromText, teamSizeFromText } from "./text.ts";

/** Who we check eligibility for. */
export const TEAM = { size: 4, country: "Denmark" };

/** What checking an event's own page found. Null fields mean "page doesn't say". */
export interface CheckResult {
  deadline?: string | null;
  prize?: string | null;
  teamSize?: string | null;
  eligibility?: string | null;
  note?: string | null; // warnings shown on the post
  removeReason?: string | null; // set when the team can't take part
}

/**
 * Decides whether a team of 4 from Denmark can take part. Returns a reason when not.
 * Only uses what the page states, so a missing field never removes an event.
 */
export function assess(input: {
  listedMode: EventRow["mode"];
  allowedCountries?: string[] | null;
  excludedCountries?: string[];
  team?: { min: number; max: number } | null;
  onsite?: string | null;
  highSchoolOnly?: boolean;
}): { removeReason: string | null; note: string | null } {
  const notes: string[] = [];
  if (input.allowedCountries && !input.allowedCountries.some((c) => c.toLowerCase() === TEAM.country.toLowerCase())) {
    return { removeReason: `Only open to participants from: ${input.allowedCountries.join(", ")}`, note: null };
  }
  if (input.excludedCountries?.some((c) => c.toLowerCase() === TEAM.country.toLowerCase())) {
    return { removeReason: `${TEAM.country} is excluded from participation`, note: null };
  }
  if (input.highSchoolOnly) return { removeReason: "Only for high-school students", note: null };
  if (input.team && (input.team.min > TEAM.size || input.team.max < TEAM.size)) {
    return { removeReason: `Team size must be ${formatTeamSize(input.team)} (yours is ${TEAM.size})`, note: null };
  }
  if (input.listedMode === "online" && input.onsite) {
    return { removeReason: `Listed as online, but the page requires being there in person: “${input.onsite}”`, note: null };
  }
  if (input.onsite && input.listedMode !== "online") notes.push(`On-site: “${input.onsite}”`);
  return { removeReason: null, note: notes.join("\n") || null };
}

/** Eligibility lines worth showing (drops boilerplate). */
const usefulEligibility = (items: string[]) =>
  items
    .filter((e) => !/companies\/professional organizations excluded|excluding standard exceptions/i.test(e))
    .map((e) => e.replace(/Only specific countries\/territories included/i, "Specific countries only"))
    .join(" · ") || null;

async function checkDevpost(e: EventRow): Promise<CheckResult> {
  const res = await fetch(e.url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Devpost page HTTP ${res.status}`);
  const d = parseDevpostPage(await res.text());
  const verdict = assess({ listedMode: e.mode, ...d });
  const elig = usefulEligibility(d.eligibility);
  return {
    deadline: d.deadline,
    prize: d.prize,
    teamSize: d.team ? formatTeamSize(d.team) : null,
    eligibility: d.allowedCountries ? `${elig ?? ""}${elig ? " · " : ""}Countries: ${d.allowedCountries.join(", ")}` : elig,
    ...verdict,
  };
}

interface ProseNode {
  type?: string;
  text?: string;
  content?: ProseNode[];
}

const proseText = (n: ProseNode | ProseNode[] | null | undefined): string => {
  if (!n) return "";
  if (Array.isArray(n)) return n.map(proseText).join("");
  const inner = (n.text ?? "") + proseText(n.content);
  return /paragraph|heading|list_item/.test(n.type ?? "") ? inner + "\n" : inner;
};

async function checkLuma(e: EventRow): Promise<CheckResult> {
  const apiId = e.source_key.slice("luma:".length);
  const res = await fetch(`https://api.lu.ma/event/get?event_api_id=${apiId}`, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Luma event HTTP ${res.status}`);
  const data = (await res.json()) as { description_mirror?: ProseNode };
  const text = proseText(data.description_mirror);
  const team = teamSizeFromText(text);
  const onsite = e.mode === "online" ? onsiteEvidence(text) : null;
  const studentsOnly = /\b(?:students only|only (?:for )?students|open to (?:all )?students)\b/i.test(text);
  const verdict = assess({ listedMode: e.mode, team, onsite, highSchoolOnly: highSchoolOnly([], text) });
  const prize = prizeFromText(text);
  return {
    prize: prize ? `${prize} (per event description)` : null,
    teamSize: team ? formatTeamSize(team) : null,
    eligibility: studentsOnly ? "Students only" : null,
    ...verdict,
  };
}

/** Checks the event's own page. Sources with nothing more to read return null. */
export async function checkEventPage(e: EventRow): Promise<CheckResult | null> {
  if (e.source === "devpost") return checkDevpost(e);
  if (e.source === "luma") return checkLuma(e);
  return null;
}

export { htmlToText };
