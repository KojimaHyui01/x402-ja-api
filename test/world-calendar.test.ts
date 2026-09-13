import { describe, expect, it } from "vitest";
import {
  WorldCalendarInputError,
  addBusinessDaysIn,
  describeDateIn,
  holidaysFor,
  listCountries,
  listRegions,
  weekendFor,
} from "../src/lib/world-calendar.js";

describe("countries / regions", () => {
  it("lists ~200 countries with English names", () => {
    const c = listCountries();
    expect(c.length).toBeGreaterThan(180);
    expect(c.find((x) => x.code === "DE")?.name).toBe("Germany");
  });
  it("lists regions for federal countries", () => {
    expect(listRegions("US").length).toBeGreaterThan(50);
    expect(listRegions("DE").find((r) => r.code === "BY")?.name).toMatch(/Bayern|Bavaria/);
    expect(listRegions("JP")).toEqual([]);
  });
  it("rejects unknown country codes", () => {
    expect(() => holidaysFor("XX", 2026)).toThrow(WorldCalendarInputError);
    expect(() => holidaysFor("DE", 2026, { region: "ZZ" })).toThrow(WorldCalendarInputError);
  });
});

describe("holidaysFor", () => {
  it("returns English and local names with types", () => {
    const de = holidaysFor("DE", 2026, { region: "BY" });
    const ny = de.find((h) => h.date === "2026-01-01");
    expect(ny).toMatchObject({ name: "New Year's Day", localName: "Neujahr", type: "public" });
    expect(de.some((h) => h.type === "public" && h.date === "2026-01-06")).toBe(true); // Heilige Drei Könige (BY only)
  });
  it("filters by type and matches JP official data on the tricky day", () => {
    const jp = holidaysFor("JP", 2026, { types: ["public"] });
    expect(jp.every((h) => h.type === "public")).toBe(true);
    expect(jp.find((h) => h.date === "2026-09-22")?.localName).toBe("国民の休日");
  });
  it("US federal vs state holidays", () => {
    const us = holidaysFor("US", 2026, { types: ["public"] });
    expect(us.some((h) => h.name.includes("Independence"))).toBe(true);
    const tx = holidaysFor("US", 2026, { region: "TX" });
    expect(tx.length).toBeGreaterThanOrEqual(us.length);
  });
});

describe("weekendFor", () => {
  it("knows Fri-Sat and Fri-only countries, defaults to Sat-Sun", () => {
    expect(weekendFor("SA")).toEqual([5, 6]);
    expect(weekendFor("IR")).toEqual([5]);
    expect(weekendFor("DE")).toEqual([6, 0]);
  });
});

describe("business days worldwide", () => {
  it("skips a German public holiday", () => {
    // Fri 2026-10-02 → Sat, Sun, Mon 2026-10-05? No: 2026-10-03 (Sat) is Tag der Deutschen Einheit; next business day Mon 10-05
    expect(addBusinessDaysIn("DE", "2026-10-02", 1)).toBe("2026-10-05");
    // Thu 2026-12-24 + 1 → Mon 12-28 (25, 26 public; 27 Sunday)
    expect(addBusinessDaysIn("DE", "2026-12-24", 1)).toBe("2026-12-28");
  });
  it("uses Fri-Sat weekend for Saudi Arabia", () => {
    // 2026-09-17 is Thursday → next business day is Sunday 2026-09-20
    expect(addBusinessDaysIn("SA", "2026-09-17", 1)).toBe("2026-09-20");
  });
  it("honours an explicit weekend override", () => {
    expect(addBusinessDaysIn("DE", "2026-09-17", 1, { weekend: [5, 6] })).toBe("2026-09-20");
  });
  it("describes a US holiday", () => {
    const d = describeDateIn("US", "2026-07-03"); // observed Independence Day (Jul 4 is Saturday)
    expect(d.isBusinessDay).toBe(false);
    expect(d.holidays[0]?.name).toMatch(/Independence Day/);
    expect(d.nextBusinessDay).toBe("2026-07-06");
  });
  it("validates inputs", () => {
    expect(() => addBusinessDaysIn("DE", "2026-02-30", 1)).toThrow(WorldCalendarInputError);
    expect(() => addBusinessDaysIn("DE", "2026-01-01", 5000)).toThrow(WorldCalendarInputError);
  });
});
