import { describe, it, expect } from "vitest";
import { computeTrend, type PriceRecord } from "../src/lib/price-tracker.js";

describe("price tracker", () => {
  describe("computeTrend", () => {
    it("returns 'new' for empty history", () => {
      const trend = computeTrend([], 500);
      expect(trend.trend).toBe("new");
      expect(trend.currentPrice).toBe(500);
      expect(trend.lowestSeen).toBe(500);
      expect(trend.highestSeen).toBe(500);
    });

    it("detects dropping prices", () => {
      const history: PriceRecord[] = [
        { route: "SFO-NRT", date: "2026-06-15", cabin: "economy", price: 900, currency: "USD", recordedAt: "2026-04-01T00:00:00Z" },
        { route: "SFO-NRT", date: "2026-06-15", cabin: "economy", price: 850, currency: "USD", recordedAt: "2026-04-02T00:00:00Z" },
      ];
      const trend = computeTrend(history, 700);
      expect(trend.trend).toBe("dropping");
      expect(trend.priceChange).toBe(-150); // 700 - 850
      expect(trend.lowestSeen).toBe(700);
      expect(trend.highestSeen).toBe(900);
    });

    it("detects rising prices", () => {
      const history: PriceRecord[] = [
        { route: "SFO-NRT", date: "2026-06-15", cabin: "economy", price: 500, currency: "USD", recordedAt: "2026-04-01T00:00:00Z" },
      ];
      const trend = computeTrend(history, 800);
      expect(trend.trend).toBe("rising");
      expect(trend.priceChange).toBe(300);
    });

    it("detects stable prices", () => {
      const history: PriceRecord[] = [
        { route: "SFO-NRT", date: "2026-06-15", cabin: "economy", price: 500, currency: "USD", recordedAt: "2026-04-01T00:00:00Z" },
      ];
      // Within 2% = stable
      const trend = computeTrend(history, 505);
      expect(trend.trend).toBe("stable");
    });

    it("tracks lowest and highest seen correctly", () => {
      const history: PriceRecord[] = [
        { route: "A-B", date: "2026-06-15", cabin: "economy", price: 600, currency: "USD", recordedAt: "2026-04-01T00:00:00Z" },
        { route: "A-B", date: "2026-06-15", cabin: "economy", price: 400, currency: "USD", recordedAt: "2026-04-02T00:00:00Z" },
        { route: "A-B", date: "2026-06-15", cabin: "economy", price: 800, currency: "USD", recordedAt: "2026-04-03T00:00:00Z" },
      ];
      const trend = computeTrend(history, 500);
      expect(trend.lowestSeen).toBe(400);
      expect(trend.highestSeen).toBe(800);
    });
  });
});
