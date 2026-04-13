import { z } from "zod";
import { lookupAirport, type Airport } from "../data/airports.js";
import { ok, type Result } from "../lib/result.js";

export const lookupAirportSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("City name, airport name, IATA code, or country code to search for"),
});

// Pure: format airport results
const formatResults = (query: string, results: readonly Airport[]): string =>
  results.length === 0
    ? `No airports found matching "${query}". Try a different search term.`
    : `Airports matching "${query}":\n\n${results.map((a) => `${a.code} - ${a.name} (${a.city}, ${a.country})`).join("\n")}`;

export const handleLookupAirport = async (
  params: z.infer<typeof lookupAirportSchema>
): Promise<Result<string>> =>
  ok(formatResults(params.query, lookupAirport(params.query)));
