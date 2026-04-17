import { z } from "zod";
import { searchFlights } from "../google/client.js";
import {
  TripType,
  SeatType,
  SortBy,
  MaxStops,
  type FlightSearchFilters,
} from "../google/types.js";
import { addDays, daysBetween } from "../lib/date.js";
import { formatPrice } from "../lib/format.js";
import { ok, err, type Result, partition } from "../lib/result.js";

export const priceInsightsSchema = z.object({
  origin: z.string().length(3).describe("Departure airport IATA code"),
  destination: z.string().length(3).describe("Arrival airport IATA code"),
  startDate: z.string().describe("Start of date range (YYYY-MM-DD)"),
  endDate: z.string().describe("End of date range (YYYY-MM-DD)"),
  cabinClass: z.enum(["economy", "premium_economy", "business", "first"]).optional().default("economy"),
  adults: z.number().int().min(1).optional().default(1),
});

const SEAT_MAP: Readonly<Record<string, SeatType>> = {
  economy: SeatType.ECONOMY,
  premium_economy: SeatType.PREMIUM_ECONOMY,
  business: SeatType.BUSINESS,
  first: SeatType.FIRST,
};

type DatePrice = {
  readonly date: string;
  readonly cheapestPrice: number;
  readonly currency: string | null;
};

// Pure: generate one date per day in the range [start, start+totalDays]
const generateDates = (start: string, totalDays: number): readonly string[] =>
  Array.from({ length: totalDays + 1 }, (_, i) => addDays(start, i));

// Pure: validate inputs
const validateInputs = (
  startDate: string,
  endDate: string
): Result<number> => {
  const total = daysBetween(startDate, endDate);
  if (total < 0) return err("endDate must be after startDate.");
  if (total > 14) {
    return err(
      "date range must be 14 days or less (one API call per day). " +
      "For wider ranges, use get_calendar_heatmap, which returns ~60 days of prices in a single call."
    );
  }
  return ok(total);
};

// Pure: build one-way filters for a single date
const buildOnewayFilters = (
  origin: string,
  destination: string,
  date: string,
  seatType: SeatType,
  adults: number
): FlightSearchFilters => ({
  tripType: TripType.ONE_WAY,
  passengers: { adults, children: 0, infantsOnLap: 0, infantsInSeat: 0 },
  segments: [{ departureAirport: origin, arrivalAirport: destination, travelDate: date }],
  stops: MaxStops.ANY,
  seatType,
  sortBy: SortBy.CHEAPEST,
});

// IO: fetch cheapest price for one date, returning Result
const fetchDatePrice = async (
  origin: string,
  destination: string,
  date: string,
  seatType: SeatType,
  adults: number
): Promise<Result<DatePrice>> => {
  const filters = buildOnewayFilters(origin, destination, date, seatType, adults);
  const result = await searchFlights(filters, 1);
  if (result.tag === "err") return result;
  const sr = result.value;
  if (sr.tag !== "flights" || sr.flights.length === 0) {
    return err(`No flights for ${date}`);
  }
  const cheapest = sr.flights[0];
  return ok({ date, cheapestPrice: cheapest.price, currency: cheapest.currency });
};

// Pure: split an array into chunks of size n
const chunk = <T>(arr: readonly T[], n: number): readonly (readonly T[])[] =>
  Array.from(
    { length: Math.ceil(arr.length / n) },
    (_, i) => arr.slice(i * n, i * n + n)
  );

// Pure: introduce a delay (IO, but isolated)
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// IO: fetch prices in batches with delays, using recursive batch processing
const fetchAllPrices = async (
  dates: readonly string[],
  origin: string,
  destination: string,
  seatType: SeatType,
  adults: number
): Promise<{ readonly prices: readonly DatePrice[]; readonly failCount: number }> => {
  const batches = chunk(dates, 3);

  const batchResults = await batches.reduce<Promise<readonly Result<DatePrice>[]>>(
    async (accPromise, batch, i) => {
      const acc = await accPromise;
      if (i > 0) await delay(500);
      const results = await Promise.all(
        batch.map((date) => fetchDatePrice(origin, destination, date, seatType, adults))
      );
      return [...acc, ...results];
    },
    Promise.resolve([])
  );

  const { successes, failures } = partition(batchResults);
  return { prices: successes, failCount: failures.length };
};

// Pure: format results into display string
const formatInsights = (
  prices: readonly DatePrice[],
  failCount: number,
  totalDates: number,
  origin: string,
  destination: string,
  startDate: string,
  endDate: string
): string => {
  const sorted = prices.toSorted((a, b) => a.cheapestPrice - b.cheapestPrice);
  const currency = sorted[0].currency ?? "USD";
  const fmt = (p: number) => formatPrice(p, currency);

  const cheapest = sorted[0];
  const mostExpensive = sorted[sorted.length - 1];
  const avg = Math.round(
    sorted.reduce((sum, d) => sum + d.cheapestPrice, 0) / sorted.length
  );

  const priceList = sorted
    .map((d) => `  ${d.date}: ${fmt(d.cheapestPrice)}`)
    .join("\n");

  return [
    `Price insights (one-way): ${origin} -> ${destination}`,
    `Date range: ${startDate} to ${endDate}\n`,
    `Cheapest: ${fmt(cheapest.cheapestPrice)} (${cheapest.date})`,
    `Most expensive: ${fmt(mostExpensive.cheapestPrice)} (${mostExpensive.date})`,
    `Average: ${fmt(avg)}\n`,
    `Prices by departure date:`,
    priceList,
    ...(failCount > 0 ? [`\nNote: ${failCount} of ${totalDates} date(s) failed to fetch.`] : []),
  ].join("\n");
};

export const handlePriceInsights = async (
  params: z.infer<typeof priceInsightsSchema>
): Promise<Result<string>> => {
  const validationResult = validateInputs(params.startDate, params.endDate);
  if (validationResult.tag === "err") return validationResult;

  const totalDays = validationResult.value;
  const dates = generateDates(params.startDate, totalDays);
  const origin = params.origin.toUpperCase();
  const destination = params.destination.toUpperCase();
  const seatType = SEAT_MAP[params.cabinClass ?? "economy"];

  const { prices, failCount } = await fetchAllPrices(
    dates, origin, destination, seatType, params.adults ?? 1
  );

  return prices.length === 0
    ? err(
        `No price data found for ${origin} to ${destination} between ${params.startDate} and ${params.endDate}.` +
        (failCount > 0 ? ` (${failCount} date(s) failed to fetch)` : "")
      )
    : ok(formatInsights(prices, failCount, dates.length, origin, destination, params.startDate, params.endDate));
};
