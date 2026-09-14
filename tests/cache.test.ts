import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCache, get, set, buildCacheKey } from "../src/lib/cache.js";

describe("cache", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("stores and retrieves values", () => {
    const cache = createCache<string>();
    set(cache, "key1", "value1");
    expect(get(cache, "key1")).toBe("value1");
  });

  it("returns null for missing keys", () => {
    const cache = createCache<string>();
    expect(get(cache, "missing")).toBeNull();
  });

  it("expires entries after TTL", () => {
    const cache = createCache<string>();
    set(cache, "key1", "value1", 1000); // 1 second TTL

    expect(get(cache, "key1")).toBe("value1");

    vi.advanceTimersByTime(1500);
    expect(get(cache, "key1")).toBeNull();
  });

  it("overwrites existing entries", () => {
    const cache = createCache<string>();
    set(cache, "key1", "first");
    set(cache, "key1", "second");
    expect(get(cache, "key1")).toBe("second");
  });
});

describe("buildCacheKey", () => {
  it("produces deterministic keys", () => {
    const obj = { b: 2, a: 1 };
    expect(buildCacheKey(obj)).toBe(buildCacheKey(obj));
  });

  it("sorts keys for consistency", () => {
    expect(buildCacheKey({ b: 2, a: 1 })).toBe(buildCacheKey({ a: 1, b: 2 }));
  });

  it("sorts nested keys for consistency", () => {
    expect(buildCacheKey({ a: { d: 4, c: 3 } })).toBe(
      buildCacheKey({ a: { c: 3, d: 4 } })
    );
  });

  it("retains nested keys instead of stripping them", () => {
    const key = buildCacheKey({
      segments: [{ departureAirport: "VIX", arrivalAirport: "CGR" }],
    });
    expect(key).toContain("departureAirport");
    expect(key).toContain("VIX");
  });

  it("distinguishes searches that differ only inside segments", () => {
    const base = {
      tripType: 1,
      passengers: { adults: 1, children: 0, infantsOnLap: 0, infantsInSeat: 0 },
      stops: 0,
      seatType: 0,
      sortBy: 0,
    };
    const outbound = {
      ...base,
      segments: [
        { departureAirport: "VIX", arrivalAirport: "CGR", travelDate: "2026-09-15" },
        { departureAirport: "CGR", arrivalAirport: "VIX", travelDate: "2026-09-26" },
      ],
    };
    const reversed = {
      ...base,
      segments: [
        { departureAirport: "CGR", arrivalAirport: "VIX", travelDate: "2026-09-26" },
        { departureAirport: "VIX", arrivalAirport: "CGR", travelDate: "2026-09-15" },
      ],
    };

    expect(buildCacheKey(outbound)).not.toBe(buildCacheKey(reversed));
  });

  it("distinguishes a return leg carrying a selectedFlight", () => {
    const outbound = {
      tripType: 1,
      passengers: { adults: 1, children: 0, infantsOnLap: 0, infantsInSeat: 0 },
      segments: [
        { departureAirport: "VIX", arrivalAirport: "CGR", travelDate: "2026-09-15" },
        { departureAirport: "CGR", arrivalAirport: "VIX", travelDate: "2026-09-26" },
      ],
      stops: 0,
      seatType: 0,
      sortBy: 0,
    };
    // What assembleMultiLeg() passes on the recursive call for the return leg.
    const withSelected = {
      ...outbound,
      segments: outbound.segments.map((seg, i) =>
        i === 0 ? { ...seg, selectedFlight: { price: 633, id: "LA4537" } } : seg
      ),
    };

    expect(buildCacheKey(outbound)).not.toBe(buildCacheKey(withSelected));
  });

  it("preserves array order", () => {
    expect(buildCacheKey({ segments: [{ a: 1 }, { a: 2 }] })).not.toBe(
      buildCacheKey({ segments: [{ a: 2 }, { a: 1 }] })
    );
  });
});
