import { z } from "zod";
import { searchFlights } from "../google/client.js";
import {
  TripType,
  SeatType,
  SortBy,
  MaxStops,
  type FlightSearchFilters,
  type FlightResult,
  type FlightLeg,
} from "../google/types.js";
import { formatPrice } from "../lib/format.js";
import { formatDuration } from "../lib/date.js";
import { ok, err, type Result } from "../lib/result.js";
import { lookupAirport } from "../data/airports.js";

export const layoverAnalysisSchema = z.object({
  origin: z.string().length(3).describe("Departure airport IATA code"),
  destination: z.string().length(3).describe("Arrival airport IATA code"),
  departureDate: z.string().describe("Departure date (YYYY-MM-DD)"),
  cabinClass: z.enum(["economy", "premium_economy", "business", "first"]).optional().default("economy"),
  maxResults: z.number().int().min(1).max(10).optional().default(5),
});

const SEAT_MAP: Readonly<Record<string, SeatType>> = {
  economy: SeatType.ECONOMY, premium_economy: SeatType.PREMIUM_ECONOMY,
  business: SeatType.BUSINESS, first: SeatType.FIRST,
};

// Pure: compute layover duration in minutes between two consecutive legs
const layoverMinutes = (prevLeg: FlightLeg, nextLeg: FlightLeg): number => {
  const prevArr = new Date(prevLeg.arrivalTime).getTime();
  const nextDep = new Date(nextLeg.departureTime).getTime();
  return Math.round((nextDep - prevArr) / 60_000);
};

// Pure: classify a layover
const classifyLayover = (minutes: number, isInternational: boolean): string => {
  if (minutes < 0) return "OVERLAP (schedule error)";
  const minRecommended = isInternational ? 120 : 60;
  if (minutes < 45) return "VERY TIGHT — high risk of missed connection";
  if (minutes < minRecommended) return "TIGHT — may be risky, especially with delays";
  if (minutes < 180) return "COMFORTABLE";
  if (minutes < 360) return "LONG — consider airport amenities";
  if (minutes < 720) return "VERY LONG — consider leaving the airport";
  return "OVERNIGHT — you may need accommodation";
};

// Pure: check if a connection is international using airport country data
const getCountry = (code: string): string | null => {
  const results = lookupAirport(code);
  return results.length > 0 ? results[0].country : null;
};

const isInternationalConnection = (leg1: FlightLeg, leg2: FlightLeg): boolean => {
  const arrCountry = getCountry(leg1.arrivalAirport);
  const depCountry = getCountry(leg2.departureAirport);
  // If we can't determine countries, assume international (safer for layover time)
  if (!arrCountry || !depCountry) return true;
  return arrCountry !== depCountry;
};

// Pure: analyze layovers for a single flight result
const analyzeLayovers = (flight: FlightResult, index: number): string => {
  if (flight.legs.length <= 1) {
    return `Flight ${index + 1}: Nonstop — no layovers`;
  }

  const price = formatPrice(flight.price, flight.currency);
  const emissions = flight.totalEmissionsGrams
    ? ` | CO2: ${Math.round(flight.totalEmissionsGrams / 1000)}kg`
    : "";

  const header = `Flight ${index + 1}: ${price} | ${formatDuration(flight.duration)} | ${flight.stops} stop(s)${emissions}`;

  const legDetails = flight.legs.map((leg, i) => {
    const aircraftInfo = leg.aircraft ? ` (${leg.aircraft})` : "";
    return `  Leg ${i + 1}: ${leg.airline} ${leg.flightNumber} ${leg.departureAirport} -> ${leg.arrivalAirport} (${formatDuration(leg.duration)})${aircraftInfo}`;
  });

  const layoverDetails = flight.legs.slice(0, -1).map((leg, i) => {
    const nextLeg = flight.legs[i + 1];
    const minutes = layoverMinutes(leg, nextLeg);
    const intl = isInternationalConnection(leg, nextLeg);
    const classification = classifyLayover(minutes, intl);
    const connectionType = intl ? "International" : "Domestic";

    return `  Layover at ${leg.arrivalAirport}: ${formatDuration(minutes)} — ${classification} (${connectionType} connection)`;
  });

  // Interleave legs and layovers
  const interleaved = flight.legs.flatMap((_leg, i) =>
    i < layoverDetails.length
      ? [legDetails[i], layoverDetails[i]]
      : [legDetails[i]]
  );

  return `${header}\n${interleaved.join("\n")}`;
};

export const handleLayoverAnalysis = async (
  params: z.infer<typeof layoverAnalysisSchema>
): Promise<Result<string>> => {
  const origin = params.origin.toUpperCase();
  const destination = params.destination.toUpperCase();

  // Search for flights with 1+ stops to get layover data
  const filters: FlightSearchFilters = {
    tripType: TripType.ONE_WAY,
    passengers: { adults: 1, children: 0, infantsOnLap: 0, infantsInSeat: 0 },
    segments: [{ departureAirport: origin, arrivalAirport: destination, travelDate: params.departureDate }],
    stops: MaxStops.ANY,
    seatType: SEAT_MAP[params.cabinClass ?? "economy"],
    sortBy: SortBy.BEST,
  };

  const result = await searchFlights(filters, params.maxResults ?? 5);
  if (result.tag === "err") return result;

  const flights = result.value.tag === "flights" ? result.value.flights : [];
  if (flights.length === 0) return err(`No flights found from ${origin} to ${destination} on ${params.departureDate}.`);

  const max = params.maxResults ?? 5;
  const withStops = flights.filter((f) => f.stops > 0).slice(0, max);
  const nonstops = flights.filter((f) => f.stops === 0).slice(0, 2);

  const nonstopSection = nonstops.length > 0
    ? [`Nonstop options:\n${nonstops.map((f) => `  Nonstop: ${formatPrice(f.price, f.currency)} | ${formatDuration(f.duration)} | ${f.legs[0].airline} ${f.legs[0].flightNumber}`).join("\n")}`]
    : [];

  const connectingSection = withStops.length > 0
    ? [`Connecting flights with layover analysis:\n\n${withStops.map(analyzeLayovers).join("\n\n")}`]
    : ["No connecting flights found — all available flights are nonstop."];

  const sections = [...nonstopSection, ...connectingSection];

  return ok(
    `Layover analysis: ${origin} -> ${destination} on ${params.departureDate}\n\n${sections.join("\n\n")}`
  );
};
