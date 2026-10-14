import { describe, expect, it } from "vitest";
import { classify, dedupeEvents, dedupeKey } from "../src/classify.ts";
import { formatRange, parseDevpostRange } from "../src/dates.ts";
import { parseDevEvents } from "../src/sources/devevents.ts";
import { cleanPrize } from "../src/sources/devpost.ts";
import { mlhSeason, parseMlh } from "../src/sources/mlh.ts";
import type { RawEvent } from "../src/types.ts";

const ev = (over: Partial<RawEvent>): RawEvent => ({
  source: "test", sourceId: "1", title: "Test Hack", url: "https://x.dev", sourceUrl: "https://x.dev",
  start: "2026-11-27", end: "2026-11-29", location: null, country: null, mode: "online",
  prize: null, teamSize: null, themes: [], ...over,
});

describe("parseDevpostRange", () => {
  it.each([
    ["Aug 31 - Oct 23, 2026", "2026-08-31", "2026-10-23"],
    ["Oct 05 - 27, 2026", "2026-10-05", "2026-10-27"],
    ["Nov 01, 2026", "2026-11-01", "2026-11-01"],
    ["Jul 16, 2026 - Jan 15, 2027", "2026-07-16", "2027-01-15"],
    ["Dec 30 - Jan 02, 2027", "2026-12-30", "2027-01-02"],
  ])("%s", (input, start, end) => {
    expect(parseDevpostRange(input)).toEqual({ start, end });
  });

  it("rejects garbage", () => {
    expect(parseDevpostRange("sometime soon")).toBeNull();
  });
});

describe("formatRange", () => {
  it("formats same month, cross month, cross year, single day", () => {
    expect(formatRange("2026-11-27", "2026-11-29")).toBe("27–29 Nov 2026");
    expect(formatRange("2026-10-30", "2026-11-01")).toBe("30 Oct – 1 Nov 2026");
    expect(formatRange("2026-12-30", "2027-01-02")).toBe("30 Dec 2026 – 2 Jan 2027");
    expect(formatRange("2026-11-01", "2026-11-01")).toBe("1 Nov 2026");
  });
});

describe("classify", () => {
  it("files on-site events by country", () => {
    expect(classify(ev({ mode: "in-person", country: "DK" }))).toBe("denmark");
    expect(classify(ev({ mode: "in-person", country: "DE" }))).toBe("europe");
    expect(classify(ev({ mode: "in-person", country: "US" }))).toBeNull();
  });

  it("drops on-site events longer than 5 days", () => {
    expect(classify(ev({ mode: "in-person", country: "DK", end: "2026-12-05" }))).toBeNull();
  });

  it("splits online events by length", () => {
    expect(classify(ev({ end: "2026-12-01" }))).toBe("online-short"); // 5 days
    expect(classify(ev({ end: "2026-12-02" }))).toBe("online-long"); // 6 days
  });

  it("treats far-away hybrid events as online", () => {
    expect(classify(ev({ mode: "hybrid", country: "US" }))).toBe("online-short");
  });

  it("drops in-person events with unknown country", () => {
    expect(classify(ev({ mode: "in-person" }))).toBeNull();
  });
});

describe("dedupe", () => {
  it("normalizes titles", () => {
    expect(dedupeKey("PayPal AI Hackathon")).toBe(dedupeKey("PayPal AI  hackathon!"));
  });

  it("keeps the first of two listings of the same event", () => {
    const a = ev({ source: "devpost", title: "PayPal AI Hackathon", prize: "$67,500" });
    const b = ev({ source: "dev.events", title: "PayPal AI Hackathon", start: "2026-11-28" });
    const c = ev({ source: "dev.events", title: "PayPal AI Hackathon", start: "2027-11-27" });
    expect(dedupeEvents([a, b, c])).toEqual([a, c]);
  });
});

describe("cleanPrize", () => {
  it("strips Devpost markup and drops zero prizes", () => {
    expect(cleanPrize("$<span data-currency-value>138,000</span>")).toBe("$138,000");
    expect(cleanPrize("₹ <span data-currency-value>100,000</span>")).toBe("₹ 100,000");
    expect(cleanPrize("$<span data-currency-value>0</span>")).toBeNull();
    expect(cleanPrize(null)).toBeNull();
  });
});

describe("parseDevEvents", () => {
  const block = (o: object) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
  const html =
    block({ "@type": "BreadcrumbList" }) +
    block({
      "@type": "EducationEvent", name: "Clean Architecture Masterclass", description: "Tech masterclass Online",
      startDate: "2026-12-10T00:00:00.000+00:00", url: "https://dev.events/conferences/clean-arch",
      eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    }) +
    block({
      "@type": "EducationEvent", name: "BaselHack 2026", description: "Tech hackathon in Basel, Switzerland",
      startDate: "2026-10-30T00:00:00.000+00:00", endDate: "2026-11-01T00:00:00.000+00:00",
      url: "https://dev.events/conferences/baselhack-2026",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      location: { name: "Basel, Switzerland", address: { addressLocality: "Basel", addressRegion: "Switzerland" } },
    });

  it("keeps hackathons only and reads country", () => {
    const out = parseDevEvents(html, "https://dev.events/hackathons/EU/tech");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      title: "BaselHack 2026", start: "2026-10-30", end: "2026-11-01",
      mode: "in-person", country: "CH", sourceId: "baselhack-2026",
    });
    expect(classify(out[0])).toBe("europe");
  });
});

describe("parseMlh", () => {
  const page = (events: object[]) =>
    `<script data-page="app" type="application/json">${JSON.stringify({ props: { upcomingEvents: events } })}</script>`;
  const base = {
    id: "a", url: "/events/x/prizes", websiteUrl: "https://x.example", startsAt: "2026-11-14T14:30:00Z",
    endsAt: "2026-11-15T18:00:00Z", formatType: "physical",
  };

  it("keeps EMEA on-site events and maps country codes", () => {
    const out = parseMlh(
      page([
        { ...base, name: "DurHack", location: "Durham", region: "EMEA", venueAddress: { country: "GB" } },
        { ...base, id: "b", name: "HackGB", location: "Green Bay, WI", region: "AMER", venueAddress: { country: "US" } },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: "DurHack", country: "GB", mode: "in-person", start: "2026-11-14", url: "https://x.example" });
  });

  it("names seasons after the year they end in", () => {
    expect(mlhSeason(new Date("2026-10-13"))).toBe(2027);
    expect(mlhSeason(new Date("2027-03-01"))).toBe(2027);
  });
});
