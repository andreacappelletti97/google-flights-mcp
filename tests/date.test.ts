import { describe, it, expect } from "vitest";
import { addDays, daysBetween, formatDateTime, formatDuration } from "../src/lib/date.js";

describe("date utilities", () => {
  describe("addDays", () => {
    it("adds positive days", () => {
      expect(addDays("2026-01-01", 5)).toBe("2026-01-06");
    });

    it("crosses month boundaries", () => {
      expect(addDays("2026-01-29", 5)).toBe("2026-02-03");
    });

    it("crosses year boundaries", () => {
      expect(addDays("2025-12-30", 5)).toBe("2026-01-04");
    });

    it("handles zero days", () => {
      expect(addDays("2026-06-15", 0)).toBe("2026-06-15");
    });
  });

  describe("daysBetween", () => {
    it("computes positive difference", () => {
      expect(daysBetween("2026-01-01", "2026-01-10")).toBe(9);
    });

    it("computes negative difference", () => {
      expect(daysBetween("2026-01-10", "2026-01-01")).toBe(-9);
    });

    it("returns 0 for same date", () => {
      expect(daysBetween("2026-06-15", "2026-06-15")).toBe(0);
    });
  });

  describe("formatDateTime", () => {
    it("formats date and time arrays", () => {
      expect(formatDateTime([2026, 6, 15], [14, 30])).toBe("2026-06-15T14:30:00");
    });

    it("pads single-digit values", () => {
      expect(formatDateTime([2026, 1, 5], [8, 5])).toBe("2026-01-05T08:05:00");
    });

    it("handles missing values with defaults", () => {
      expect(formatDateTime([], [])).toBe("0000-01-01T00:00:00");
    });
  });

  describe("formatDuration", () => {
    it("formats minutes into h m", () => {
      expect(formatDuration(135)).toBe("2h 15m");
    });

    it("handles exact hours", () => {
      expect(formatDuration(120)).toBe("2h 0m");
    });

    it("handles less than an hour", () => {
      expect(formatDuration(45)).toBe("0h 45m");
    });
  });
});
