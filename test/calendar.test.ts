import { describe, expect, it } from "vitest";
import { googleCalendarUrl, icsFile } from "../src/calendar.ts";
import { deadlineText } from "../src/discord/embeds.ts";
import { describePrize, parseDevpostDeadline } from "../src/sources/devpost.ts";
import type { EventRow } from "../src/types.ts";

const row = (over: Partial<EventRow> = {}): EventRow => ({
  id: 7, source_key: "devpost:1", source: "devpost", title: "UnivaBio ($40,000 in prizes)", dedupe_key: "univabio",
  url: "https://univabio.devpost.com/", source_url: "https://univabio.devpost.com/",
  start_date: "2026-08-07", end_date: "2026-10-20", location: "Online", country: null, mode: "online",
  category: "online-long", prize: null, team_size: null, themes: null, fingerprint: "",
  reg_deadline: "2026-10-21T03:45:00.000Z", deadline_checked: 1, reg_status: null,
  removed_at: null, removed_by: null, removed_reason: null,
  prize_detail: null, eligibility: null, verify_note: null, flagship: 0,
  first_seen: "", updated_at: "2026-10-14 10:00:00", posted_at: null, message_id: null, ...over,
});

describe("describePrize", () => {
  const h = (title: string, prize_amount: string, cash: number, other: number) => ({ title, prize_amount, prizes_counts: { cash, other } });
  it("prefers the cash amount", () => {
    expect(describePrize(h("PayPal AI Hackathon", "$<span data-currency-value>67,500</span>", 3, 0))).toBe("$67,500");
  });
  it("falls back to an amount in the title", () => {
    expect(describePrize(h("UnivaBio ($40,000 in prizes) ", "$<span data-currency-value>0</span>", 0, 5))).toBe("$40,000 in prizes (per title)");
    expect(describePrize(h("DSH Hacks V2 ($100k+ in prizes!)", "$<span>0</span>", 0, 5))).toBe("$100k+ in prizes (per title)");
  });
  it("counts non-cash prizes, then unnamed cash prizes", () => {
    expect(describePrize(h("MLAI Hackathon 2026", "$<span>0</span>", 0, 4))).toBe("4 non-cash prizes");
    expect(describePrize(h("Bridge The Gap Hacks", "$<span>0</span>", 1, 0))).toBe("Cash prize (amount not listed)");
    expect(describePrize(h("Nothing", "$<span>0</span>", 0, 0))).toBeNull();
  });
});

describe("parseDevpostDeadline", () => {
  it("reads the deadline and converts to UTC", () => {
    const html = `<div class="deadline">Deadline</div><time data-iso-date="2026-10-20T23:45:00-04:00">Oct 20</time>`;
    expect(parseDevpostDeadline(html)).toBe("2026-10-21T03:45:00.000Z");
  });
  it("returns null without a date", () => {
    expect(parseDevpostDeadline("<p>no dates</p>")).toBeNull();
  });
});

describe("deadlineText", () => {
  it("uses Discord timestamps when the deadline is known", () => {
    expect(deadlineText(row(), "short")).toBe("<t:1792554300:f> (<t:1792554300:R>)");
  });
  it("falls back to the submission end for Devpost, and says when unpublished", () => {
    expect(deadlineText(row({ reg_deadline: null }), "short")).toBe("by 20 Oct 2026 (end of submissions)");
    expect(deadlineText(row({ reg_deadline: null, source: "mlh" }), "long")).toBe("Not published – check event page");
  });
});

describe("googleCalendarUrl", () => {
  it("uses the deadline for long online events", () => {
    const u = new URL(googleCalendarUrl(row()));
    expect(u.searchParams.get("text")).toBe("Deadline: UnivaBio ($40,000 in prizes)");
    expect(u.searchParams.get("dates")).toBe("20261021T034500Z/20261021T034500Z");
  });
  it("uses all-day dates (end exclusive) for short events", () => {
    const u = new URL(googleCalendarUrl(row({ category: "europe", mode: "in-person", start_date: "2026-11-27", end_date: "2026-11-29", reg_deadline: null })));
    expect(u.searchParams.get("dates")).toBe("20261127/20261130");
  });
});

describe("icsFile", () => {
  const ics = icsFile(row({ title: "A, very; long \\ title ".repeat(6) }), new Date("2026-10-14T10:00:00Z"));
  it("has the event plus a deadline with a 1-day alarm", () => {
    expect(ics).toContain("DTSTART;VALUE=DATE:20260807");
    expect(ics).toContain("DTEND;VALUE=DATE:20261021");
    expect(ics).toContain("DTSTART:20261021T034500Z");
    expect(ics).toContain("TRIGGER:-P1D");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });
  it("uses CRLF, escapes text and folds long lines", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics).toContain("A\\, very\\; long \\\\ title");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
