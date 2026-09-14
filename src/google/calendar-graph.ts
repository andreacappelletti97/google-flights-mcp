// Single-call forward price calendar via GetCalendarGraph.
//
// GetShoppingResults prices ONE departure date per call, so building a calendar
// from it costs one request per day. GetCalendarGraph is a separate RPC on the
// same service that takes a date RANGE and returns the cheapest fare per day for
// up to 61 days in a single request.
//
// The payload is shaped like the GetShoppingResults one with two differences:
// element [0] is null rather than [], and element [2] carries [fromDate, toDate]
// instead of the sort order. The main filter block is also shorter — the trailing
// GetShoppingResults-only fields are rejected here.
import type { FlightSearchFilters } from "./types.js";
import { TripType } from "./types.js";
import { formatSegment } from "./request-builder.js";
import { extractCurrencyFromToken } from "./response-parser.js";
import { httpPost } from "../lib/http.js";
import { ok, err, type Result } from "../lib/result.js";
import { logger } from "../lib/logger.js";

const CALENDAR_URL =
  "https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetCalendarGraph";

// Google caps one GetCalendarGraph call at 61 days.
export const MAX_CALENDAR_DAYS = 61;

export type CalendarDatePrice = {
  readonly date: string;
  readonly cheapestPrice: number;
  readonly currency: string | null;
};

const buildCalendarPayload = (
  filters: FlightSearchFilters,
  fromDate: string,
  toDate: string
): readonly unknown[] => [
  null,
  [
    null,
    null,
    filters.tripType,
    null,
    [],
    filters.seatType,
    [
      filters.passengers.adults,
      filters.passengers.children,
      filters.passengers.infantsOnLap,
      filters.passengers.infantsInSeat,
    ],
    filters.maxPrice ? [null, filters.maxPrice] : null,
    null,
    null,
    null,
    null,
    null,
    filters.segments.map((seg) => formatSegment(seg, filters)),
    null,
    null,
    null,
    1,
  ],
  [fromDate, toDate],
];

export const buildCalendarRequestBody = (
  filters: FlightSearchFilters,
  fromDate: string,
  toDate: string
): string => {
  const payloadJson = JSON.stringify(buildCalendarPayload(filters, fromDate, toDate));
  return `f.req=${encodeURIComponent(JSON.stringify([null, payloadJson]))}`;
};

const safeArray = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

// Each row is [departureDate, returnDate | null, priceBlock, ...] where
// priceBlock is [[null, price], currencyToken].
const parseRow = (row: unknown): readonly CalendarDatePrice[] => {
  const cells = safeArray(row);
  const date = cells[0];
  if (typeof date !== "string") return [];

  const priceBlock = safeArray(cells[2]);
  const priceArr = safeArray(priceBlock[0]);
  const price = typeof priceArr[1] === "number" ? priceArr[1] : 0;
  if (price === 0) return [];

  const currency =
    typeof priceBlock[1] === "string" ? extractCurrencyFromToken(priceBlock[1]) : null;

  return [{ date, cheapestPrice: price, currency }];
};

export const parseCalendarGraph = (raw: string): Result<readonly CalendarDatePrice[]> => {
  const stripped = raw.replace(/^\)\]\}'/, "");
  const outer = ((): readonly unknown[] => {
    try {
      const parsed = JSON.parse(stripped);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const entry = outer.find(
    (e) => Array.isArray(e) && e[0] === "wrb.fr" && typeof e[2] === "string"
  );
  if (!entry) {
    logger.warn("calendar_no_payload", { outerLength: outer.length });
    return err("No calendar data found in response — Google may have changed the response format");
  }

  const payload = ((): readonly unknown[] => {
    try {
      const parsed = JSON.parse((entry as readonly unknown[])[2] as string);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  // The date rows live in the terminal array of the payload.
  const rows = safeArray(payload[payload.length - 1]);
  const prices = rows.flatMap(parseRow);

  return prices.length > 0
    ? ok(prices)
    : err("Calendar returned no priced dates for this route and range");
};

export const fetchCalendarGraph = async (
  filters: FlightSearchFilters,
  fromDate: string,
  toDate: string
): Promise<Result<readonly CalendarDatePrice[]>> => {
  const body = buildCalendarRequestBody(filters, fromDate, toDate);
  const textResult = await httpPost(
    CALENDAR_URL,
    body,
    "application/x-www-form-urlencoded;charset=UTF-8"
  );
  if (textResult.tag === "err") return textResult;
  return parseCalendarGraph(textResult.value);
};

export const isRoundTrip = (filters: FlightSearchFilters): boolean =>
  filters.tripType === TripType.ROUND_TRIP;
