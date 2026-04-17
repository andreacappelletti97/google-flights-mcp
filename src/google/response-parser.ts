import type { FlightResult, FlightLeg, SearchMetadata, PriceContext, DailyPrice } from "./types.js";
import { ok, err, fromTryCatch, flatMap, type Result } from "../lib/result.js";
import { pipe } from "../lib/pipe.js";
import { formatDateTime } from "../lib/date.js";
import { logger } from "../lib/logger.js";

// --- Currency extraction (pure) ---

const KNOWN_CURRENCIES: ReadonlySet<string> = new Set([
  "USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "INR", "KRW",
  "SGD", "HKD", "NZD", "MXN", "BRL", "ZAR", "SEK", "NOK", "DKK", "PLN",
  "CZK", "THB", "MYR", "PHP", "IDR", "VND", "AED", "SAR", "QAR", "ILS",
  "TRY", "EGP", "KES", "NGN", "COP", "PEN", "CLP", "ARS", "TWD", "RUB",
]);

// Scan protobuf bytes for \x1a\x03 prefix followed by a 3-letter currency code.
// Uses Array.from(...).reduce to stay FP without recursion (V8 has no TCO,
// so a recursive scan over a large buffer would risk stack overflow).
const findCurrencyInProtobuf = (buf: Buffer): string | null => {
  const limit = Math.max(0, buf.length - 4);
  return Array.from({ length: limit }).reduce<string | null>((acc, _v, i) => {
    if (acc !== null) return acc;
    if (buf[i] === 0x1a && buf[i + 1] === 0x03) {
      const candidate = String.fromCharCode(buf[i + 2], buf[i + 3], buf[i + 4]);
      if (KNOWN_CURRENCIES.has(candidate)) return candidate;
    }
    return null;
  }, null);
};

const findCurrencyByRegex = (decoded: string): string | null =>
  (decoded.match(/[A-Z]{3}/g) ?? []).find((m) => KNOWN_CURRENCIES.has(m)) ?? null;

const extractCurrencyFromToken = (token: string): string | null => {
  const buf = Buffer.from(token, "base64");
  return findCurrencyInProtobuf(buf) ?? findCurrencyByRegex(buf.toString("latin1"));
};

const extractCurrency = (priceBlock: readonly unknown[]): string | null =>
  priceBlock.length > 1 && typeof priceBlock[1] === "string"
    ? extractCurrencyFromToken(priceBlock[1])
    : null;

// --- Safe accessors ---

const safeArray = (v: unknown): readonly unknown[] =>
  Array.isArray(v) ? v : [];

const safeNumber = (v: unknown, fallback: number = 0): number =>
  typeof v === "number" ? v : fallback;

const safeString = (v: unknown, fallback: string = ""): string =>
  typeof v === "string" ? v : fallback;

const safeNumberArray = (v: unknown): readonly number[] =>
  Array.isArray(v) ? v.map((x) => safeNumber(x)) : [];

const safeNumberOrNull = (v: unknown): number | null =>
  typeof v === "number" ? v : null;

// --- Field index constants (Google's nested-array schema) ---
// These reference positions in Google Flights' internal response format.
// When Google changes their schema, these are the values to update — and they
// show up as named lookups rather than magic numbers scattered around.

const ENTRY = {
  FLIGHT_DATA: 0, // [0] = flight block
  PRICE_BLOCK: 1, // [1] = price block
} as const;

const FLIGHT = {
  LEGS: 2,          // [0][2] = legs array
  TOTAL_DURATION: 9, // [0][9] = duration in minutes
} as const;

const LEG = {
  MIN_LENGTH: 23,
  DEPARTURE_AIRPORT: 3,
  ARRIVAL_AIRPORT: 6,
  DEPARTURE_TIME: 8,
  ARRIVAL_TIME: 10,
  DURATION: 11,
  SEAT_PITCH_LEGACY: 14,
  AIRCRAFT: 17,
  DEPARTURE_DATE: 20,
  ARRIVAL_DATE: 21,
  AIRLINE_INFO: 22, // [code, flightNumber, ?, name]
  SEAT_PITCH: 30,
  EMISSIONS_GRAMS: 31,
} as const;

const AIRLINE = {
  CODE: 0,
  FLIGHT_NUMBER: 1,
  NAME: 3,
} as const;

// --- Structural validators ---

const validateFlightEntry = (data: readonly unknown[]): Result<readonly unknown[]> => {
  const flightData = data[ENTRY.FLIGHT_DATA];
  if (!Array.isArray(flightData)) {
    logger.warn("parse_skip_entry", { reason: "flight entry [0] is not an array", type: typeof flightData });
    return err("Malformed flight entry: [0] is not an array");
  }
  const legs = flightData[FLIGHT.LEGS];
  if (!Array.isArray(legs) || legs.length === 0) {
    logger.warn("parse_skip_entry", { reason: "flight entry [0][2] (legs) is not a non-empty array" });
    return err("Malformed flight entry: legs data is not an array");
  }
  return ok(data);
};

