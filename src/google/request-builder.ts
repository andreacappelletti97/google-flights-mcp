import type { FlightSearchFilters, FlightSegment } from "./types.js";
import { TripType } from "./types.js";

// Pure transformation: FlightSegment -> nested array for Google's API
const formatSegment = (
  segment: FlightSegment,
  filters: FlightSearchFilters
): readonly unknown[] => {
  const departureAirport = [[[segment.departureAirport, 0]]];
  const arrivalAirport = [[[segment.arrivalAirport, 0]]];

  const airlinesFilter = filters.airlines
    ? [...filters.airlines].sort()
    : null;

  const isMultiLeg =
    filters.tripType === TripType.ROUND_TRIP ||
    filters.tripType === TripType.MULTI_CITY;

  const selectedFlights =
    isMultiLeg && segment.selectedFlight
      ? segment.selectedFlight.legs.map((leg) => [
          leg.departureAirport,
          leg.departureTime.split("T")[0],
          leg.arrivalAirport,
          null,
          leg.airline,
          leg.flightNumber,
        ])
      : null;

  return [
    departureAirport,
    arrivalAirport,
    null,
    filters.stops,
    airlinesFilter,
    null,
    segment.travelDate,
    filters.maxDuration ? [filters.maxDuration] : null,
    selectedFlights,
    null,
    null,
    null,
    null,
    null,
    3,
  ];
};

// Pure transformation: FlightSearchFilters -> nested payload array
const buildPayload = (filters: FlightSearchFilters): readonly unknown[] => {
  const formattedSegments = filters.segments.map((seg) =>
    formatSegment(seg, filters)
  );

  return [
    [],
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
      formattedSegments,
      null,
      null,
      null,
      1,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      filters.excludeBasicEconomy ? 1 : 0,
    ],
    filters.sortBy,
    1,
    0,
    1,
  ];
};

// Pure transformation: payload -> URL-encoded request body string
const encodePayload = (payload: readonly unknown[]): string => {
  const payloadJson = JSON.stringify(payload);
  const wrapped = JSON.stringify([null, payloadJson]);
  return `f.req=${encodeURIComponent(wrapped)}`;
};

// Composition of the above: filters -> encoded body
export const buildRequestBody = (filters: FlightSearchFilters): string =>
  encodePayload(buildPayload(filters));
