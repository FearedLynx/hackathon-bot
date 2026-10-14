import { describe, expect, it } from "vitest";
import { assess } from "../src/details/check.ts";
import { parseDevpostPage } from "../src/details/devpost-page.ts";
import { highSchoolOnly, onsiteEvidence, prizeFromText, teamSizeFromText } from "../src/details/text.ts";
import { parseDeadlineText, parseTextDateRange } from "../src/sources/sites.ts";

// Trimmed from the real Hybrid Micro Mouse Challenge page (listed "Online", held in India).
const mousePage = `
<ul id="eligibility-list" class="no-bullet">
  <li>Ages 13+ only</li>
  <li>Students only</li>
  <li>Team required: 2 to 5 members</li>
  <li>Companies/professional organizations excluded from participation</li>
  <li> Only specific <span data-tooltip title="India" class="has-tip nowrap"> countries/territories included </span> </li>
</ul>
<span data-iso-date="2026-10-29T09:00:00+05:30">Oct 29</span>
<div id="challenge-description"><p>Build, program, and test autonomous robots.</p>
<p>Bring your robot, refine your algorithms, calibrate your sensors.</p></div>
<article id="challenge-requirements"><p>4. Technical Inspection The robot will be inspected for size.</p></article>
<div id="prizes"> <h3>Prizes</h3>
  <div id="prizes-overview"> <div class="row"> <div class="column-left">₹ <span>55,000</span> in prizes</div> </div> </div>
  <div class="small-12 large-6 columns end prize" id="prize_1"><h6>College Edition — Winner</h6>
    <div class="prize-content"><div class="prize-value"> <span>₹ <span>15,000</span></span> in cash </div><p>Certificate</p></div></div>
  <div class="small-12 large-6 columns end prize" id="prize_2"><h6>Runner-up</h6>
    <div class="prize-content"><div class="prize-value"> <span>₹ <span>10,000</span></span> in cash </div><p>Certificate</p></div></div>
</div>
<div id="judges"></div>`;

// Trimmed from UnivaBio: "$40,000 in prizes" in the title, but only credits.
const univabioPage = `
<ul id="eligibility-list"><li>Ages 13+ only</li><li>Students only</li>
<li> All countries/territories, excluding <span data-tooltip title="Brazil, Crimea, Cuba, Iran, North Korea, Quebec, Russia">standard exceptions</span> </li></ul>
<div id="prizes"> <div id="prizes-overview"> <div class="row"> <div class="column-left">5 non-cash prizes</div> </div> </div>
  <div class="small-12 large-6 columns end prize" id="prize_1"><h6>1st Place</h6><div class="prize-content"><div class="prize-value"> </div>
  <p>Momen Credits ($2000 Value) </p><p>CodeCrafters 2 Yr Membership ($720 Value)</p></div></div>
</div>`;

describe("parseDevpostPage", () => {
  it("reads eligibility, countries, team size, cash and on-site evidence", () => {
    const d = parseDevpostPage(mousePage);
    expect(d.allowedCountries).toEqual(["India"]);
    expect(d.team).toEqual({ min: 2, max: 5 });
    expect(d.prize).toBe("₹25,000 cash"); // 15,000 + 10,000
    expect(d.onsite).toMatch(/^Bring your robot/);
    expect(d.deadline).toBe("2026-10-29T03:30:00.000Z");
  });

  it("reports non-cash prizes as such, ignoring the amount in the title", () => {
    const d = parseDevpostPage(univabioPage);
    expect(d.prize).toBe("No cash · 1 non-cash prize (1st: Momen Credits ($2000 Value))");
    expect(d.allowedCountries).toBeNull();
    expect(d.excludedCountries).toContain("Russia");
  });
});

describe("prize edge cases", () => {
  const page = (value: string, gift: string) => `<div id="prizes"><div id="prizes-overview"><div class="row"><div>2 prizes</div></div></div>
    <div class="small-12 columns end prize" id="prize_1"><h6>1st</h6><div class="prize-content"><div class="prize-value">${value}</div><p>${gift}</p></div></div></div>`;

  it("doesn't count $0 cash", () => {
    expect(parseDevpostPage(page("$<span>0</span> in cash", "Certificate")).prize).toBe("No cash · 1 non-cash prize");
  });

  it("only quotes concrete first prizes", () => {
    expect(parseDevpostPage(page("", "Awarded to the project that best embodies the theme")).prize).toBe("No cash · 1 non-cash prize");
    expect(parseDevpostPage(page("", "See details at Event URL")).prize).toBe("No cash · 1 non-cash prize");
    expect(parseDevpostPage(page("", "$10,000 in OpenAI credits")).prize).toBe("No cash · 1 non-cash prize (1st: $10,000 in OpenAI credits)");
  });
});

