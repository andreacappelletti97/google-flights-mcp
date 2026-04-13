import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { searchFlightsSchema, handleSearchFlights } from "./tools/search-flights.js";
import { searchMultiCitySchema, handleSearchMultiCity } from "./tools/search-multi-city.js";
import { priceInsightsSchema, handlePriceInsights } from "./tools/price-insights.js";
import { lookupAirportSchema, handleLookupAirport } from "./tools/lookup-airport.js";
import { flightUrlSchema, handleFlightUrl } from "./tools/flight-url.js";
import { nearbyAirportsSchema, handleNearbyAirports } from "./tools/nearby-airports.js";
import { cabinComparisonSchema, handleCabinComparison } from "./tools/cabin-comparison.js";
import { calendarHeatmapSchema, handleCalendarHeatmap } from "./tools/calendar-heatmap.js";
import { layoverAnalysisSchema, handleLayoverAnalysis } from "./tools/layover-analysis.js";
import {
  trackPriceSchema, handleTrackPrice,
  priceHistorySchema, handlePriceHistory,
  trackedRoutesSchema, handleTrackedRoutes,
} from "./tools/price-tracker.js";
import type { Result } from "./lib/result.js";
import { withToolLogging } from "./lib/tool-logger.js";

const toMcpResponse = (result: Result<string>) =>
  result.tag === "ok"
    ? { content: [{ type: "text" as const, text: result.value }] }
    : { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true as const };

// Wrap every handler with automatic invocation/timing/result logging
const loggedSearchFlights = withToolLogging("search_flights", handleSearchFlights);
const loggedSearchMultiCity = withToolLogging("search_multi_city", handleSearchMultiCity);
const loggedPriceInsights = withToolLogging("get_price_insights", handlePriceInsights);
const loggedCalendarHeatmap = withToolLogging("get_calendar_heatmap", handleCalendarHeatmap);
const loggedCabinComparison = withToolLogging("compare_cabin_classes", handleCabinComparison);
const loggedTrackPrice = withToolLogging("track_price", handleTrackPrice);
const loggedPriceHistory = withToolLogging("get_price_history", handlePriceHistory);
const loggedTrackedRoutes = withToolLogging("list_tracked_routes", handleTrackedRoutes);
const loggedLookupAirport = withToolLogging("lookup_airport", handleLookupAirport);
const loggedNearbyAirports = withToolLogging("find_nearby_airports", handleNearbyAirports);
const loggedFlightUrl = withToolLogging("get_flight_url", handleFlightUrl);
const loggedLayoverAnalysis = withToolLogging("analyze_layovers", handleLayoverAnalysis);

const registerTools = (server: McpServer): void => {
  server.tool("search_flights",
    "Search for one-way or round-trip flights. Returns prices, airlines, durations, stops, aircraft, emissions, and price context (low/typical/high).",
    searchFlightsSchema.shape,
    async (params) => toMcpResponse(await loggedSearchFlights(params)));

  server.tool("search_multi_city",
    "Search for multi-city (multi-leg) flight itineraries. Supports 2-5 segments.",
    searchMultiCitySchema.shape,
    async (params) => toMcpResponse(await loggedSearchMultiCity(params)));

  server.tool("get_price_insights",
    "Find the cheapest travel dates for a route within a date range. Scans multiple departure dates.",
    priceInsightsSchema.shape,
    async (params) => toMcpResponse(await loggedPriceInsights(params)));

  server.tool("get_calendar_heatmap",
    "Get a full calendar of daily flight prices (~60 days). Single API call, no scanning. Shows cheapest dates at a glance.",
    calendarHeatmapSchema.shape,
    async (params) => toMcpResponse(await loggedCalendarHeatmap(params)));

  server.tool("compare_cabin_classes",
    "Compare prices across economy, premium economy, business, and first class for the same route in one call.",
    cabinComparisonSchema.shape,
    async (params) => toMcpResponse(await loggedCabinComparison(params)));

  server.tool("track_price",
    "Track a flight price over time. Records the current cheapest price and reports if it has gone up, down, or stayed stable since last check.",
    trackPriceSchema.shape,
    async (params) => toMcpResponse(await loggedTrackPrice(params)));

  server.tool("get_price_history",
    "View the recorded price history for a tracked route. Shows all past observations and the trend.",
    priceHistorySchema.shape,
    async (params) => toMcpResponse(await loggedPriceHistory(params)));

  server.tool("list_tracked_routes",
    "List all routes currently being price-tracked, with their last known price and number of observations.",
    trackedRoutesSchema.shape,
    async (params) => toMcpResponse(await loggedTrackedRoutes(params)));

  server.tool("lookup_airport",
    "Look up airport IATA codes by city name, airport name, or country. Searches 8,800+ airports.",
    lookupAirportSchema.shape,
    async (params) => toMcpResponse(await loggedLookupAirport(params)));

  server.tool("find_nearby_airports",
    "Find alternative airports near a given airport within a radius. Useful for finding cheaper flights from nearby cities.",
    nearbyAirportsSchema.shape,
    async (params) => toMcpResponse(await loggedNearbyAirports(params)));

  server.tool("get_flight_url",
    "Generate a direct Google Flights URL for a route. Users can click to view and book flights in their browser.",
    flightUrlSchema.shape,
    async (params) => toMcpResponse(await loggedFlightUrl(params)));

  server.tool("analyze_layovers",
    "Analyze layover quality for connecting flights. Reports connection time, risk level (tight/comfortable/long), and aircraft details.",
    layoverAnalysisSchema.shape,
    async (params) => toMcpResponse(await loggedLayoverAnalysis(params)));
};

const main = async (): Promise<void> => {
  const server = new McpServer({
    name: "google-flights",
    version: "1.0.0",
  });
  registerTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Google Flights MCP server running on stdio (12 tools)");
};

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
