import { describe, expect, it } from "vitest";
import {
  CalendarInputError,
  addBusinessDays,
  businessDaysBetween,
  describeDate,
  holidayName,
  holidaysInYear,
  isBusinessDay,
  lastBusinessDayOfMonth,
  nextBusinessDay,
} from "../src/lib/calendar.js";

describe("holidays (内閣府 CSV)", () => {
  it("knows fixed and substitute holidays", () => {
    expect(holidayName("2026-01-01")).toBe("元日");
    expect(holidayName("2026-05-06")).toBe("休日"); // 振替休日 for 憲法記念日 on Sunday (2026-05-03)
    expect(holidayName("2026-09-22")).toBe("休日"); // 国民の休日 sandwiched between two holidays
    expect(holidayName("2026-09-13")).toBeNull();
  });
  it("lists a whole year", () => {
    const list = holidaysInYear(2026);
    expect(list.length).toBeGreaterThanOrEqual(16);
    expect(list[0]).toEqual({ date: "2026-01-01", name: "元日" });
    expect(list.every((h) => h.date.startsWith("2026-"))).toBe(true);
  });
  it("rejects years outside the dataset", () => {
    expect(() => holidaysInYear(1900)).toThrow(CalendarInputError);
    expect(() => holidaysInYear(2099)).toThrow(CalendarInputError);
  });
});

describe("isBusinessDay", () => {
  it("weekends and holidays are not business days", () => {
    expect(isBusinessDay("2026-09-12")).toBe(false); // Saturday
    expect(isBusinessDay("2026-09-13")).toBe(false); // Sunday
    expect(isBusinessDay("2026-09-14")).toBe(true); // Monday
    expect(isBusinessDay("2026-09-21")).toBe(false); // 敬老の日
  });
  it("bank calendar closes 12/31-1/3, standard does not", () => {
    expect(isBusinessDay("2026-12-31", "standard")).toBe(true); // Thursday
    expect(isBusinessDay("2026-12-31", "bank")).toBe(false);
    expect(isBusinessDay("2027-01-04", "bank")).toBe(true); // Monday
  });
});

describe("addBusinessDays / nextBusinessDay", () => {
  it("skips weekends and holidays going forward", () => {
    // Fri 2026-09-18 → Sat, Sun, Mon 敬老の日, Tue 国民の休日, Wed 秋分の日 all skipped → Thu 24
    expect(addBusinessDays("2026-09-18", 1)).toBe("2026-09-24");
    expect(addBusinessDays("2026-09-18", 2)).toBe("2026-09-25");
  });
  it("goes backward with negative n", () => {
    expect(addBusinessDays("2026-09-24", -1)).toBe("2026-09-18");
  });
  it("zero returns the same day if it is a business day, else the next one", () => {
    expect(addBusinessDays("2026-09-14", 0)).toBe("2026-09-14");
    expect(nextBusinessDay("2026-09-12")).toBe("2026-09-14");
  });
  it("rejects absurd offsets", () => {
    expect(() => addBusinessDays("2026-09-14", 5000)).toThrow(CalendarInputError);
  });
});

describe("lastBusinessDayOfMonth / businessDaysBetween", () => {
  it("finds 月末営業日", () => {
    expect(lastBusinessDayOfMonth(2026, 5)).toBe("2026-05-29"); // 31st is Sunday
    expect(lastBusinessDayOfMonth(2026, 12, "bank")).toBe("2026-12-30");
  });
  it("counts business days in a half-open range", () => {
    expect(businessDaysBetween("2026-09-14", "2026-09-21")).toBe(5); // Mon..Fri
  });
});

describe("describeDate", () => {
  it("returns a full summary", () => {
    const d = describeDate("2026-09-21", "standard");
    expect(d).toMatchObject({
      date: "2026-09-21",
      weekday: "Monday",
      isWeekend: false,
      isHoliday: true,
      holidayName: "敬老の日",
      isBusinessDay: false,
      nextBusinessDay: "2026-09-24",
      previousBusinessDay: "2026-09-18",
    });
  });
  it("validates the date string", () => {
    expect(() => describeDate("2026-13-01")).toThrow(CalendarInputError);
    expect(() => describeDate("20260901")).toThrow(CalendarInputError);
  });
});
