// Pure: FlightSearchFilters -> the `tfs` parameter of Google Flights' public
// search page (https://www.google.com/travel/flights?tfs=...).
//
// Since 2026-08 the FlightsFrontendService RPCs (GetShoppingResults,
// GetCalendarGraph) only answer requests signed with an
// x-goog-batchexecute-bgr header that the page's own JavaScript computes
// over the exact request bytes. Every other client gets HTTP 200 with a
// payload-less ["wrb.fr",null,null,null,null,[13]] row, whatever it sends.
// The public search page is not gated: it inlines the same result payload
// (see page.ts), addressed by this protobuf instead of the f.req JSON.
//
// Field numbers follow punitarani/fli (MIT), fli/search/_proto.py, which
// moved to this transport for the same reason (punitarani/fli#223).
import type { FlightSearchFilters, FlightSegment, FlightResult } from "./types.js";
import { MaxStops, TripType } from "./types.js";
import { ok, err, type Result } from "../lib/result.js";

const utf8 = (s: string): Buffer => Buffer.from(s, "utf8");

// Base-128 varint; tfs only carries small non-negative integers.
const varint = (value: number): Buffer =>
  value < 0x80
    ? Buffer.from([value])
    : Buffer.concat([Buffer.from([(value & 0x7f) | 0x80]), varint(Math.floor(value / 128))]);

const tag = (field: number, wire: number): Buffer => varint(field * 8 + wire);

const lengthDelimited = (field: number, payload: Buffer): Buffer =>
  Buffer.concat([tag(field, 2), varint(payload.length), payload]);

const varintField = (field: number, value: number): Buffer =>
  Buffer.concat([tag(field, 0), varint(value)]);

const airportField = (field: number, code: string): Buffer =>
  lengthDelimited(field, Buffer.concat([varintField(1, 1), lengthDelimited(2, utf8(code))]));

// A pinned flight narrows the search to itineraries that include it: that is
// how a round trip asks for return options against a chosen outbound.
const pinnedLegs = (flight: FlightResult): readonly Buffer[] =>
  flight.legs.map((leg) =>
    lengthDelimited(
      4,
      Buffer.concat([
        lengthDelimited(1, utf8(leg.departureAirport)),
        lengthDelimited(2, utf8(leg.departureTime.split("T")[0])),
        lengthDelimited(3, utf8(leg.arrivalAirport)),
        lengthDelimited(5, utf8(leg.airline)),
        lengthDelimited(6, utf8(leg.flightNumber)),
      ])
    )
  );

// tfs counts stops from zero (0 = non-stop) and has no "any" value: the field
// is left out instead. Writing 0 for MaxStops.ANY would pin every search to
// non-stop.
const stopsField = (stops: MaxStops): readonly Buffer[] =>
  stops === MaxStops.ANY ? [] : [varintField(5, stops - 1)];

const encodeSegment = (segment: FlightSegment, filters: FlightSearchFilters): Buffer =>
  lengthDelimited(
    3,
    Buffer.concat([
      lengthDelimited(2, utf8(segment.travelDate)),
      ...stopsField(filters.stops),
      ...(filters.airlines ?? []).map((code) => lengthDelimited(6, utf8(code))),
      ...(segment.selectedFlight ? pinnedLegs(segment.selectedFlight) : []),
      airportField(13, segment.departureAirport),
      airportField(14, segment.arrivalAirport),
    ])
  );

// One entry per traveller: 1 adult, 2 child, 3 infant on lap, 4 infant in
// seat. A lap infant prices at ~10% of an adult fare and a seated one at
// ~100%, so transposing the two would quote a plausible wrong price.
const repeat = (code: number, count: number): readonly number[] =>
  Array.from({ length: count }, () => code);

const passengerCodes = (filters: FlightSearchFilters): readonly number[] => {
  const { adults, children, infantsOnLap, infantsInSeat } = filters.passengers;
  const codes = [
    ...repeat(1, adults),
    ...repeat(2, children),
    ...repeat(3, infantsOnLap),
    ...repeat(4, infantsInSeat),
  ];
  return codes.length > 0 ? codes : [1];
};

export const MULTI_CITY_UNSUPPORTED =
  "Multi-city search is not available: Google now loads multi-city results only " +
  "through an endpoint that requires a browser-computed signature, and its public " +
  "search page carries no rows for them. Search each leg separately with search_flights.";

// Builds the base64url `tfs` value, unpadded as Google's own URLs carry it.
export const buildTfs = (filters: FlightSearchFilters): Result<string> => {
  // Sending multi-city as one-way makes Google serve the first leg's board,
  // which would decode cleanly into wrong results, so refuse instead.
  if (filters.tripType === TripType.MULTI_CITY) return err(MULTI_CITY_UNSUPPORTED);

  const payload = Buffer.concat([
    varintField(1, 28),
    varintField(2, 2),
    ...filters.segments.map((segment) => encodeSegment(segment, filters)),
    ...passengerCodes(filters).map((code) => varintField(8, code)),
    varintField(9, filters.seatType),
    varintField(14, 1),
    varintField(19, filters.tripType === TripType.ONE_WAY ? 2 : 1),
  ]);
  return ok(payload.toString("base64url"));
};

export const SEARCH_PAGE_URL = "https://www.google.com/travel/flights";

// hl=en keeps the inlined strings (airline names, aircraft) in English.
// Currency and point of sale are left to Google, as with the old RPC.
export const searchPageUrl = (tfs: string): string =>
  `${SEARCH_PAGE_URL}?tfs=${tfs}&hl=en`;
