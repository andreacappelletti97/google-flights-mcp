import { z } from "zod";
import { findNearbyAirports, lookupAirport } from "../data/airports.js";
import { ok, err, type Result } from "../lib/result.js";

export const nearbyAirportsSchema = z.object({
  airport: z.string().length(3).describe("IATA code of the airport to search around"),
  radiusKm: z.number().min(50).max(500).optional().default(200).describe("Search radius in kilometers (default: 200)"),
});

export const handleNearbyAirports = async (
  params: z.infer<typeof nearbyAirportsSchema>
): Promise<Result<string>> => {
  const code = params.airport.toUpperCase();
  const origin = lookupAirport(code);

  if (origin.length === 0) {
    return err(`Airport "${code}" not found.`);
  }

  const nearby = findNearbyAirports(code, params.radiusKm ?? 200);

  if (nearby.length === 0) {
    return ok(`No nearby airports found within ${params.radiusKm ?? 200}km of ${code} (${origin[0].name}).`);
  }

  const lines = nearby.map(
    (n) => `  ${n.airport.code} - ${n.airport.name} (${n.airport.city}, ${n.airport.country}) — ${n.distanceKm}km away`
  );

  return ok(
    `Airports near ${code} (${origin[0].name}, ${origin[0].city}) within ${params.radiusKm ?? 200}km:\n\n${lines.join("\n")}\n\n` +
    `Tip: Search these alternatives too — they may have cheaper flights or better schedules.`
  );
};
