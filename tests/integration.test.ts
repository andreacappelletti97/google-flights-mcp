// Integration tests that hit the real Google Flights endpoint.
//
// Skipped by default because:
//   - they require network access,
//   - they are subject to Google rate-limiting and TLS fingerprint blocks,
//   - they are the thing that detects when Google's response format changes.
//
// Run them explicitly with:
//   GF_MCP_INTEGRATION=1 npm test -- integration

import { describe, it, expect } from "vitest";
import { searchFlights } from "../src/google/client.js";
import { TripType, SeatType, SortBy, MaxStops } from "../src/google/types.js";
import { addDays } from "../src/lib/date.js";

const runIntegration = process.env["GF_MCP_INTEGRATION"] === "1";
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("integration: Google Flights", () => {
  it(
    "returns flights for SFO -> LAX in the near future",
    async () => {
      const today = new Date().toISOString().split("T")[0];
      const departureDate = addDays(today, 21);

      const result = await searchFlights(
        {
          tripType: TripType.ONE_WAY,
          passengers: { adults: 1, children: 0, infantsOnLap: 0, infantsInSeat: 0 },
          segments: [
            { departureAirport: "SFO", arrivalAirport: "LAX", travelDate: departureDate },
          ],
          stops: MaxStops.ANY,
          seatType: SeatType.ECONOMY,
          sortBy: SortBy.CHEAPEST,
        },
        3
      );

      expect(result.tag).toBe("ok");
      if (result.tag !== "ok") return;
      expect(result.value.tag).toBe("flights");
      if (result.value.tag !== "flights") return;

      expect(result.value.flights.length).toBeGreaterThan(0);
      const first = result.value.flights[0];
      expect(first.price).toBeGreaterThan(0);
      expect(first.legs.length).toBeGreaterThan(0);
      expect(first.legs[0].departureAirport).toBe("SFO");
      expect(first.legs[first.legs.length - 1].arrivalAirport).toBe("LAX");
    },
    30_000
  );
});
