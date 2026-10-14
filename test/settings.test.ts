import { describe, expect, it } from "vitest";
import { canConfigure } from "../src/config-command.ts";
import { isValidTimezone, localTime, parseSettings } from "../src/settings.ts";

describe("parseSettings", () => {
  it("falls back to defaults", () => {
    expect(parseSettings({}, "123")).toMatchObject({
      mode: "instant",
      dailyHour: 10,
      timezone: "Europe/Copenhagen",
      channelId: "123",
      categories: ["denmark", "europe", "online-short", "online-long"],
      lastDigestDate: null,
    });
  });

  it("reads stored values and ignores invalid ones", () => {
    const s = parseSettings(
      { mode: "daily", daily_hour: "8", timezone: "Europe/Warsaw", channel_id: "999", categories: "denmark,bogus,europe" },
      "123",
    );
    expect(s).toMatchObject({ mode: "daily", dailyHour: 8, timezone: "Europe/Warsaw", channelId: "999", categories: ["denmark", "europe"] });
    expect(parseSettings({ mode: "weekly", daily_hour: "25", timezone: "Mars/Base" }, "1")).toMatchObject({
      mode: "instant",
      dailyHour: 10,
      timezone: "Europe/Copenhagen",
    });
  });

  it("keeps an explicitly empty category list", () => {
    expect(parseSettings({ categories: "" }, "1").categories).toEqual([]);
  });
});

describe("localTime", () => {
  it("handles Copenhagen summer and winter time", () => {
    // 10:00 local = 08:00 UTC in summer (CEST), 09:00 UTC in winter (CET)
    expect(localTime("Europe/Copenhagen", new Date("2026-07-01T08:00:00Z"))).toEqual({ date: "2026-07-01", hour: 10 });
    expect(localTime("Europe/Copenhagen", new Date("2026-12-01T09:00:00Z"))).toEqual({ date: "2026-12-01", hour: 10 });
  });

  it("rolls the date over at local midnight", () => {
    expect(localTime("Europe/Copenhagen", new Date("2026-12-31T23:30:00Z"))).toEqual({ date: "2027-01-01", hour: 0 });
  });

  it("validates time zones", () => {
    expect(isValidTimezone("Europe/Copenhagen")).toBe(true);
    expect(isValidTimezone("Copenhagen")).toBe(false);
  });
});

describe("canConfigure", () => {
  it("needs Manage Server or Administrator", () => {
    expect(canConfigure("32")).toBe(true); // MANAGE_GUILD
    expect(canConfigure("8")).toBe(true); // ADMINISTRATOR
    expect(canConfigure("2048")).toBe(false); // SEND_MESSAGES only
    expect(canConfigure(undefined)).toBe(false);
  });
});
