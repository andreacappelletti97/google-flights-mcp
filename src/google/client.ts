import type {
  FlightSearchFilters,
  FlightResult,
  FlightCombo,
  SearchResult,
  SearchMetadata,
} from "./types.js";
import { TripType } from "./types.js";
import { buildRequestBody } from "./request-builder.js";
import { parseFlightsResponse } from "./response-parser.js";
import { ok, err, type Result, flatMap } from "../lib/result.js";
import { pipe } from "../lib/pipe.js";
import { logger, startTimer } from "../lib/logger.js";
import { createCircuitBreaker } from "../lib/retry.js";
import { httpPost } from "../lib/http.js";
import { createCache, get as cacheGet, set as cacheSet, buildCacheKey } from "../lib/cache.js";

const FLIGHTS_URL =
  "https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetShoppingResults";

type FetchResult = {
  readonly flights: readonly FlightResult[];
  readonly metadata: SearchMetadata;
};

const flightsCache = createCache<FetchResult>();
const circuitBreaker = createCircuitBreaker();

const fetchFlights = async (
  filters: FlightSearchFilters
): Promise<Result<FetchResult>> => {
  const cacheKey = buildCacheKey(filters);
  const cached = cacheGet(flightsCache, cacheKey);
  if (cached) {
    logger.debug("cache_hit", { key: cacheKey.slice(0, 60) });
    return ok(cached);
  }

  const elapsed = startTimer();

  const result = await circuitBreaker.execute(async () => {
    const body = buildRequestBody(filters);
    const textResult = await httpPost(
      FLIGHTS_URL,
      body,
      "application/x-www-form-urlencoded;charset=UTF-8"
    );
    return pipe(textResult, flatMap(parseFlightsResponse));
  });

  if (result.tag === "ok") {
    cacheSet(flightsCache, cacheKey, result.value);
    logger.info("search_complete", {
      origin: filters.segments[0]?.departureAirport,
      destination: filters.segments[0]?.arrivalAirport,
      results: result.value.flights.length,
      durationMs: elapsed(),
    });
  } else {
    logger.error("search_failed", {
      origin: filters.segments[0]?.departureAirport,
      destination: filters.segments[0]?.arrivalAirport,
      error: result.error,
      durationMs: elapsed(),
    });
  }

  return result;
};

const countSelected = (filters: FlightSearchFilters): number =>
  filters.segments.filter((s) => s.selectedFlight !== undefined).length;

const withSelectedFlight = (
  filters: FlightSearchFilters,
  segmentIndex: number,
  flight: FlightResult
): FlightSearchFilters => ({
  ...filters,
  segments: filters.segments.map((seg, i) =>
    i === segmentIndex ? { ...seg, selectedFlight: flight } : seg
  ),
});

const prependToCombos = (
  selected: FlightResult,
  next: SearchResult
): readonly FlightCombo[] =>
  next.tag === "flights"
    ? next.flights.map((flight) => [selected, flight])
    : next.combos.map((combo) => [selected, ...combo]);

const assembleMultiLeg = async (
  filters: FlightSearchFilters,
  topN: number
): Promise<Result<SearchResult>> => {
  const fetchResult = await fetchFlights(filters);
  if (fetchResult.tag === "err") return fetchResult;

  const { flights, metadata } = fetchResult.value;
  if (flights.length === 0) return err("No flights found");

  const selectedCount = countSelected(filters);
  const numSegments = filters.segments.length;

  if (selectedCount >= numSegments - 1) {
    return ok({ tag: "flights" as const, flights, metadata });
  }

  const nestedResults = await Promise.all(
    flights.slice(0, topN).map(async (selected) => {
      const nextFilters = withSelectedFlight(filters, selectedCount, selected);
      const nextResult = await assembleMultiLeg(nextFilters, topN);
      return nextResult.tag === "ok"
        ? prependToCombos(selected, nextResult.value)
        : ([] as readonly FlightCombo[]);
    })
  );

  const combos = nestedResults.flat();

  return combos.length > 0
    ? ok({ tag: "combos" as const, combos, metadata })
    : err("No flight combinations found");
};

export const searchFlights = async (
  filters: FlightSearchFilters,
  topN: number = 5
): Promise<Result<SearchResult>> => {
  if (filters.tripType === TripType.ONE_WAY) {
    const result = await fetchFlights(filters);
    if (result.tag === "err") return result;
    return result.value.flights.length > 0
      ? ok({ tag: "flights" as const, flights: result.value.flights, metadata: result.value.metadata })
      : err("No flights found");
  }

  return assembleMultiLeg(filters, topN);
};
