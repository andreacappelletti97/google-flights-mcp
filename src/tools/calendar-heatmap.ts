import { z } from "zod";
import { searchFlights } from "../google/client.js";
import {
  TripType,
  SeatType,
  SortBy,
  MaxStops,
  type FlightSearchFilters,
  type DailyPrice,
} from "../google/types.js";
import { formatPrice } from "../lib/format.js";
import { ok, err, type Result } from "../lib/result.js";

export const calendarHeatmapSchema = z.object({
  origin: z.string().length(3).describe("Departure airport IATA code"),
  destination: z.string().length(3).describe("Arrival airport IATA code"),
  departureDate: z.string().describe("A date within the month to search (YYYY-MM-DD). Google returns ~60 days of prices around this date."),
  cabinClass: z.enum(["economy", "premium_economy", "business", "first"]).optional().default("economy"),
});

const SEAT_MAP: Readonly<Record<string, SeatType>> = {
  economy: SeatType.ECONOMY, premium_economy: SeatType.PREMIUM_ECONOMY,
  business: SeatType.BUSINESS, first: SeatType.FIRST,
};

const formatCalendar = (
  prices: readonly DailyPrice[],
  origin: string,
  destination: string,
  currency: string
): string => {
  if (prices.length === 0) return "No daily price data available.";

  const sorted = prices.toSorted((a, b) => a.price - b.price);
  const cheapest = sorted[0];
  const mostExpensive = sorted[sorted.length - 1];
  const avg = Math.round(sorted.reduce((s, d) => s + d.price, 0) / sorted.length);
  const fmt = (p: number) => formatPrice(p, currency);

  // Group by month using reduce
  const byMonth = prices
    .toSorted((a, b) => a.date.localeCompare(b.date))
    .reduce<ReadonlyMap<string, readonly DailyPrice[]>>(
      (acc, dp) => {
        const month = dp.date.substring(0, 7);
        const existing = acc.get(month) ?? [];
        return new Map([...acc, [month, [...existing, dp]]]);
      },
      new Map()
    );

  // Classify each price as cheap/mid/expensive using terciles
  const t1 = sorted[Math.floor(sorted.length / 3)]?.price ?? 0;
  const t2 = sorted[Math.floor(sorted.length * 2 / 3)]?.price ?? 0;
  const classify = (p: number) => p <= t1 ? "***" : p >= t2 ? "   " : " * ";

  const monthBlocks = [...byMonth.entries()].map(([month, days]) => {
    const header = `  ${month}:`;
    const rows = days.map((d) => {
      const day = d.date.substring(8, 10);
      const indicator = classify(d.price);
      return `    ${day}: ${fmt(d.price).padEnd(8)} ${indicator}`;
    });
    return `${header}\n${rows.join("\n")}`;
  });

  return [
    `Price calendar: ${origin} -> ${destination}`,
    `${prices.length} days of data\n`,
    `Cheapest: ${fmt(cheapest.price)} (${cheapest.date})`,
    `Most expensive: ${fmt(mostExpensive.price)} (${mostExpensive.date})`,
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

  // Make a single search — Google returns ~60 days of daily prices in the metadata
  const filters: FlightSearchFilters = {
    tripType: TripType.ONE_WAY,
    passengers: { adults: 1, children: 0, infantsOnLap: 0, infantsInSeat: 0 },
    segments: [{ departureAirport: origin, arrivalAirport: destination, travelDate: params.departureDate }],
    stops: MaxStops.ANY,
    seatType: SEAT_MAP[params.cabinClass ?? "economy"],
    sortBy: SortBy.CHEAPEST,
  };

  const result = await searchFlights(filters, 1);
  if (result.tag === "err") return result;

  const { metadata } = result.value;
  if (metadata.dailyPrices.length === 0) {
    return err(`No daily price calendar data available for ${origin} -> ${destination}. Google may not provide this for all routes.`);
  }

  const currency = result.value.tag === "flights" && result.value.flights[0]?.currency
    ? result.value.flights[0].currency
    : "USD";

  return ok(formatCalendar(metadata.dailyPrices, origin, destination, currency));
};
