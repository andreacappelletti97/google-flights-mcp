import { z } from "zod";
import { ok, type Result } from "../lib/result.js";

export const flightUrlSchema = z.object({
  origin: z.string().length(3).describe("Departure airport IATA code"),
  destination: z.string().length(3).describe("Arrival airport IATA code"),
  departureDate: z.string().describe("Departure date (YYYY-MM-DD)"),
  returnDate: z.string().optional().describe("Return date (YYYY-MM-DD) for round-trip"),
  cabinClass: z.enum(["economy", "premium_economy", "business", "first"]).optional().default("economy"),
  adults: z.number().int().min(1).optional().default(1),
  stops: z.number().int().min(0).max(2).optional().describe("Max stops (0=nonstop)"),
});

// Google Flights cabin class codes
const CABIN_CODES: Readonly<Record<string, number>> = {
  economy: 1, premium_economy: 2, business: 3, first: 4,
};

// Pure: construct a Google Flights URL for direct booking
const buildFlightsUrl = (params: z.infer<typeof flightUrlSchema>): string => {
  const origin = params.origin.toUpperCase();
  const dest = params.destination.toUpperCase();
  const cabin = CABIN_CODES[params.cabinClass ?? "economy"];
  const pax = params.adults ?? 1;

  const queryParams = new URLSearchParams({
    tfs: "", // triggers search
    hl: "en",
    curr: "USD",
  });

  if (cabin !== 1) queryParams.set("cl", String(cabin));
  if (pax !== 1) queryParams.set("px", String(pax));
  if (params.stops !== undefined) queryParams.set("so", String(params.stops));

  return `https://www.google.com/travel/flights?q=Flights+to+${dest}+from+${origin}+on+${params.departureDate}${params.returnDate ? `+return+${params.returnDate}` : ""}&${queryParams.toString()}`;
};

export const handleFlightUrl = async (
  params: z.infer<typeof flightUrlSchema>
): Promise<Result<string>> => {
  const url = buildFlightsUrl(params);
  const tripType = params.returnDate ? "Round-trip" : "One-way";
  return ok(
    `${tripType} Google Flights link:\n` +
    `${params.origin.toUpperCase()} -> ${params.destination.toUpperCase()}\n` +
    `${params.departureDate}${params.returnDate ? ` - ${params.returnDate}` : ""}\n\n` +
    `${url}\n\n` +
    `Click the link to view and book on Google Flights.`
  );
};
