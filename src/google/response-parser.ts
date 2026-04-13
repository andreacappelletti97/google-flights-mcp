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
// Recursive scan replaces imperative loop for FP consistency.
const findCurrencyInProtobuf = (buf: Buffer): string | null => {
  const scan = (i: number): string | null => {
    if (i >= buf.length - 4) return null;
    if (buf[i] === 0x1a && buf[i + 1] === 0x03) {
      const candidate = String.fromCharCode(buf[i + 2], buf[i + 3], buf[i + 4]);
      if (KNOWN_CURRENCIES.has(candidate)) return candidate;
    }
    return scan(i + 1);
  };
  return scan(0);
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

// --- Structural validators ---

const validateFlightEntry = (data: readonly unknown[]): Result<readonly unknown[]> => {
  const flightData = data[0];
  if (!Array.isArray(flightData)) {
    logger.warn("parse_skip_entry", { reason: "flight entry [0] is not an array", type: typeof flightData });
    return err("Malformed flight entry: [0] is not an array");
  }
  const legs = flightData[2];
  if (!Array.isArray(legs) || legs.length === 0) {
    logger.warn("parse_skip_entry", { reason: "flight entry [0][2] (legs) is not a non-empty array" });
    return err("Malformed flight entry: legs data is not an array");
  }
  return ok(data);
};

const validateLegEntry = (legData: readonly unknown[]): boolean => {
  if (legData.length < 23) {
    logger.warn("parse_skip_leg", { reason: "leg has fewer than 23 elements", length: legData.length });
    return false;
  }
  if (typeof legData[3] !== "string" || typeof legData[6] !== "string") {
    logger.warn("parse_skip_leg", { reason: "missing airport codes" });
    return false;
  }
  return true;
};

// --- Individual parsers (pure) ---

const parseLeg = (legData: readonly unknown[]): FlightLeg => {
  const airlineData = safeArray(legData[22]);
  return {
    airline: safeString(airlineData[0], "Unknown"),
    airlineName: safeString(airlineData[3], safeString(airlineData[0], "Unknown")),
    flightNumber: safeString(airlineData[1]),
    departureAirport: safeString(legData[3]),
    arrivalAirport: safeString(legData[6]),
    departureTime: formatDateTime(
      safeNumberArray(legData[20]),
      safeNumberArray(legData[8])
    ),
    arrivalTime: formatDateTime(
      safeNumberArray(legData[21]),
      safeNumberArray(legData[10])
    ),
    duration: safeNumber(legData[11]),
    aircraft: typeof legData[17] === "string" ? legData[17] : null,
    seatPitch: typeof legData[30] === "string" ? legData[30] : (typeof legData[14] === "string" ? legData[14] : null),
    emissionsGrams: safeNumberOrNull(legData[31]),
  };
};

const parseFlight = (data: readonly unknown[]): Result<FlightResult> => {
  const validation = validateFlightEntry(data);
  if (validation.tag === "err") return validation;

  const flightData = safeArray(data[0]);
  const rawLegs = safeArray(flightData[2]);
  const validLegs = rawLegs.filter((leg) => validateLegEntry(safeArray(leg)));

  if (validLegs.length === 0) {
    return err("No valid legs found in flight entry");
  }

  const totalDuration = safeNumber(flightData[9]);
  const priceBlock = Array.isArray(data[1]) ? data[1] : null;
  const priceArr = priceBlock && Array.isArray(priceBlock[0]) ? priceBlock[0] : null;
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
