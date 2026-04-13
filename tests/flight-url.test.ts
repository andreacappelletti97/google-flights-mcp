import { describe, it, expect } from "vitest";
import { handleFlightUrl } from "../src/tools/flight-url.js";

describe("flight URL generation", () => {
  it("generates a one-way URL", async () => {
    const result = await handleFlightUrl({
      origin: "SFO",
      destination: "NRT",
      departureDate: "2026-06-15",
    });
    expect(result.tag).toBe("ok");
    if (result.tag !== "ok") return;
    expect(result.value).toContain("google.com/travel/flights");
    expect(result.value).toContain("SFO");
    expect(result.value).toContain("NRT");
    expect(result.value).toContain("2026-06-15");
    expect(result.value).toContain("One-way");
  });

  it("generates a round-trip URL", async () => {
    const result = await handleFlightUrl({
      origin: "JFK",
      destination: "LHR",
      departureDate: "2026-07-01",
      returnDate: "2026-07-10",
    });
    expect(result.tag).toBe("ok");
    if (result.tag !== "ok") return;
    expect(result.value).toContain("Round-trip");
    expect(result.value).toContain("return");
    expect(result.value).toContain("2026-07-10");
  });

  it("uppercases airport codes", async () => {
    const result = await handleFlightUrl({
      origin: "sfo",
      destination: "lax",
      departureDate: "2026-06-15",
    });
    expect(result.tag).toBe("ok");
    if (result.tag !== "ok") return;
    expect(result.value).toContain("SFO");
    expect(result.value).toContain("LAX");
  });
});
