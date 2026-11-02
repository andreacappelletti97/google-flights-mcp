import { z } from "zod";
import { SeatType, TripType, MaxStops, SortBy, type FlightSearchFilters } from "../google/types.js";
import {
  fetchCalendar,
  MAX_CALENDAR_DAYS,
  type CalendarDatePrice,
} from "../google/calendar.js";
import { addDays } from "../lib/date.js";
import { formatPrice } from "../lib/format.js";
import { ok, type Result } from "../lib/result.js";

const DEFAULT_DAYS = 14;
const MAX_DAYS = MAX_CALENDAR_DAYS;

export const calendarHeatmapSchema = z.object({
  origin: z.string().length(3).describe("Departure airport IATA code"),
  destination: z.string().length(3).describe("Arrival airport IATA code"),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").describe("First date of the window to price, in YYYY-MM-DD format"),
  days: z.number().int().min(1).max(MAX_DAYS).optional().default(DEFAULT_DAYS)
    .describe(`How many consecutive days to price, starting at departureDate (1-${MAX_DAYS}, default ${DEFAULT_DAYS}). One search page per day, so wider windows take longer.`),
  cabinClass: z
    .enum(["economy", "premium_economy", "business", "first"])
    .optional()
    .default("economy")
    .describe("Cabin class (economy, premium_economy, business, or first)"),
  adults: z.number().int().min(1).optional().default(1).describe("Number of adult passengers"),
});

const SEAT_MAP: Readonly<Record<string, SeatType>> = {
  economy: SeatType.ECONOMY, premium_economy: SeatType.PREMIUM_ECONOMY,
  business: SeatType.BUSINESS, first: SeatType.FIRST,
};

const formatCalendar = (
  prices: readonly CalendarDatePrice[],
  origin: string,
  destination: string
): string => {
  if (prices.length === 0) return "No daily price data available.";

  const sorted = prices.toSorted((a, b) => a.cheapestPrice - b.cheapestPrice);
  const cheapest = sorted[0];
  const mostExpensive = sorted[sorted.length - 1];
  const avg = Math.round(sorted.reduce((s, d) => s + d.cheapestPrice, 0) / sorted.length);
  const currency = sorted[0].currency ?? "USD";
  const fmt = (p: number) => formatPrice(p, currency);

  // Group by month
  const byMonth = prices
    .toSorted((a, b) => a.date.localeCompare(b.date))
    .reduce<ReadonlyMap<string, readonly CalendarDatePrice[]>>(
      (acc, dp) => {
        const month = dp.date.substring(0, 7);
        const existing = acc.get(month) ?? [];
        return new Map([...acc, [month, [...existing, dp]]]);
      },
      new Map()
    );

  // Classify each price as cheap/mid/expensive using terciles
  const t1 = sorted[Math.floor(sorted.length / 3)]?.cheapestPrice ?? 0;
  const t2 = sorted[Math.floor(sorted.length * 2 / 3)]?.cheapestPrice ?? 0;
  const classify = (p: number) => p <= t1 ? "***" : p >= t2 ? "   " : " * ";

  const monthBlocks = [...byMonth.entries()].map(([month, days]) => {
    const rows = days.map((d) => {
      const day = d.date.substring(8, 10);
      return `    ${day}: ${fmt(d.cheapestPrice).padEnd(8)} ${classify(d.cheapestPrice)}`;
    });
    return `  ${month}:\n${rows.join("\n")}`;
  });

  return [
    `Price calendar (one-way, cheapest per day): ${origin} -> ${destination}`,
    `${prices.length} days of data\n`,
    `Cheapest: ${fmt(cheapest.cheapestPrice)} (${cheapest.date})`,
    `Most expensive: ${fmt(mostExpensive.cheapestPrice)} (${mostExpensive.date})`,
    `Average: ${fmt(avg)}\n`,
    `Legend: *** = cheapest third,  *  = mid-range,     = most expensive\n`,
    ...monthBlocks,
  ].join("\n");
};

export const handleCalendarHeatmap = async (
  params: z.infer<typeof calendarHeatmapSchema>
): Promise<Result<string>> => {
  const origin = params.origin.toUpperCase();
  const destination = params.destination.toUpperCase();
  const days = params.days ?? DEFAULT_DAYS;
  const fromDate = params.departureDate;
  const toDate = addDays(fromDate, days - 1);

  const filters: FlightSearchFilters = {
    tripType: TripType.ONE_WAY,
    passengers: { adults: params.adults ?? 1, children: 0, infantsOnLap: 0, infantsInSeat: 0 },
    segments: [{ departureAirport: origin, arrivalAirport: destination, travelDate: fromDate }],
    stops: MaxStops.ANY,
    seatType: SEAT_MAP[params.cabinClass ?? "economy"],
    sortBy: SortBy.CHEAPEST,
  };

  const result = await fetchCalendar(filters, fromDate, toDate);
  if (result.tag === "err") return result;

  return ok(formatCalendar(result.value, origin, destination));
};
