import { describe, it, expect } from "vitest";
import { parseFlightsResponse } from "../src/google/response-parser.js";

// Minimal valid Google Flights response structure
const makeResponse = (flights: unknown[][] = []) => {
  const inner = [
    null, // [0]
    null, // [1]
    flights.length > 0 ? [flights] : null, // [2] outbound flights
    null, // [3] return flights
  ];
  const outerEntry = ["wrb.fr", "FlightsFrontendService", JSON.stringify(inner)];
  return ")]}\'\n" + JSON.stringify([outerEntry]);
};

const makeFlight = (
  airline = "UA",
  flightNum = "123",
  dep = "SFO",
  arr = "LAX",
  price = 199,
  duration = 95
) => {
  // Leg structure: index 3=dep, 6=arr, 8=depTime, 10=arrTime, 11=duration, 20=depDate, 21=arrDate, 22=airline
  const leg = Array(23).fill(null);
  leg[3] = dep;
  leg[6] = arr;
  leg[8] = [14, 30]; // 14:30
  leg[10] = [16, 5]; // 16:05
  leg[11] = duration;
  leg[20] = [2026, 6, 15];
  leg[21] = [2026, 6, 15];
  leg[22] = [airline, flightNum];

  // Flight structure: [0]= flight data, [1]= price block
  return [
    [null, null, [leg], null, null, null, null, null, null, duration],
    [[null, price], "dummybase64token"],
  ];
};

describe("parseFlightsResponse", () => {
  it("parses a valid one-way response", () => {
    const raw = makeResponse([makeFlight()]);
    const result = parseFlightsResponse(raw);

    expect(result.tag).toBe("ok");
    if (result.tag !== "ok") return;

    expect(result.value.flights).toHaveLength(1);
    expect(result.value.flights[0].price).toBe(199);
    expect(result.value.flights[0].duration).toBe(95);
    expect(result.value.flights[0].stops).toBe(0);
    expect(result.value.flights[0].legs).toHaveLength(1);
    expect(result.value.flights[0].legs[0].airline).toBe("UA");
    expect(result.value.flights[0].legs[0].flightNumber).toBe("123");
    expect(result.value.flights[0].legs[0].departureAirport).toBe("SFO");
    expect(result.value.flights[0].legs[0].arrivalAirport).toBe("LAX");
  });

  it("parses multiple flights", () => {
    const raw = makeResponse([
      makeFlight("UA", "100", "SFO", "LAX", 199, 90),
      makeFlight("AA", "200", "SFO", "LAX", 249, 95),
      makeFlight("DL", "300", "SFO", "LAX", 179, 88),
    ]);
    const result = parseFlightsResponse(raw);

    expect(result.tag).toBe("ok");
    if (result.tag !== "ok") return;

    expect(result.value.flights).toHaveLength(3);
    expect(result.value.flights[0].legs[0].airline).toBe("UA");
    expect(result.value.flights[1].legs[0].airline).toBe("AA");
    expect(result.value.flights[2].legs[0].airline).toBe("DL");
  });

  it("returns err for empty response", () => {
    const result = parseFlightsResponse(")]}\'\n[]");
    expect(result.tag).toBe("err");
  });

  it("returns err for invalid JSON", () => {
    const result = parseFlightsResponse("not json at all");
    expect(result.tag).toBe("err");
  });

  it("returns err for response with no flight data", () => {
    const outer = [["er", null, null, null, null, 400]];
    const result = parseFlightsResponse(")]}\'\n" + JSON.stringify(outer));
    expect(result.tag).toBe("err");
  });

  it("returns err with descriptive message when format changes", () => {
    const result = parseFlightsResponse(")]}\'\n" + JSON.stringify([["unexpected", "format"]]));
    expect(result.tag).toBe("err");
    if (result.tag === "err") {
      expect(result.error).toContain("No flight data found");
    }
  });

  it("skips malformed flight entries and returns valid ones", () => {
    const validFlight = makeFlight("UA", "100", "SFO", "LAX", 199, 90);
    const malformedFlight = ["not", "a", "flight"]; // wrong structure
    const raw = makeResponse([validFlight, malformedFlight]);
    const result = parseFlightsResponse(raw);

    expect(result.tag).toBe("ok");
    if (result.tag !== "ok") return;

    // Should have parsed only the valid one
    expect(result.value.flights.length).toBeGreaterThanOrEqual(1);
    expect(result.value.flights[0].legs[0].airline).toBe("UA");
  });

  it("handles flight with connecting legs (1 stop)", () => {
    const leg1 = Array(23).fill(null);
    leg1[3] = "SFO"; leg1[6] = "DEN"; leg1[8] = [8, 0]; leg1[10] = [12, 0];
    leg1[11] = 180; leg1[20] = [2026, 6, 15]; leg1[21] = [2026, 6, 15]; leg1[22] = ["UA", "100"];

    const leg2 = Array(23).fill(null);
    leg2[3] = "DEN"; leg2[6] = "NRT"; leg2[8] = [14, 0]; leg2[10] = [18, 0];
    leg2[11] = 600; leg2[20] = [2026, 6, 15]; leg2[21] = [2026, 6, 16]; leg2[22] = ["UA", "200"];

    const flight = [
      [null, null, [leg1, leg2], null, null, null, null, null, null, 780],
      [[null, 850], "token"],
    ];

    const raw = makeResponse([flight]);
    const result = parseFlightsResponse(raw);

    expect(result.tag).toBe("ok");
    if (result.tag !== "ok") return;

    expect(result.value.flights[0].stops).toBe(1);
    expect(result.value.flights[0].legs).toHaveLength(2);
    expect(result.value.flights[0].legs[0].arrivalAirport).toBe("DEN");
    expect(result.value.flights[0].legs[1].departureAirport).toBe("DEN");
  });
});
