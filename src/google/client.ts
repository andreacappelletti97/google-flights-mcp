import type {
  FlightSearchFilters,
  FlightResult,
  FlightCombo,
  SearchResult,
  SearchMetadata,
} from "./types.js";
import { TripType } from "./types.js";
import { parseFlightsPayload } from "./response-parser.js";
import { buildTfs, searchPageUrl } from "./tfs.js";
import { fetchPagePayload } from "./page.js";
import { ok, err, type Result } from "../lib/result.js";
import { logger, startTimer } from "../lib/logger.js";
import { createCircuitBreaker } from "../lib/retry.js";
import { createCache, get as cacheGet, set as cacheSet, buildCacheKey } from "../lib/cache.js";
import { mapInBatches } from "../lib/concurrency.js";
import { config } from "../lib/config.js";

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

  const tfs = buildTfs(filters);
  if (tfs.tag === "err") return tfs;

  const result = await circuitBreaker.execute(async () => {
    const payload = await fetchPagePayload(searchPageUrl(tfs.value));
    if (payload.tag === "err") return payload;
    const parsed = parseFlightsPayload(payload.value);
    return parsed.tag === "ok"
      ? ok({ ...parsed.value, flights: applyClientSideFilters(parsed.value.flights, filters) })
      : parsed;
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

// The search page has no field for a price cap or a duration cap (the RPC
// did), so apply them to the decoded rows. A capped search can return fewer
// options than before, but every option honours the cap.
const applyClientSideFilters = (
  flights: readonly FlightResult[],
  filters: FlightSearchFilters
): readonly FlightResult[] =>
  flights.filter(
    (f) =>
      (filters.maxPrice === undefined || f.price <= filters.maxPrice) &&
      (filters.maxDuration === undefined || f.duration <= filters.maxDuration)
  );

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

  // One extra request per candidate leg. Firing all of them at once is what
  // makes a round-trip search hit Google's throttle ~topN times faster than a
  // one-way search, so cap the burst rather than sending topN requests at once.
  const nestedResults = await mapInBatches(
    flights.slice(0, topN),
    config.search.multiLegConcurrency,
    config.search.multiLegBatchDelayMs,
    async (selected) => {
      const nextFilters = withSelectedFlight(filters, selectedCount, selected);
      const nextResult = await assembleMultiLeg(nextFilters, topN);
      return nextResult.tag === "ok"
        ? prependToCombos(selected, nextResult.value)
        : ([] as readonly FlightCombo[]);
    }
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
