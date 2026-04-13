// Enums as const objects + union types for better FP ergonomics.

export const TripType = {
  ROUND_TRIP: 1,
  ONE_WAY: 2,
  MULTI_CITY: 3,
} as const;
export type TripType = (typeof TripType)[keyof typeof TripType];

export const SeatType = {
  ECONOMY: 1,
  PREMIUM_ECONOMY: 2,
  BUSINESS: 3,
  FIRST: 4,
} as const;
export type SeatType = (typeof SeatType)[keyof typeof SeatType];

export const SortBy = {
  TOP_FLIGHTS: 0,
  BEST: 1,
  CHEAPEST: 2,
  DEPARTURE_TIME: 3,
  ARRIVAL_TIME: 4,
  DURATION: 5,
} as const;
export type SortBy = (typeof SortBy)[keyof typeof SortBy];

export const MaxStops = {
  ANY: 0,
  NON_STOP: 1,
  ONE_OR_FEWER: 2,
  TWO_OR_FEWER: 3,
} as const;
export type MaxStops = (typeof MaxStops)[keyof typeof MaxStops];

export type PassengerInfo = {
  readonly adults: number;
  readonly children: number;
  readonly infantsOnLap: number;
  readonly infantsInSeat: number;
};

export type FlightSegment = {
  readonly departureAirport: string;
  readonly arrivalAirport: string;
  readonly travelDate: string;
  readonly selectedFlight?: FlightResult;
};

export type FlightSearchFilters = {
  readonly tripType: TripType;
  readonly passengers: PassengerInfo;
  readonly segments: readonly FlightSegment[];
  readonly stops: MaxStops;
  readonly seatType: SeatType;
  readonly sortBy: SortBy;
  readonly maxPrice?: number;
  readonly airlines?: readonly string[];
  readonly maxDuration?: number;
  readonly excludeBasicEconomy?: boolean;
};

export type FlightLeg = {
  readonly airline: string;
  readonly airlineName: string;
  readonly flightNumber: string;
  readonly departureAirport: string;
  readonly arrivalAirport: string;
  readonly departureTime: string;
  readonly arrivalTime: string;
  readonly duration: number;
  readonly aircraft: string | null;
  readonly seatPitch: string | null;
  readonly emissionsGrams: number | null;
};

export type FlightResult = {
  readonly price: number;
  readonly currency: string | null;
  readonly duration: number;
  readonly stops: number;
  readonly legs: readonly FlightLeg[];
  readonly totalEmissionsGrams: number | null;
};

// Price context from Google: is this price low, typical, or high?
export type PriceContext = {
  readonly currentPrice: number;
  readonly typicalPrice: number;
  readonly priceDifference: number; // negative = savings
  readonly lowPrice: number;
  readonly highPrice: number;
  readonly assessment: "low" | "typical" | "high";
};

// Daily price calendar data point
export type DailyPrice = {
  readonly date: string; // YYYY-MM-DD
  readonly price: number;
};

// Rich search metadata from Google's response
export type SearchMetadata = {
  readonly priceContext: PriceContext | null;
  readonly dailyPrices: readonly DailyPrice[];
  readonly availableAirlines: readonly { readonly code: string; readonly name: string }[];
};

// A round-trip/multi-city combo: one FlightResult per segment
export type FlightCombo = readonly FlightResult[];

// What searchFlights returns
export type SearchResult = {
  readonly tag: "flights";
  readonly flights: readonly FlightResult[];
  readonly metadata: SearchMetadata;
} | {
  readonly tag: "combos";
  readonly combos: readonly FlightCombo[];
  readonly metadata: SearchMetadata;
};
