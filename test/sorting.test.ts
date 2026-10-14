import { describe, expect, it } from "vitest";
import { cashValueEur, formatEur } from "../src/details/prize-value.ts";
import { pageButtonId, parsePageButton, sortEvents } from "../src/interactions.ts";
import type { EventRow } from "../src/types.ts";

describe("cashValueEur", () => {
  it.each([
    ["€100,000", 100_000],
    ["$5,477 cash + 6 non-cash prizes", 5039],
    ["₹55,000 cash", 605],
    ["£2,000 (per event description)", 2340],
    ["$2k (per event description)", 1840],
    ["10,000 DKK", 1340],
    ["€1,000 + $500 cash", 1460],
  ])("%s", (prize, eur) => expect(cashValueEur(prize)).toBe(eur));

  it("counts non-cash, unlisted and title-only amounts as 0", () => {
    expect(cashValueEur("No cash · 5 non-cash prizes (1st: Momen Credits ($2000 Value))")).toBe(0);
    expect(cashValueEur("Cash prize (amount not listed)")).toBe(0);
    expect(cashValueEur("$40,000 in prizes (per title)")).toBe(0);
    expect(cashValueEur(null)).toBe(0);
  });

  it("reads European thousands separators", () => {
    expect(cashValueEur("€10.000")).toBe(10_000);
  });

  it("formats compactly", () => {
    expect(formatEur(605)).toBe("€605");
    expect(formatEur(36_432)).toBe("€36k");
    expect(formatEur(901_600)).toBe("€902k");
    expect(formatEur(1_250_000)).toBe("€1.3M");
  });
});

describe("page buttons", () => {
  it("carry the whole query and round-trip", () => {
    const q = { category: "online-short", days: 365, sort: "prize" as const, page: 3 };
    const id = pageButtonId(q, "n");
    expect(id).toBe("pg:3:online-short:365:prize:n");
    expect(id.length).toBeLessThanOrEqual(100); // Discord custom_id limit
    expect(parsePageButton(id)).toEqual(q);
  });

  it("clamps negative pages and ignores other buttons", () => {
    expect(parsePageButton("pg:-1:all:60:date:p")?.page).toBe(0);
    expect(parsePageButton("pg:noop")).toBeNull();
    expect(parsePageButton("int:42")).toBeNull();
  });
});

describe("sortEvents", () => {
  const ev = (id: number, over: Partial<EventRow>) =>
    ({ id, source: "devpost", start_date: "2026-11-01", end_date: "2026-11-03", prize: null, prize_detail: null, reg_deadline: null, ...over }) as EventRow;
  const rows = [
    ev(1, { prize_detail: "No cash · 3 non-cash prizes", start_date: "2026-10-20" }),
    ev(2, { prize_detail: "₹55,000 cash" }),
    ev(3, { prize: "€100,000", source: "mlh", end_date: "2026-11-15" }),
    ev(4, { prize_detail: "$61,500 cash + 3 non-cash prizes", reg_deadline: "2026-10-16T12:00:00.000Z" }),
  ];

  it("puts the highest cash prize first, non-cash last", () => {
    expect(sortEvents(rows, "prize").map((e) => e.id)).toEqual([3, 4, 2, 1]);
  });

  it("sorts by deadline with unknown deadlines last", () => {
    // 4 has an exact deadline; Devpost 1 and 2 close at end of submissions; MLH 3 has none.
    expect(sortEvents(rows, "deadline").map((e) => e.id)).toEqual([4, 1, 2, 3]);
  });

  it("keeps date order by default", () => {
    expect(sortEvents(rows, "date").map((e) => e.id)).toEqual([1, 2, 3, 4]);
  });
});
