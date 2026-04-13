// Airport lookup powered by 8,800+ IATA airports with coordinates.

import { createRequire } from "module";

export type Airport = {
  readonly code: string;
  readonly name: string;
  readonly city: string;
  readonly country: string;
  readonly lat?: number;
  readonly lon?: number;
};

const require = createRequire(import.meta.url);
const AIRPORTS: readonly Airport[] = require("./airports.json");

// Pre-compute lowercase index for fast search
const indexed: readonly { readonly airport: Airport; readonly searchText: string }[] =
  AIRPORTS.map((a) => ({
    airport: a,
    searchText: `${a.code} ${a.name} ${a.city} ${a.country}`.toLowerCase(),
  }));

// Pure: search airports by query string
export const lookupAirport = (query: string): readonly Airport[] => {
  const q = query.toLowerCase().trim();
  const exactMatch = indexed
    .filter((e) => e.airport.code.toLowerCase() === q)
    .map((e) => e.airport);
  if (exactMatch.length > 0) return exactMatch;
  return indexed
    .filter((e) => e.searchText.includes(q))
    .map((e) => e.airport)
    .slice(0, 20);
};

// Pure: Haversine distance in km between two lat/lon pairs
const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Pure: find airports within a radius of a given airport
export const findNearbyAirports = (
  code: string,
  radiusKm: number = 200
): readonly { readonly airport: Airport; readonly distanceKm: number }[] => {
  const origin = AIRPORTS.find((a) => a.code.toUpperCase() === code.toUpperCase());
  if (!origin || origin.lat === undefined || origin.lon === undefined) return [];

  const originLat = origin.lat;
  const originLon = origin.lon;

  return AIRPORTS
    .filter((a): a is Airport & { lat: number; lon: number } =>
      a.code !== origin.code && a.lat !== undefined && a.lon !== undefined)
    .map((a) => ({
      airport: a,
      distanceKm: Math.round(haversineKm(originLat, originLon, a.lat, a.lon)),
    }))
    .filter((a) => a.distanceKm <= radiusKm)
    // Only include airports that are likely to have commercial flights
    .filter((a) => a.airport.name.toLowerCase().includes("international") ||
                   a.airport.name.toLowerCase().includes("airport"))
    .toSorted((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 10);
};

export { AIRPORTS };
