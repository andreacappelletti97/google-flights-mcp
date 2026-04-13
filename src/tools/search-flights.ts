import { z } from "zod";
import { searchFlights } from "../google/client.js";
import {
  TripType,
  SeatType,
  SortBy,
  MaxStops,
  type FlightSearchFilters,
  type FlightResult,
  type SearchResult,
  type PriceContext,
} from "../google/types.js";
import { formatPrice } from "../lib/format.js";
import { formatDuration } from "../lib/date.js";
import type { Result } from "../lib/result.js";

export const searchFlightsSchema = z.object({
  origin: z.string().length(3).describe("Departure airport IATA code (e.g., JFK)"),
  destination: z.string().length(3).describe("Arrival airport IATA code (e.g., NRT)"),
  departureDate: z.string().describe("Departure date in YYYY-MM-DD format"),
  returnDate: z.string().optional().describe("Return date in YYYY-MM-DD format (makes it round-trip)"),
  cabinClass: z.enum(["economy", "premium_economy", "business", "first"]).optional().default("economy").describe("Cabin class"),
  adults: z.number().int().min(1).optional().default(1).describe("Number of adult passengers"),
  children: z.number().int().min(0).optional().default(0).describe("Number of child passengers"),
  infants: z.number().int().min(0).optional().default(0).describe("Number of infant passengers"),
  maxStops: z.number().int().min(0).max(2).optional().describe("Maximum number of stops (0=nonstop, 1, 2). Omit for any."),
  sortBy: z.enum(["best", "price", "duration", "departure", "arrival"]).optional().default("best").describe("Sort results by"),
  maxResults: z.number().int().min(1).max(20).optional().default(5).describe("Maximum number of results to return"),
});

const SEAT_MAP: Readonly<Record<string, SeatType>> = {
  economy: SeatType.ECONOMY, premium_economy: SeatType.PREMIUM_ECONOMY,
  business: SeatType.BUSINESS, first: SeatType.FIRST,
};
const SORT_MAP: Readonly<Record<string, SortBy>> = {
  best: SortBy.BEST, price: SortBy.CHEAPEST, duration: SortBy.DURATION,
  departure: SortBy.DEPARTURE_TIME, arrival: SortBy.ARRIVAL_TIME,
};
const STOPS_MAP: Readonly<Record<number, MaxStops>> = {
  0: MaxStops.NON_STOP, 1: MaxStops.ONE_OR_FEWER, 2: MaxStops.TWO_OR_FEWER,
};

const formatLeg = (leg: FlightResult["legs"][number]): string => {
  const dep = leg.departureTime.replace("T", " ");
  const arr = leg.arrivalTime.replace("T", " ");
  const extras = [
    leg.aircraft ? `aircraft: ${leg.aircraft}` : null,
    leg.seatPitch ? `seat pitch: ${leg.seatPitch}` : null,
    leg.emissionsGrams ? `CO2: ${Math.round(leg.emissionsGrams / 1000)}kg` : null,
  ].filter(Boolean);
  const extraStr = extras.length > 0 ? ` [${extras.join(", ")}]` : "";
  return `  ${leg.airline} ${leg.flightNumber}: ${leg.departureAirport} ${dep} -> ${leg.arrivalAirport} ${arr} (${formatDuration(leg.duration)})${extraStr}`;
};

const formatFlightResult = (flight: FlightResult, index: number): string => {
  const legs = flight.legs.map(formatLeg).join("\n");
  const price = formatPrice(flight.price, flight.currency);
  const emissions = flight.totalEmissionsGrams
    ? ` | CO2: ${Math.round(flight.totalEmissionsGrams / 1000)}kg`
    : "";
  return `Flight ${index + 1}: ${price} | ${formatDuration(flight.duration)} | ${flight.stops} stop(s)${emissions}\n${legs}`;
};

const formatPriceContext = (ctx: PriceContext): string => {
  const diff = ctx.priceDifference < 0
    ? `$${Math.abs(ctx.priceDifference)} below typical`
    : ctx.priceDifference > 0
      ? `$${ctx.priceDifference} above typical`
      : "at typical price";
  return `Price assessment: ${ctx.assessment.toUpperCase()} (${diff}). Range: $${ctx.lowPrice} - $${ctx.highPrice}, typical: $${ctx.typicalPrice}`;
};

const buildFilters = (
  params: z.infer<typeof searchFlightsSchema>
): FlightSearchFilters => {
  const isRoundTrip = params.returnDate !== undefined;
  const outbound = {
    departureAirport: params.origin.toUpperCase(),
    arrivalAirport: params.destination.toUpperCase(),
    travelDate: params.departureDate,
  };
  const segments = isRoundTrip && params.returnDate
    ? [outbound, { departureAirport: params.destination.toUpperCase(), arrivalAirport: params.origin.toUpperCase(), travelDate: params.returnDate }]
    : [outbound];
  return {
    tripType: isRoundTrip ? TripType.ROUND_TRIP : TripType.ONE_WAY,
    passengers: { adults: params.adults ?? 1, children: params.children ?? 0, infantsOnLap: params.infants ?? 0, infantsInSeat: 0 },
    segments,
    stops: params.maxStops !== undefined ? STOPS_MAP[params.maxStops] : MaxStops.ANY,
    seatType: SEAT_MAP[params.cabinClass ?? "economy"],
    sortBy: SORT_MAP[params.sortBy ?? "best"],
  };
};

const formatSearchResult = (result: SearchResult, params: z.infer<typeof searchFlightsSchema>): string => {
  const max = params.maxResults ?? 5;
  const priceCtx = result.metadata.priceContext ? `\n${formatPriceContext(result.metadata.priceContext)}\n` : "";

  if (result.tag === "combos") {
    const lines = result.combos.slice(0, max).map((combo, i) => {
      const parts = combo.map((flight, j) => {
        const label = j === 0 ? "Outbound" : "Return";
        return `${label}:\n${formatFlightResult(flight, 0)}`;
      });
      return `--- Option ${i + 1} ---\n${parts.join("\n")}`;
    });
    return `Round-trip flights: ${params.origin} <-> ${params.destination}\n${params.departureDate} - ${params.returnDate}${priceCtx}\n${lines.join("\n\n")}`;
  }

  const lines = result.flights.slice(0, max).map(formatFlightResult);
  return `Flights from ${params.origin} to ${params.destination} on ${params.departureDate}:${priceCtx}\n${lines.join("\n\n")}`;
};

export const handleSearchFlights = async (
  params: z.infer<typeof searchFlightsSchema>
): Promise<Result<string>> => {
  const filters = buildFilters(params);
  const result = await searchFlights(filters, params.maxResults ?? 5);
  return result.tag === "ok"
    ? { tag: "ok", value: formatSearchResult(result.value, params) }
    : result;
};
