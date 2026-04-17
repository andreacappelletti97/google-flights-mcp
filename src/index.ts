import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { randomUUID } from "crypto";
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

// --- Stdio mode (default): for Claude Desktop, Claude Code, local usage ---
const startStdio = async (): Promise<void> => {
  const server = new McpServer({ name: "google-flights", version: "1.0.0" });
  registerTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Google Flights MCP server running on stdio (12 tools)");
};

// --- HTTP mode: for Smithery, remote deployment ---
// Session state requires Map mutation — unavoidable for HTTP session management.
/* eslint-disable functional/immutable-data */
const startHttp = async (): Promise<void> => {
  const app = express();
  const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

  // Optional bearer-token auth. Set GF_MCP_AUTH_TOKEN to require auth;
  // when unset, the server is open (fine for localhost, risky for public deploys).
  const authToken = process.env["GF_MCP_AUTH_TOKEN"];
  const requireAuth: express.RequestHandler = (req, res, next) => {
    if (!authToken) return next();
    const header = req.headers.authorization ?? "";
    const expected = `Bearer ${authToken}`;
    if (header === expected) return next();
    res.status(401).json({ error: "Unauthorized" });
  };

  app.use("/mcp", requireAuth);

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      await session?.transport.handleRequest(req, res, req.body);
      return;
    }

    const server = new McpServer({ name: "google-flights", version: "1.0.0" });
    registerTools(server);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) sessions.delete(sid);
    };

    await server.connect(transport);

    const sid = transport.sessionId;
    if (sid) sessions.set(sid, { server, transport });

    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      await session?.transport.handleRequest(req, res);
      return;
    }
    res.status(400).json({ error: "No session. Send a POST to /mcp first." });
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      await session?.transport.handleRequest(req, res);
      sessions.delete(sessionId);
      return;
    }
    res.status(400).json({ error: "No session found." });
  });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", tools: 12, version: "1.0.0" });
  });

  const port = parseInt(process.env["PORT"] ?? "3000", 10);
  app.listen(port, () => {
    console.error(
      `Google Flights MCP server running on http://0.0.0.0:${port}/mcp (12 tools, auth: ${authToken ? "bearer token required" : "disabled"})`
    );
  });
};

// Entry point: --http flag or PORT env var triggers HTTP mode, otherwise stdio
const mode = process.argv.includes("--http") || process.env["PORT"] ? "http" : "stdio";

const main = mode === "http" ? startHttp : startStdio;

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
