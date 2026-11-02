import { z } from "zod";
import {
  SeatType,
  TripType,
  MaxStops,
  SortBy,
  type FlightSearchFilters,
} from "../google/types.js";
import {
  fetchCalendar,
  MAX_CALENDAR_DAYS,
  type CalendarDatePrice,
} from "../google/calendar.js";
import { daysBetween } from "../lib/date.js";
import { formatPrice } from "../lib/format.js";
import { ok, err, type Result } from "../lib/result.js";

export const priceInsightsSchema = z.object({
  origin: z.string().length(3).describe("Departure airport IATA code"),
  destination: z.string().length(3).describe("Arrival airport IATA code"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").describe("Start of date range in YYYY-MM-DD format"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").describe(`End of date range in YYYY-MM-DD format. At most ${MAX_CALENDAR_DAYS} days after startDate.`),
  cabinClass: z
    .enum(["economy", "premium_economy", "business", "first"])
    .optional()
    .default("economy")
    .describe("Cabin class (economy, premium_economy, business, or first)"),
  adults: z.number().int().min(1).optional().default(1).describe("Number of adult passengers"),
});

const SEAT_MAP: Readonly<Record<string, SeatType>> = {
  economy: SeatType.ECONOMY,
  premium_economy: SeatType.PREMIUM_ECONOMY,
  business: SeatType.BUSINESS,
  first: SeatType.FIRST,
};

// Pure: validate inputs. Each day is one search page, so the range is capped.
const validateInputs = (startDate: string, endDate: string): Result<number> => {
  const total = daysBetween(startDate, endDate);
  if (total < 0) return err("endDate must be after startDate.");
  if (total + 1 > MAX_CALENDAR_DAYS) {
    return err(`date range must be ${MAX_CALENDAR_DAYS} days or less.`);
  }
  return ok(total);
};

// Pure: format results into display string, cheapest date first
const formatInsights = (
  prices: readonly CalendarDatePrice[],
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
  ].join("\n");
};

export const handlePriceInsights = async (
  params: z.infer<typeof priceInsightsSchema>
): Promise<Result<string>> => {
  const validationResult = validateInputs(params.startDate, params.endDate);
  if (validationResult.tag === "err") return validationResult;

  const origin = params.origin.toUpperCase();
  const destination = params.destination.toUpperCase();

  const filters: FlightSearchFilters = {
    tripType: TripType.ONE_WAY,
    passengers: { adults: params.adults ?? 1, children: 0, infantsOnLap: 0, infantsInSeat: 0 },
    segments: [{ departureAirport: origin, arrivalAirport: destination, travelDate: params.startDate }],
    stops: MaxStops.ANY,
    seatType: SEAT_MAP[params.cabinClass ?? "economy"],
    sortBy: SortBy.CHEAPEST,
  };

  const result = await fetchCalendar(filters, params.startDate, params.endDate);
  if (result.tag === "err") return result;

  const prices = result.value;

  return prices.length === 0
    ? err(`No price data found for ${origin} to ${destination} between ${params.startDate} and ${params.endDate}.`)
    : ok(formatInsights(prices, origin, destination, params.startDate, params.endDate));
};
