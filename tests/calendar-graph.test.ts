import { describe, it, expect } from "vitest";
import {
  buildCalendarRequestBody,
  parseCalendarGraph,
  MAX_CALENDAR_DAYS,
} from "../src/google/calendar-graph.js";
import { TripType, SeatType, SortBy, MaxStops, type FlightSearchFilters } from "../src/google/types.js";

const filters: FlightSearchFilters = {
  tripType: TripType.ONE_WAY,
  passengers: { adults: 1, children: 0, infantsOnLap: 0, infantsInSeat: 0 },
  segments: [{ departureAirport: "JFK", arrivalAirport: "LHR", travelDate: "2026-10-24" }],
  stops: MaxStops.ANY,
  seatType: SeatType.ECONOMY,
  sortBy: SortBy.CHEAPEST,
};

const decodePayload = (body: string): readonly unknown[] => {
  const encoded = body.replace(/^f\.req=/, "");
  const [, payloadJson] = JSON.parse(decodeURIComponent(encoded));
  return JSON.parse(payloadJson);
};

// Rows are [departureDate, returnDate|null, [[null, price], currencyToken]]
const makeCalendarResponse = (rows: readonly unknown[]) => {
  const payload = [null, null, rows];
  return ")]}'\n" + JSON.stringify([["wrb.fr", "FlightsFrontendService", JSON.stringify(payload)]]);
};

describe("buildCalendarRequestBody", () => {
  it("puts null at element [0], unlike the GetShoppingResults payload", () => {
    expect(decodePayload(buildCalendarRequestBody(filters, "2026-10-24", "2026-11-01"))[0]).toBeNull();
  });

  it("carries the date range at element [2]", () => {
    const payload = decodePayload(buildCalendarRequestBody(filters, "2026-10-24", "2026-11-01"));
    expect(payload[2]).toEqual(["2026-10-24", "2026-11-01"]);
  });

  it("keeps the main filter block at the length GetCalendarGraph accepts", () => {
    const payload = decodePayload(buildCalendarRequestBody(filters, "2026-10-24", "2026-11-01"));
    expect((payload[1] as unknown[]).length).toBe(18);
  });

  it("caps a single call at 61 days", () => {
    expect(MAX_CALENDAR_DAYS).toBe(61);
  });
});

describe("parseCalendarGraph", () => {
  it("parses date/price rows", () => {
    const result = parseCalendarGraph(
      makeCalendarResponse([
        ["2026-10-24", null, [[null, 210]]],
        ["2026-10-25", null, [[null, 211]]],
      ])
    );
    expect(result.tag).toBe("ok");
    if (result.tag !== "ok") return;
    expect(result.value).toEqual([
      { date: "2026-10-24", cheapestPrice: 210, currency: null },
      { date: "2026-10-25", cheapestPrice: 211, currency: null },
    ]);
  });

  it("keeps dates as returned strings, with no timezone conversion", () => {
    const result = parseCalendarGraph(makeCalendarResponse([["2026-07-15", null, [[null, 207]]]]));
    expect(result.tag).toBe("ok");
    if (result.tag !== "ok") return;
    expect(result.value[0].date).toBe("2026-07-15");
  });

  it("skips rows with no price", () => {
    const result = parseCalendarGraph(
      makeCalendarResponse([
        ["2026-10-24", null, [[null, 0]]],
        ["2026-10-25", null, null],
        ["2026-10-26", null, [[null, 211]]],
      ])
    );
    expect(result.tag).toBe("ok");
    if (result.tag !== "ok") return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].date).toBe("2026-10-26");
  });

  it("errors when the response carries no wrb.fr payload", () => {
    const result = parseCalendarGraph(")]}'\n" + JSON.stringify([["er", null, null, null, null, 400]]));
    expect(result.tag).toBe("err");
  });

  it("errors on malformed JSON rather than throwing", () => {
    expect(parseCalendarGraph(")]}'\nnot json").tag).toBe("err");
  });

  it("errors when every row is unpriced", () => {
    expect(parseCalendarGraph(makeCalendarResponse([["2026-10-24", null, null]])).tag).toBe("err");
  });
});
