import { describe, it, expect } from "vitest";
import { buildTfs, searchPageUrl } from "../src/google/tfs.js";
import { TripType, SeatType, SortBy, MaxStops, type FlightSearchFilters, type FlightResult } from "../src/google/types.js";

const oneWay: FlightSearchFilters = {
  tripType: TripType.ONE_WAY,
  passengers: { adults: 1, children: 0, infantsOnLap: 0, infantsInSeat: 0 },
  segments: [{ departureAirport: "JFK", arrivalAirport: "LAX", travelDate: "2026-12-10" }],
  stops: MaxStops.ANY,
  seatType: SeatType.ECONOMY,
  sortBy: SortBy.BEST,
};

const outbound: FlightResult = {
  price: 200,
  currency: "USD",
  duration: 100,
  stops: 0,
  totalEmissionsGrams: null,
  legs: [{
    airline: "G3", airlineName: "GOL", flightNumber: "1389",
    departureAirport: "VIX", arrivalAirport: "GRU",
    departureTime: "2026-12-10T05:55:00", arrivalTime: "2026-12-10T07:35:00",
    duration: 100, aircraft: null, seatPitch: null, emissionsGrams: null,
  }],
};

// Expected values are what punitarani/fli's encoder (fli-js/src/search/proto.ts)
// produces for the same search, so the two stay byte-for-byte compatible.
describe("buildTfs", () => {
  it("encodes a one-way search as fli does", () => {
    expect(buildTfs(oneWay)).toEqual({ tag: "ok", value: "CBwQAhoeEgoyMDI2LTEyLTEwagcIARIDSkZLcgcIARIDTEFYQAFIAXABmAEC" });
  });

  it("encodes a round trip with a pinned outbound, stops, airlines, cabin and a passenger mix as fli does", () => {
    const filters: FlightSearchFilters = {
      ...oneWay,
      tripType: TripType.ROUND_TRIP,
      passengers: { adults: 2, children: 1, infantsOnLap: 1, infantsInSeat: 0 },
      segments: [
        { departureAirport: "VIX", arrivalAirport: "GRU", travelDate: "2026-12-10", selectedFlight: outbound },
        { departureAirport: "GRU", arrivalAirport: "VIX", travelDate: "2026-12-20" },
      ],
      stops: MaxStops.NON_STOP,
      seatType: SeatType.BUSINESS,
      airlines: ["LA"],
    };
    expect(buildTfs(filters)).toEqual({
      tag: "ok",
      value: "CBwQAhpGEgoyMDI2LTEyLTEwKAAyAkxBIiAKA1ZJWBIKMjAyNi0xMi0xMBoDR1JVKgJHMzIEMTM4OWoHCAESA1ZJWHIHCAESA0dSVRokEgoyMDI2LTEyLTIwKAAyAkxBagcIARIDR1JVcgcIARIDVklYQAFAAUACQANIA3ABmAEB",
    });
  });

  it("leaves the stop limit out for MaxStops.ANY instead of pinning to non-stop", () => {
    const any = buildTfs(oneWay);
    const nonStop = buildTfs({ ...oneWay, stops: MaxStops.NON_STOP });
    expect(any.tag === "ok" && nonStop.tag === "ok" && any.value !== nonStop.value).toBe(true);
    // field 5 (stops) is tag 0x28; it must not appear in the ANY encoding
    const bytes = any.tag === "ok" ? Buffer.from(any.value, "base64url") : Buffer.alloc(0);
    expect(bytes.includes(Buffer.from([0x28, 0x00]))).toBe(false);
  });

  it("refuses multi-city rather than serving the first leg's results", () => {
    const result = buildTfs({ ...oneWay, tripType: TripType.MULTI_CITY });
    expect(result.tag).toBe("err");
  });

  it("builds the search page URL", () => {
    expect(searchPageUrl("abc")).toBe("https://www.google.com/travel/flights?tfs=abc&hl=en");
  });
});