describe("assess (team of 4 from Denmark)", () => {
  it("removes the online-listed mouse challenge (India only)", () => {
    const d = parseDevpostPage(mousePage);
    expect(assess({ listedMode: "online", ...d }).removeReason).toBe("Only open to participants from: India");
  });

  it("removes online-listed events that need physical attendance", () => {
    expect(assess({ listedMode: "online", onsite: "Bring your robot" }).removeReason).toMatch(/Listed as online.*Bring your robot/);
  });

  it("removes high-school-only events and team sizes that exclude 4", () => {
    expect(assess({ listedMode: "online", highSchoolOnly: true }).removeReason).toBe("Only for high-school students");
    expect(assess({ listedMode: "online", team: { min: 1, max: 3 } }).removeReason).toBe("Team size must be Up to 3 people (yours is 4)");
    expect(assess({ listedMode: "online", team: { min: 5, max: 6 } }).removeReason).toMatch(/5–6 people/);
  });

  it("keeps events that fit, including ones that don't state anything", () => {
    expect(assess({ listedMode: "online", team: { min: 2, max: 5 }, excludedCountries: ["Russia"] }).removeReason).toBeNull();
    expect(assess({ listedMode: "in-person" }).removeReason).toBeNull();
  });

  it("removes events excluding Denmark", () => {
    expect(assess({ listedMode: "online", excludedCountries: ["Denmark"] }).removeReason).toMatch(/Denmark is excluded/);
  });
});

describe("text heuristics", () => {
  it.each([
    ["Team required: 2 to 5 members", { min: 2, max: 5 }],
    ["Teams at Junction 2026 are up to 4 people", { min: 1, max: 4 }],
    ["A team must have between 2 and 4 members", { min: 2, max: 4 }],
    ["Teams of 3–5 participants", { min: 3, max: 5 }],
    ["Individual participants only", { min: 1, max: 1 }],
  ])("team size: %s", (text, expected) => expect(teamSizeFromText(text)).toEqual(expected));

  it("doesn't take generic 'in-person' marketing copy as on-site evidence", () => {
    expect(onsiteEvidence("Best practices for planning online and in-person hackathons")).toBeNull();
    expect(onsiteEvidence("Participants must be present at the venue in Bengaluru")).toMatch(/must be present/);
  });

  it("detects high-school-only events", () => {
    expect(highSchoolOnly(["High school students only"], "")).toBe(true);
    expect(highSchoolOnly([], "Open to students in grades 9-12")).toBe(true);
    expect(highSchoolOnly([], "School edition: grades 9–12. College edition: university students")).toBe(false);
  });

  it("finds prize amounts stated in text", () => {
    expect(prizeFromText("2,000 builders, 48 hours, €100,000 in prizes")).toBe("€100,000");
    expect(prizeFromText("The prize pool is $10k for the winners")).toBe("$10k");
    expect(prizeFromText("Free entry, great food")).toBeNull();
  });
});

describe("flagship site parsing", () => {
  it("reads date ranges from plain text, inferring missing years", () => {
    expect(parseTextDateRange("hackaTUM takes place 27-29 November 2026 in Garching", "2026-10-14")).toEqual({ start: "2026-11-27", end: "2026-11-29" });
    expect(parseTextDateRange("Student hackathon in Barcelona on April 24-26 for 36 hours", "2026-10-14")).toEqual({ start: "2027-04-24", end: "2027-04-26" });
    expect(parseTextDateRange("Junction 2025: Nov 14–16, 2025", "2026-10-14")).toBeNull();
  });

  it("reads application deadlines, skipping the FAQ question", () => {
    const faq = "When is the Junction 2026 application deadline?\nApplications for Junction 2026 close at Midnight 25.10.2026 GMT +03.";
    expect(parseDeadlineText(faq)).toBe("2026-10-25T20:59:00.000Z");
    expect(parseDeadlineText("Registration deadline: October 30, 2026")).toBe("2026-10-30T23:59:00.000Z");
  });
});
