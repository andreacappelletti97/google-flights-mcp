import { describe, it, expect } from "vitest";
import { findNearbyAirports } from "../src/data/airports.js";
import { handleNearbyAirports } from "../src/tools/nearby-airports.js";

describe("nearby airports", () => {
  describe("findNearbyAirports", () => {
    it("finds airports near JFK", () => {
      const nearby = findNearbyAirports("JFK", 100);
      expect(nearby.length).toBeGreaterThan(0);
      const codes = nearby.map((n) => n.airport.code);
      expect(codes).toContain("LGA");
      expect(codes).toContain("EWR");
    });

    it("returns results sorted by distance", () => {
      const nearby = findNearbyAirports("JFK", 200);
      const distances = nearby.map((n) => n.distanceKm);
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
    });

    it("respects radius parameter", () => {
      const small = findNearbyAirports("JFK", 50);
      const large = findNearbyAirports("JFK", 200);
      expect(large.length).toBeGreaterThanOrEqual(small.length);
      expect(small.every((n) => n.distanceKm <= 50)).toBe(true);
    });

    it("returns empty for unknown airport", () => {
      expect(findNearbyAirports("ZZZ", 200)).toEqual([]);
    });
  });

  describe("handleNearbyAirports", () => {
    it("returns formatted results", async () => {
      const result = await handleNearbyAirports({ airport: "JFK", radiusKm: 100 });
      expect(result.tag).toBe("ok");
      if (result.tag !== "ok") return;
      expect(result.value).toContain("Airports near JFK");
      expect(result.value).toContain("km away");
    });

    it("returns error for unknown airport", async () => {
      const result = await handleNearbyAirports({ airport: "ZZZ" });
      expect(result.tag).toBe("err");
    });
  });
});
