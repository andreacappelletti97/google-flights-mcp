import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, err } from "../src/lib/result.js";
import { TripType, SeatType, SortBy, MaxStops, type FlightSearchFilters } from "../src/google/types.js";

const { searchFlights } = vi.hoisted(() => ({ searchFlights: vi.fn() }));
vi.mock("../src/google/client.js", () => ({ searchFlights }));

const { fetchCalendar, MAX_CALENDAR_DAYS } = await import("../src/google/calendar.js");

const filters: FlightSearchFilters = {
  tripType: TripType.ONE_WAY,
  passengers: { adults: 1, children: 0, infantsOnLap: 0, infantsInSeat: 0 },
  segments: [{ departureAirport: "JFK", arrivalAirport: "LAX", travelDate: "2026-12-01" }],
  stops: MaxStops.ANY,
  seatType: SeatType.ECONOMY,
  sortBy: SortBy.CHEAPEST,
};

const flight = (price: number) => ({ price, currency: "USD", duration: 300, stops: 0, legs: [], totalEmissionsGrams: null });

describe("fetchCalendar", () => {
  beforeEach(() => {
    searchFlights.mockReset();
  });

  it("searches each day once and keeps that day's cheapest fare", async () => {
    searchFlights.mockImplementation(async (f: FlightSearchFilters) => {
      const date = f.segments[0].travelDate;
      return date === "2026-12-02"
        ? err("No flights found")
        : ok({ tag: "flights", flights: [flight(300), flight(date === "2026-12-01" ? 120 : 150)], metadata: {} });
    });
    const result = await fetchCalendar(filters, "2026-12-01", "2026-12-03");
    expect(searchFlights.mock.calls.map((c) => c[0].segments[0].travelDate).sort()).toEqual(["2026-12-01", "2026-12-02", "2026-12-03"]);
    expect(result).toEqual(ok([
      { date: "2026-12-01", cheapestPrice: 120, currency: "USD" },
      { date: "2026-12-03", cheapestPrice: 150, currency: "USD" },
    ]));
  });

  it("fails only when no day could be priced", async () => {
    searchFlights.mockResolvedValue(err("No flights found"));
    expect((await fetchCalendar(filters, "2026-12-01", "2026-12-02")).tag).toBe("err");
  });

  it("refuses a reversed or over-long range without searching", async () => {
    expect((await fetchCalendar(filters, "2026-12-05", "2026-12-01")).tag).toBe("err");
    // 2026-12-01 + MAX_CALENDAR_DAYS days is one day past the cap
    expect((await fetchCalendar(filters, "2026-12-01", "2027-01-01")).tag).toBe("err");
    expect(MAX_CALENDAR_DAYS).toBe(31);
    expect(searchFlights).not.toHaveBeenCalled();
  });
});
