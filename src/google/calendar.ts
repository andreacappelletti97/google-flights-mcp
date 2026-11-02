// Forward price calendar: the cheapest one-way fare for each day in a range.
//
// Google's GetCalendarGraph RPC priced up to 61 days in one call, but since
// 2026-08 it rejects every request without a browser-computed signature (see
// tfs.ts). The public search page prices one departure date per load, so a
// calendar is one page per day: paced in small waves so a sweep does not trip
// Google's throttle, and cached like any other search.
import type { FlightSearchFilters } from "./types.js";
import { TripType } from "./types.js";
import { searchFlights } from "./client.js";
import { addDays, daysBetween } from "../lib/date.js";
import { mapInBatches } from "../lib/concurrency.js";
import { config } from "../lib/config.js";
import { ok, err, type Result } from "../lib/result.js";

// One page load per day, so the range is capped well below the old 61.
export const MAX_CALENDAR_DAYS = 31;

export type CalendarDatePrice = {
  readonly date: string;
  readonly cheapestPrice: number;
  readonly currency: string | null;
};

const cheapestOn = async (
  filters: FlightSearchFilters,
  date: string
): Promise<readonly CalendarDatePrice[]> => {
  const first = filters.segments[0];
  if (first === undefined) return [];
  const result = await searchFlights(
    { ...filters, tripType: TripType.ONE_WAY, segments: [{ ...first, travelDate: date }] },
    1
  );
  if (result.tag === "err" || result.value.tag !== "flights") return [];
  const priced = result.value.flights.filter((f) => f.price > 0);
  if (priced.length === 0) return [];
  const cheapest = priced.reduce((a, b) => (b.price < a.price ? b : a));
  return [{ date, cheapestPrice: cheapest.price, currency: cheapest.currency }];
};

// Prices every day from fromDate to toDate inclusive. Days Google has no fare
// for are left out; the call fails only when no day could be priced.
export const fetchCalendar = async (
  filters: FlightSearchFilters,
  fromDate: string,
  toDate: string
): Promise<Result<readonly CalendarDatePrice[]>> => {
  const days = daysBetween(fromDate, toDate) + 1;
  if (days < 1) return err("The end of the range must not be before its start.");
  if (days > MAX_CALENDAR_DAYS) return err(`A calendar covers at most ${MAX_CALENDAR_DAYS} days.`);

  const dates = Array.from({ length: days }, (_, i) => addDays(fromDate, i));
  const perDay = await mapInBatches(
    dates,
    config.search.calendarConcurrency,
    config.search.calendarBatchDelayMs,
    (date) => cheapestOn(filters, date)
  );
  const prices = perDay.flat();
  return prices.length > 0
    ? ok(prices)
    : err(`No fares found for any date from ${fromDate} to ${toDate}.`);
};
