import { describe, it, expect } from "vitest";
import {
  addDays, dayOfYear, daysBetween, formatIsoWeek, isValidDate, isoWeekLabelOf, isoWeekOf,
  isoWeekStart, parseIsoWeek, shiftIsoWeek, weeksInIsoYear,
} from "../src/util/dates";

describe("dates", () => {
  it("finds the ISO week of a date", () => {
    expect(isoWeekLabelOf("2026-11-05")).toBe("2026-W45");
    expect(isoWeekLabelOf("2026-01-01")).toBe("2026-W01");
    expect(isoWeekLabelOf("2024-12-30")).toBe("2025-W01"); // belongs to next year's week 1
    expect(isoWeekLabelOf("2021-01-03")).toBe("2020-W53"); // belongs to last year's week 53
    expect(isoWeekLabelOf("2026-11-08")).toBe("2026-W45"); // Sunday ends the week
    expect(isoWeekLabelOf("2026-11-09")).toBe("2026-W46");
  });

  it("finds the Monday that starts a week", () => {
    expect(isoWeekStart({ year: 2026, week: 45 })).toBe("2026-11-02");
    expect(isoWeekStart({ year: 2026, week: 1 })).toBe("2025-12-29");
  });

  it("knows which years have 53 weeks", () => {
    expect(weeksInIsoYear(2026)).toBe(53);
    expect(weeksInIsoYear(2025)).toBe(52);
    expect(weeksInIsoYear(2020)).toBe(53);
  });

  it("parses and validates week labels", () => {
    expect(parseIsoWeek("2026-W46")).toEqual({ year: 2026, week: 46 });
    expect(parseIsoWeek("2026-w46")).toEqual({ year: 2026, week: 46 });
    expect(parseIsoWeek("2026-W53")).toEqual({ year: 2026, week: 53 });
    expect(parseIsoWeek("2025-W53")).toBeNull();
    expect(parseIsoWeek("2026-W00")).toBeNull();
    expect(parseIsoWeek("2026-W54")).toBeNull();
    expect(parseIsoWeek("2026-46")).toBeNull();
    expect(parseIsoWeek("")).toBeNull();
  });

  it("round-trips a week through its start date", () => {
    const w = isoWeekOf("2026-11-05");
    expect(isoWeekOf(isoWeekStart(w))).toEqual(w);
    expect(formatIsoWeek(w)).toBe("2026-W45");
  });

  it("shifts weeks across year boundaries", () => {
    expect(shiftIsoWeek("2026-W01", -1)).toBe("2025-W52");
    expect(shiftIsoWeek("2026-W45", 1)).toBe("2026-W46");
    expect(shiftIsoWeek("2026-W53", 1)).toBe("2027-W01");
  });

  it("does day arithmetic", () => {
    expect(addDays("2026-11-05", -6)).toBe("2026-10-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-11-01", "2026-11-05")).toBe(4);
    expect(daysBetween("2026-11-05", "2026-11-01")).toBe(-4);
    expect(dayOfYear("2026-01-01")).toBe(1);
    expect(dayOfYear("2026-12-31")).toBe(365);
  });

  it("rejects dates that do not exist", () => {
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-2-3")).toBe(false);
    expect(isValidDate("2026-11-05")).toBe(true);
    expect(() => addDays("nonsense", 1)).toThrow();
  });
});
