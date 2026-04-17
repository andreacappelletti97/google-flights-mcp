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

// Cabin labels embedded in the natural-language search query
const CABIN_LABELS: Readonly<Record<string, string>> = {
  economy: "economy",
  premium_economy: "premium economy",
  business: "business class",
  first: "first class",
};

const STOPS_LABELS: Readonly<Record<number, string>> = {
  0: "nonstop",
  1: "1 stop",
  2: "2 stops",
};

// Pure: construct a Google Flights search URL.
//
// We use the natural-language `q=` parameter rather than the protobuf-encoded
// `tfs=` parameter. Google Flights parses the query and pre-fills the search
// form. This is slightly less precise than `tfs=` (which requires encoding an
// internal protobuf), but it is stable and will not break when Google rotates
// their internal schema.
const buildFlightsUrl = (params: z.infer<typeof flightUrlSchema>): string => {
  const origin = params.origin.toUpperCase();
  const dest = params.destination.toUpperCase();
  const cabin = CABIN_LABELS[params.cabinClass ?? "economy"];
  const pax = params.adults ?? 1;
  const stopsLabel = params.stops !== undefined ? STOPS_LABELS[params.stops] : null;

  const parts = [
    `${cabin} flights from ${origin} to ${dest} on ${params.departureDate}`,
    params.returnDate ? `returning ${params.returnDate}` : null,
    pax > 1 ? `for ${pax} adults` : null,
    stopsLabel,
  ].filter((p): p is string => p !== null);

  const queryParams = new URLSearchParams({
    q: parts.join(" "),
    hl: "en",
    curr: "USD",
  });
  return `https://www.google.com/travel/flights?${queryParams.toString()}`;
};

export const handleFlightUrl = async (
  params: z.infer<typeof flightUrlSchema>
): Promise<Result<string>> => {
  const url = buildFlightsUrl(params);
  const tripType = params.returnDate ? "Round-trip" : "One-way";
  return ok(
    `${tripType} Google Flights search link:\n` +
    `${params.origin.toUpperCase()} -> ${params.destination.toUpperCase()}\n` +
    `${params.departureDate}${params.returnDate ? ` - ${params.returnDate}` : ""}\n\n` +
    `${url}\n\n` +
    `Click to open on Google Flights. The search form will be pre-filled from the URL.`
  );
};
