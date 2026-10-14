import { describe, expect, it } from "vitest";
import { classify } from "../src/classify.ts";
import { removedView, removeModal } from "../src/removal.ts";
import { parseSettings } from "../src/settings.ts";
import { DEFAULT_LUMA_FEEDS, feedsForRun, FEEDS_PER_RUN, isHackathon, mapLuma, PRIORITY_LUMA_FEEDS, registrationStatus } from "../src/sources/luma.ts";
import type { EventRow } from "../src/types.ts";

const entry = (over: Record<string, unknown> = {}, event: Record<string, unknown> = {}) =>
  ({
    registration_availability: "open",
    ticket_info: { is_sold_out: false, require_approval: true },
    tags: [{ name: "Hackathon" }],
    ...over,
    event: {
      api_id: "evt-1",
      name: "European Defense Tech Hackathon – Copenhagen",
      start_at: "2026-11-06T08:00:00.000Z",
      end_at: "2026-11-08T17:00:00.000Z",
      timezone: "Europe/Copenhagen",
      url: "edth-2026-copenhagen",
      location_type: "offline",
      geo_address_info: { city: "Kongens Lyngby", city_state: "Kongens Lyngby, Denmark", country: "Denmark", country_code: "DK" },
      ...event,
    },
  }) as Parameters<typeof mapLuma>[0];

const feed = DEFAULT_LUMA_FEEDS[0];

describe("Luma", () => {
  it("maps EDTH Copenhagen into the Denmark category", () => {
    const e = mapLuma(entry(), feed);
    expect(e).toMatchObject({
      source: "luma",
      title: "European Defense Tech Hackathon – Copenhagen",
      url: "https://luma.com/edth-2026-copenhagen",
      start: "2026-11-06",
      end: "2026-11-08",
      country: "DK",
      mode: "in-person",
      regStatus: "Open – approval required",
    });
    expect(classify(e)).toBe("denmark");
  });

  it("uses the event's own time zone for dates", () => {
    // 23:30 UTC on the 5th is already the 6th in Copenhagen.
    expect(mapLuma(entry({}, { start_at: "2026-11-05T23:30:00.000Z" }), feed).start).toBe("2026-11-06");
  });

  it("falls back to the country name when there's no code", () => {
    expect(mapLuma(entry({}, { geo_address_info: { city: "Pristina", country: "Kosovo" } }), feed).country).toBe("XK");
  });

  it("files European events without a country as Europe", () => {
    const e = mapLuma(entry({}, { timezone: "Europe/Belgrade", geo_address_info: { city: "Pristina", city_state: "Pristina", country: null, country_code: null } }), feed);
    expect(e.country).toBe("EU");
    expect(classify(e)).toBe("europe");
  });

  it("recognizes hackathons by tag or whole-word name, not talks about hacking", () => {
    expect(isHackathon(entry())).toBe(true);
    expect(isHackathon(entry({ tags: [] }, { name: "Real-Time Video Agents Hack - LDN" }))).toBe(true);
    expect(isHackathon(entry({ tags: [] }, { name: "Buildathon w/ MongoDB" }))).toBe(true);
    expect(isHackathon(entry({ tags: [] }, { name: "Ciclo de charlas: Hacking the future" }))).toBe(false);
    expect(isHackathon(entry({ tags: [] }, { name: "Growth Hacker Meetup" }))).toBe(false);
  });

  it("describes registration status", () => {
    expect(registrationStatus(entry({ ticket_info: { is_sold_out: true } }))).toBe("Sold out");
    expect(registrationStatus(entry({ waitlist_active: true }))).toBe("Waitlist only");
    expect(registrationStatus(entry({ ticket_info: { require_approval: false } }))).toBe("Open");
  });

  it("checks priority feeds every run and rotates through the rest", () => {
    const seen = new Set<string>();
    for (let run = 0; run < 10; run++) {
      const feeds = feedsForRun(DEFAULT_LUMA_FEEDS, run);
      expect(feeds).toHaveLength(FEEDS_PER_RUN);
      for (const p of PRIORITY_LUMA_FEEDS) expect(feeds).toContainEqual(p);
      feeds.forEach((f) => seen.add(f.id));
    }
    expect(seen.size).toBe(DEFAULT_LUMA_FEEDS.length);
  });

  it("stores feeds in settings, with defaults", () => {
    expect(parseSettings({}, "1").lumaFeeds).toEqual(DEFAULT_LUMA_FEEDS);
    expect(parseSettings({ luma_feeds: JSON.stringify([feed]) }, "1").lumaFeeds).toEqual([feed]);
    expect(parseSettings({ luma_feeds: "not json" }, "1").lumaFeeds).toEqual(DEFAULT_LUMA_FEEDS);
  });
});

describe("removal", () => {
  const row = { id: 5, title: "Teen Hacks 2026", url: "https://x.dev", removed_by: "111", removed_reason: "Only high-school students || under 18", removed_at: "2026-10-14 12:00:00" } as EventRow;

  it("asks for a reason in a modal", () => {
    const m = removeModal(row, "msg");
    expect(m.type).toBe(9);
    expect(m.data.custom_id).toBe("rmvmodal:5:msg");
    expect(m.data.components[0].components[0]).toMatchObject({ custom_id: "reason", required: true });
  });

  it("keeps modal titles within Discord's 45 characters", () => {
    expect(removeModal({ id: 1, title: "A".repeat(80) }, "cmd").data.title.length).toBeLessThanOrEqual(45);
  });

  it("shows who removed it and hides the reason behind a spoiler", () => {
    const v = removedView(row);
    expect(v.content).toContain("<@111>");
    const embed = v.embeds![0] as { description: string };
    expect(embed.description).toMatch(/\|\|Only high-school students ∣∣ under 18\|\|$/);
    expect(JSON.stringify(v.components)).toContain("rst:5");
  });
});