const validateLegEntry = (legData: readonly unknown[]): boolean => {
  if (legData.length < LEG.MIN_LENGTH) {
    logger.warn("parse_skip_leg", { reason: "leg too short", length: legData.length, minLength: LEG.MIN_LENGTH });
    return false;
  }
  if (typeof legData[LEG.DEPARTURE_AIRPORT] !== "string" || typeof legData[LEG.ARRIVAL_AIRPORT] !== "string") {
    logger.warn("parse_skip_leg", { reason: "missing airport codes" });
    return false;
  }
  return true;
};

// --- Individual parsers (pure) ---

const parseLeg = (legData: readonly unknown[]): FlightLeg => {
  const airlineData = safeArray(legData[LEG.AIRLINE_INFO]);
  const aircraftRaw = legData[LEG.AIRCRAFT];
  const seatPitchRaw = legData[LEG.SEAT_PITCH];
  const seatPitchLegacyRaw = legData[LEG.SEAT_PITCH_LEGACY];
  return {
    airline: safeString(airlineData[AIRLINE.CODE], "Unknown"),
    airlineName: safeString(airlineData[AIRLINE.NAME], safeString(airlineData[AIRLINE.CODE], "Unknown")),
    flightNumber: safeString(airlineData[AIRLINE.FLIGHT_NUMBER]),
    departureAirport: safeString(legData[LEG.DEPARTURE_AIRPORT]),
    arrivalAirport: safeString(legData[LEG.ARRIVAL_AIRPORT]),
    departureTime: formatDateTime(
      safeNumberArray(legData[LEG.DEPARTURE_DATE]),
      safeNumberArray(legData[LEG.DEPARTURE_TIME])
    ),
    arrivalTime: formatDateTime(
      safeNumberArray(legData[LEG.ARRIVAL_DATE]),
      safeNumberArray(legData[LEG.ARRIVAL_TIME])
    ),
    duration: safeNumber(legData[LEG.DURATION]),
    aircraft: typeof aircraftRaw === "string" ? aircraftRaw : null,
    seatPitch:
      typeof seatPitchRaw === "string" ? seatPitchRaw :
      typeof seatPitchLegacyRaw === "string" ? seatPitchLegacyRaw :
      null,
    emissionsGrams: safeNumberOrNull(legData[LEG.EMISSIONS_GRAMS]),
  };
};

const parseFlight = (data: readonly unknown[]): Result<FlightResult> => {
  const validation = validateFlightEntry(data);
  if (validation.tag === "err") return validation;

  const flightData = safeArray(data[ENTRY.FLIGHT_DATA]);
  const rawLegs = safeArray(flightData[FLIGHT.LEGS]);
  const validLegs = rawLegs.filter((leg) => validateLegEntry(safeArray(leg)));

  if (validLegs.length === 0) {
    return err("No valid legs found in flight entry");
  }

  const totalDuration = safeNumber(flightData[FLIGHT.TOTAL_DURATION]);
  const priceBlockRaw = data[ENTRY.PRICE_BLOCK];
  const priceBlock: readonly unknown[] | null = Array.isArray(priceBlockRaw) ? priceBlockRaw : null;
  const priceArr: readonly unknown[] | null =
    priceBlock && Array.isArray(priceBlock[0]) ? priceBlock[0] : null;
  const legs = validLegs.map((leg) => parseLeg(safeArray(leg)));

  // Sum emissions across all legs
  const totalEmissions = legs.every((l) => l.emissionsGrams !== null)
    ? legs.reduce((sum, l) => sum + (l.emissionsGrams ?? 0), 0)
    : null;

  return ok({
    price: priceArr ? safeNumber(priceArr[1]) : 0,
    currency: priceBlock ? extractCurrency(priceBlock) : null,
    duration: totalDuration,
    stops: Math.max(0, legs.length - 1),
    legs,
    totalEmissionsGrams: totalEmissions,
  });
};

// --- Metadata parsers (pure) ---

const parsePriceContext = (inner: readonly unknown[]): PriceContext | null => {
  const priceData = safeArray(inner[5]);
  // Structure: [5, [null,current], [null,typical], [null,diff], [null,low], [null,high], ...]
  if (priceData.length < 6) return null;

  const current = safeNumber(safeArray(priceData[1])[1], 0);
  const typical = safeNumber(safeArray(priceData[2])[1], 0);
  const low = safeNumber(safeArray(priceData[4])[1], 0);
  const high = safeNumber(safeArray(priceData[5])[1], 0);

  if (current === 0 || typical === 0) return null;

  const assessment: PriceContext["assessment"] =
    current <= low ? "low" : current >= high ? "high" : "typical";

  // Force sign consistency: positive diff for above-typical, negative for below
  const normalizedDiff = current - typical;

  return { currentPrice: current, typicalPrice: typical, priceDifference: normalizedDiff, lowPrice: low, highPrice: high, assessment };
};

