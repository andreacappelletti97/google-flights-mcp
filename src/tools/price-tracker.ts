import { z } from "zod";
import { searchFlights } from "../google/client.js";
import {
  TripType, SeatType, SortBy, MaxStops,
  type FlightSearchFilters,
} from "../google/types.js";
import {
  recordPrice, getPriceHistory, computeTrend, getTrackedRoutes,
} from "../lib/price-tracker.js";
import { formatPrice } from "../lib/format.js";
import { ok, err, type Result } from "../lib/result.js";

export const trackPriceSchema = z.object({
  origin: z.string().length(3).describe("Departure airport IATA code"),
  destination: z.string().length(3).describe("Arrival airport IATA code"),
  departureDate: z.string().describe("Travel date (YYYY-MM-DD)"),
  cabinClass: z.enum(["economy", "premium_economy", "business", "first"]).optional().default("economy"),
});

export const priceHistorySchema = z.object({
  origin: z.string().length(3).describe("Departure airport IATA code"),
  destination: z.string().length(3).describe("Arrival airport IATA code"),
  departureDate: z.string().describe("Travel date (YYYY-MM-DD)"),
  cabinClass: z.enum(["economy", "premium_economy", "business", "first"]).optional().default("economy"),
});

export const trackedRoutesSchema = z.object({});

const SEAT_MAP: Readonly<Record<string, SeatType>> = {
  economy: SeatType.ECONOMY, premium_economy: SeatType.PREMIUM_ECONOMY,
  business: SeatType.BUSINESS, first: SeatType.FIRST,
};

// Track: search current price, record it, and report trend
export const handleTrackPrice = async (
  params: z.infer<typeof trackPriceSchema>
): Promise<Result<string>> => {
  const origin = params.origin.toUpperCase();
  const destination = params.destination.toUpperCase();
  const cabin = params.cabinClass ?? "economy";

  // Fetch current price
  const filters: FlightSearchFilters = {
    tripType: TripType.ONE_WAY,
    passengers: { adults: 1, children: 0, infantsOnLap: 0, infantsInSeat: 0 },
    segments: [{ departureAirport: origin, arrivalAirport: destination, travelDate: params.departureDate }],
    stops: MaxStops.ANY,
    seatType: SEAT_MAP[cabin],
    sortBy: SortBy.CHEAPEST,
  };

  const result = await searchFlights(filters, 1);
  if (result.tag === "err") return result;
  const sr = result.value;
  if (sr.tag !== "flights" || sr.flights.length === 0) return err("No flights found");

  const cheapest = sr.flights[0];
  const currency = cheapest.currency ?? "USD";
  const fmt = (p: number) => formatPrice(p, currency);

  // Get history BEFORE recording
  const history = getPriceHistory(origin, destination, params.departureDate, cabin);

  // Record current price
  recordPrice(origin, destination, params.departureDate, cabin, cheapest.price, currency);

  // Compute trend
  const trend = computeTrend(history, cheapest.price);

  const trendEmoji = trend.trend === "dropping" ? "decreasing" :
    trend.trend === "rising" ? "increasing" :
    trend.trend === "new" ? "first observation" : "stable";

  const baseLines = [
    `Price tracked: ${origin} -> ${destination} on ${params.departureDate} (${cabin})`,
    `Current cheapest: ${fmt(cheapest.price)}`,
    `Trend: ${trendEmoji}`,
  ];

  const trendLines = trend.trend !== "new"
    ? [
        `Change: ${trend.priceChange >= 0 ? "+" : ""}${fmt(trend.priceChange)} since last check`,
        `Lowest seen: ${fmt(trend.lowestSeen)}`,
        `Highest seen: ${fmt(trend.highestSeen)}`,
        `Total observations: ${history.length + 1}`,
        ...(cheapest.price <= trend.lowestSeen
          ? [`\nThis is the LOWEST price we have seen for this route!`]
          : []),
      ]
    : [`This is the first time tracking this route. Run again later to see price changes.`];

  return ok([...baseLines, ...trendLines].join("\n"));
};

// View: show price history for a route
export const handlePriceHistory = async (
  params: z.infer<typeof priceHistorySchema>
): Promise<Result<string>> => {
  const origin = params.origin.toUpperCase();
  const destination = params.destination.toUpperCase();
  const cabin = params.cabinClass ?? "economy";

  const history = getPriceHistory(origin, destination, params.departureDate, cabin);

  if (history.length === 0) {
    return ok(
      `No price history for ${origin} -> ${destination} on ${params.departureDate} (${cabin}).\n` +
      `Use the track_price tool to start tracking this route.`
    );
  }

  const currency = history[0].currency;
  const fmt = (p: number) => formatPrice(p, currency);

  const trend = computeTrend(history, history[history.length - 1].price);

  const rows = history.map(
    (h) => `  ${h.recordedAt}: ${fmt(h.price)}`
  );

  return ok(
    `Price history: ${origin} -> ${destination} on ${params.departureDate} (${cabin})\n\n` +
    `${rows.join("\n")}\n\n` +
    `Lowest: ${fmt(trend.lowestSeen)} | Highest: ${fmt(trend.highestSeen)} | Trend: ${trend.trend}`
  );
};

// List: show all tracked routes
export const handleTrackedRoutes = async (
  _params: z.infer<typeof trackedRoutesSchema>
): Promise<Result<string>> => {
  const routes = getTrackedRoutes();

  if (routes.length === 0) {
    return ok("No routes are being tracked yet. Use the track_price tool to start tracking a route.");
  }

  const lines = routes.map(
    (r) => `  ${r.route} on ${r.date} (${r.cabin}): ${formatPrice(r.lastPrice, r.currency)} (${r.recordings} observations)`
  );

  return ok(`Tracked routes:\n\n${lines.join("\n")}`);
};
