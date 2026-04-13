import { z } from "zod";
import { searchFlights } from "../google/client.js";
import {
  TripType,
  SeatType,
  SortBy,
  MaxStops,
  type FlightSearchFilters,
  type FlightResult,
} from "../google/types.js";
import { formatPrice } from "../lib/format.js";
import { formatDuration } from "../lib/date.js";
import { ok, err, type Result } from "../lib/result.js";

export const cabinComparisonSchema = z.object({
  origin: z.string().length(3).describe("Departure airport IATA code"),
  destination: z.string().length(3).describe("Arrival airport IATA code"),
  departureDate: z.string().describe("Departure date (YYYY-MM-DD)"),
  adults: z.number().int().min(1).optional().default(1),
  maxStops: z.number().int().min(0).max(2).optional().describe("Max stops (0=nonstop)"),
});

const CABINS = [
  { name: "Economy", type: SeatType.ECONOMY },
  { name: "Premium Economy", type: SeatType.PREMIUM_ECONOMY },
  { name: "Business", type: SeatType.BUSINESS },
  { name: "First", type: SeatType.FIRST },
] as const;

const STOPS_MAP: Readonly<Record<number, MaxStops>> = {
  0: MaxStops.NON_STOP, 1: MaxStops.ONE_OR_FEWER, 2: MaxStops.TWO_OR_FEWER,
};

type CabinResult = {
  readonly cabin: string;
  readonly cheapest: FlightResult | null;
  readonly error: string | null;
};

const searchCabin = async (
  params: z.infer<typeof cabinComparisonSchema>,
  cabin: typeof CABINS[number]
): Promise<CabinResult> => {
  const filters: FlightSearchFilters = {
    tripType: TripType.ONE_WAY,
    passengers: { adults: params.adults ?? 1, children: 0, infantsOnLap: 0, infantsInSeat: 0 },
    segments: [{ departureAirport: params.origin.toUpperCase(), arrivalAirport: params.destination.toUpperCase(), travelDate: params.departureDate }],
    stops: params.maxStops !== undefined ? STOPS_MAP[params.maxStops] : MaxStops.ANY,
    seatType: cabin.type,
    sortBy: SortBy.CHEAPEST,
  };

  const result = await searchFlights(filters, 1);
  if (result.tag === "err") return { cabin: cabin.name, cheapest: null, error: result.error };
  const sr = result.value;
  if (sr.tag !== "flights" || sr.flights.length === 0) return { cabin: cabin.name, cheapest: null, error: "No flights available" };
  return { cabin: cabin.name, cheapest: sr.flights[0], error: null };
};

const formatCabinResult = (r: CabinResult): string => {
  if (r.error || !r.cheapest) return `  ${r.cabin}: Not available`;
  const f = r.cheapest;
  const price = formatPrice(f.price, f.currency);
  const route = f.legs.map((l) => `${l.airline} ${l.flightNumber}`).join(" -> ");
  const emissions = f.totalEmissionsGrams ? ` | CO2: ${Math.round(f.totalEmissionsGrams / 1000)}kg` : "";
  return `  ${r.cabin}: ${price} | ${formatDuration(f.duration)} | ${f.stops} stop(s)${emissions} (${route})`;
};

export const handleCabinComparison = async (
  params: z.infer<typeof cabinComparisonSchema>
): Promise<Result<string>> => {
  const results = await Promise.all(
    CABINS.map((cabin) => searchCabin(params, cabin))
  );

  const available = results.filter((r) => r.cheapest !== null);
  if (available.length === 0) {
    return err(`No flights found from ${params.origin} to ${params.destination} on ${params.departureDate} in any cabin class.`);
  }

  const lines = results.map(formatCabinResult);

  // Calculate multipliers vs economy
  const economyPrice = results[0]?.cheapest?.price;
  const multipliers = economyPrice && economyPrice > 0
    ? results.slice(1)
        .filter((r): r is CabinResult & { cheapest: FlightResult } => r.cheapest !== null)
        .map((r) => `  ${r.cabin}: ${(r.cheapest.price / economyPrice).toFixed(1)}x economy`)
        .join("\n")
    : null;

  return ok(
    `Cabin class comparison: ${params.origin.toUpperCase()} -> ${params.destination.toUpperCase()} on ${params.departureDate}\n\n` +
    `${lines.join("\n")}` +
    (multipliers ? `\n\nPrice multipliers:\n${multipliers}` : "")
  );
};