const parseDailyPrices = (inner: readonly unknown[]): readonly DailyPrice[] => {
  const priceData = safeArray(inner[5]);
  // Daily prices are at priceData[10] as [[timestamp, price], ...]
  const dailyArr = safeArray(safeArray(priceData[10])[0]);
  return dailyArr.flatMap((entry) => {
    const pair = safeArray(entry);
    const ts = safeNumber(pair[0], 0);
    const price = safeNumber(pair[1], 0);
    if (ts === 0 || price === 0) return [];
    const date = new Date(ts).toISOString().split("T")[0];
    return [{ date, price }];
  });
};

const parseAvailableAirlines = (inner: readonly unknown[]): readonly { readonly code: string; readonly name: string }[] => {
  const airlineData = safeArray(inner[7]);
  // Airlines at airlineData[1] as [[code, name], ...]
  const carriers = safeArray(safeArray(airlineData[1]));
  return carriers.flatMap((entry) => {
    const pair = safeArray(entry);
    const code = safeString(pair[0]);
    const name = safeString(pair[1]);
    return code && name ? [{ code, name }] : [];
  });
};

const parseMetadata = (inner: readonly unknown[]): SearchMetadata => ({
  priceContext: parsePriceContext(inner),
  dailyPrices: parseDailyPrices(inner),
  availableAirlines: parseAvailableAirlines(inner),
});

// --- Top-level parser pipeline ---

const stripXssiPrefix = (raw: string): string =>
  raw.replace(/^\)\]\}'/, "");

const validateOuterResponse = (parsed: unknown): Result<readonly unknown[]> => {
  if (!Array.isArray(parsed)) {
    return err("Response format changed: expected outer array, got " + typeof parsed);
  }
  if (parsed.length === 0) {
    return err("Response format changed: outer array is empty");
  }
  return ok(parsed);
};

type ParsedInner = {
  readonly flights: readonly FlightResult[];
  readonly metadata: SearchMetadata;
};

// Find the first outer entry containing valid flight data
const findFlightEntry = (outer: readonly unknown[]): readonly unknown[] | null =>
  safeArray(outer).find((entry) => {
    if (!Array.isArray(entry) || typeof entry[2] !== "string") return false;
    const parsed = fromTryCatch(() => JSON.parse(entry[2]));
    if (parsed.tag === "err") return false;
    const inner = parsed.value;
    return Array.isArray(inner) && (Array.isArray(inner[2]) || Array.isArray(inner[3]));
  }) as readonly unknown[] | null;

// Parse the found entry into flights + metadata
const parseFlightEntry = (entry: readonly unknown[]): Result<ParsedInner> => {
  const inner = JSON.parse(entry[2] as string);

  const raw = [2, 3].flatMap((idx) => {
    const bucket = inner[idx];
    return Array.isArray(bucket) && Array.isArray(bucket[0]) ? bucket[0] : [];
  });

  if (raw.length === 0) {
    logger.warn("parse_empty_flights", { innerLength: inner.length });
    return err("No flights in response data");
  }

  const results = raw.map((d: unknown) => parseFlight(safeArray(d)));
  const flights = results.flatMap((r) => (r.tag === "ok" ? [r.value] : []));

  if (flights.length === 0) {
    return err(`All ${results.length} flight entries failed validation`);
  }

  const skipCount = results.length - flights.length;
  if (skipCount > 0) {
    logger.info("parse_partial", { total: results.length, parsed: flights.length, skipped: skipCount });
  }

  return ok({ flights, metadata: parseMetadata(inner) });
};

const findAndParseFlightData = (outer: readonly unknown[]): Result<ParsedInner> => {
  const entry = findFlightEntry(outer);

  if (!entry) {
    logger.warn("parse_no_flight_data", { outerLength: safeArray(outer).length });
    return err("No flight data found in response — Google may have changed the response format");
  }

  return parseFlightEntry(entry);
};

export const parseFlightsResponse = (
  rawText: string
): Result<ParsedInner> =>
  pipe(
    fromTryCatch(
      () => JSON.parse(stripXssiPrefix(rawText)) as readonly unknown[],
      (e) => `Failed to parse Google Flights response as JSON: ${e instanceof Error ? e.message : String(e)}`
    ),
    flatMap(validateOuterResponse),
    flatMap(findAndParseFlightData)
  );
