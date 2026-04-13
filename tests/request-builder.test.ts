import { describe, it, expect } from "vitest";
import { buildRequestBody } from "../src/google/request-builder.js";
import { TripType, SeatType, SortBy, MaxStops, type FlightSearchFilters } from "../src/google/types.js";

const makeFilters = (overrides: Partial<FlightSearchFilters> = {}): FlightSearchFilters => ({
  tripType: TripType.ONE_WAY,
  passengers: { adults: 1, children: 0, infantsOnLap: 0, infantsInSeat: 0 },
  segments: [{ departureAirport: "SFO", arrivalAirport: "LAX", travelDate: "2026-06-15" }],
  stops: MaxStops.ANY,
  seatType: SeatType.ECONOMY,
  sortBy: SortBy.BEST,
  ...overrides,
});

describe("buildRequestBody", () => {
  it("returns a URL-encoded f.req parameter", () => {
    const body = buildRequestBody(makeFilters());
    expect(body).toMatch(/^f\.req=/);
  });

  it("contains the airport codes in the encoded payload", () => {
    const body = decodeURIComponent(buildRequestBody(makeFilters()));
    expect(body).toContain("SFO");
    expect(body).toContain("LAX");
  });

  it("contains the travel date", () => {
    const body = decodeURIComponent(buildRequestBody(makeFilters()));
    expect(body).toContain("2026-06-15");
  });

  it("encodes trip type correctly", () => {
    const body = decodeURIComponent(buildRequestBody(makeFilters({ tripType: TripType.ROUND_TRIP })));
    // Trip type 1 = round trip at position [1][2]
    const parsed = JSON.parse(JSON.parse(body.replace("f.req=", ""))[1]);
    expect(parsed[1][2]).toBe(TripType.ROUND_TRIP);
  });

  it("encodes seat type correctly", () => {
    const body = decodeURIComponent(buildRequestBody(makeFilters({ seatType: SeatType.BUSINESS })));
    const parsed = JSON.parse(JSON.parse(body.replace("f.req=", ""))[1]);
    expect(parsed[1][5]).toBe(SeatType.BUSINESS);
  });

  it("encodes passenger counts correctly", () => {
    const filters = makeFilters({
      passengers: { adults: 2, children: 1, infantsOnLap: 1, infantsInSeat: 0 },
    });
    const body = decodeURIComponent(buildRequestBody(filters));
    const parsed = JSON.parse(JSON.parse(body.replace("f.req=", ""))[1]);
    expect(parsed[1][6]).toEqual([2, 1, 1, 0]);
  });

  it("encodes max stops as nonstop", () => {
    const body = decodeURIComponent(buildRequestBody(makeFilters({ stops: MaxStops.NON_STOP })));
    const parsed = JSON.parse(JSON.parse(body.replace("f.req=", ""))[1]);
    // Stops are in the segment at index [3]
    expect(parsed[1][13][0][3]).toBe(MaxStops.NON_STOP);
  });

  it("encodes multiple segments for round-trip", () => {
    const filters = makeFilters({
      tripType: TripType.ROUND_TRIP,
      segments: [
        { departureAirport: "JFK", arrivalAirport: "LHR", travelDate: "2026-07-01" },
        { departureAirport: "LHR", arrivalAirport: "JFK", travelDate: "2026-07-10" },
      ],
    });
    const body = decodeURIComponent(buildRequestBody(filters));
    const parsed = JSON.parse(JSON.parse(body.replace("f.req=", ""))[1]);
    expect(parsed[1][13]).toHaveLength(2);
  });
});
