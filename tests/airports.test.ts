import { describe, it, expect } from "vitest";
import { lookupAirport, AIRPORTS } from "../src/data/airports.js";

describe("airport lookup", () => {
  it("loads a substantial number of airports", () => {
    expect(AIRPORTS.length).toBeGreaterThan(5000);
  });

  it("finds exact IATA code match", () => {
    const results = lookupAirport("JFK");
    expect(results.length).toBe(1);
    expect(results[0].code).toBe("JFK");
  });

  it("is case-insensitive", () => {
    const results = lookupAirport("jfk");
    expect(results.length).toBe(1);
    expect(results[0].code).toBe("JFK");
  });

  it("finds airports by city name", () => {
    const results = lookupAirport("Tokyo");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((a) => a.code === "NRT" || a.code === "HND")).toBe(true);
  });

  it("finds airports by country code", () => {
    const results = lookupAirport("JP");
    expect(results.length).toBeGreaterThan(0);
    // At least some results should be from Japan (others may match "JP" in names)
    expect(results.some((a) => a.country === "JP")).toBe(true);
  });

  it("returns empty for nonsense query", () => {
    const results = lookupAirport("xyzqwerty12345");
    expect(results).toEqual([]);
  });

  it("limits results to 20", () => {
    const results = lookupAirport("airport");
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it("finds airports by partial name match", () => {
    const results = lookupAirport("Heathrow");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].code).toBe("LHR");
  });
});
