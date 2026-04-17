# google-flights-mcp

[![npm version](https://img.shields.io/npm/v/google-flights-mcp.svg)](https://www.npmjs.com/package/google-flights-mcp)
[![CI](https://github.com/andreacappelletti97/google-flights-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/andreacappelletti97/google-flights-mcp/actions)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

The most feature-rich MCP server for Google Flights. No API key required.

12 tools for searching flights, tracking prices, comparing cabins, analyzing layovers, and more, all powered by real-time Google Flights data.

Works with Claude Desktop, Claude Code, Cursor, and any MCP-compatible client.

## Features no other Google Flights MCP has

- **Carbon emissions** per flight and per leg (CO2 in kg)
- **Price context**: Google's own assessment of whether a price is low, typical, or high
- **Price tracking**: track prices over time with SQLite persistence, detect drops and trends
- **Calendar heatmap**: 60 days of daily prices in a single API call
- **Cabin class comparison**: economy vs premium vs business vs first, side by side
- **Nearby airport suggestions**: find cheaper alternatives (e.g., EWR/LGA near JFK)
- **Layover analysis**: connection time risk assessment (tight/comfortable/overnight)
- **Aircraft & seat details**: Boeing 787 vs 777, seat pitch in inches
- **Google Flights URLs**: direct booking links users can click

## What you can ask

- *"Find nonstop flights from JFK to London next month"*
- *"What's the cheapest week to fly SFO to Tokyo?"*
- *"Compare economy vs business class for LAX to Paris"*
- *"Are there cheaper airports near JFK I should check?"*
- *"Track the price of SFO to NRT on June 15 and alert me if it drops"*
- *"Show me the emissions for flights from SFO to Tokyo"*
- *"Analyze the layovers for connecting flights from SFO to Bangkok"*

## Quick start

### Option 1: npx (no install)

Works immediately with Claude Code:

```bash
claude mcp add google-flights -- npx -y google-flights-mcp
```

Or with Claude Desktop, add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "google-flights": {
      "command": "npx",
      "args": ["-y", "google-flights-mcp"]
    }
  }
}
```

### Option 2: Install from source

```bash
git clone https://github.com/andreacappelletti97/google-flights-mcp.git
cd google-flights-mcp
npm install
npm run build
```

Then connect to Claude Code:

```bash
claude mcp add google-flights node /absolute/path/to/google-flights-mcp/dist/index.js
```

Or Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "google-flights": {
      "command": "node",
      "args": ["/absolute/path/to/google-flights-mcp/dist/index.js"]
    }
  }
}
```

Restart your MCP client. You should see 12 flight tools available.

## Tools (12)

### Search

| Tool | Description |
|------|-------------|
| `search_flights` | One-way & round-trip search. Returns prices, airlines, durations, stops, aircraft, seat pitch, CO2 emissions, and price context. |
| `search_multi_city` | Multi-leg itinerary search (2-5 segments). |

### Price intelligence

| Tool | Description |
|------|-------------|
| `get_calendar_heatmap` | Full calendar of daily prices (~60 days) from a single API call. Cheapest dates at a glance. |
| `get_price_insights` | Scan a date range to find cheapest departure dates (multiple API calls for precision). |
| `compare_cabin_classes` | Compare economy, premium economy, business, and first class prices for the same route. |
| `track_price` | Record current price and report trend (dropping/rising/stable). Persists in SQLite. |
| `get_price_history` | View all recorded price observations for a tracked route. |
| `list_tracked_routes` | List all routes being price-tracked with last known price. |

### Airport tools

| Tool | Description |
|------|-------------|
| `lookup_airport` | Search 8,800+ airports by city, name, IATA code, or country. |
| `find_nearby_airports` | Find alternative airports within a radius (default: 200km). Uses Haversine distance. |

### Utility

| Tool | Description |
|------|-------------|
| `get_flight_url` | Generate a direct Google Flights booking URL. |
| `analyze_layovers` | Analyze connection quality for multi-stop flights. Reports risk level, connection type, aircraft. |

## Example output

### search_flights (with emissions and price context)

```
Flights from SFO to NRT on 2026-06-15:
Price assessment: HIGH ($294 above typical). Range: $500 - $700, typical: $577

Flight 1: $874 | 11h 15m | 0 stop(s) | CO2: 428kg
  ZG 25: SFO -> NRT (11h 15m) [aircraft: Boeing 787, seat pitch: 31 inches, CO2: 428kg]

Flight 2: $1310 | 11h 5m | 0 stop(s) | CO2: 545kg
  NH 7: SFO -> NRT (11h 5m) [aircraft: Boeing 777, seat pitch: 34 inches, CO2: 545kg]
```

### get_calendar_heatmap

```
Price calendar: SFO -> NRT
61 days of data

Cheapest: $384 (2026-02-12)
Most expensive: $870 (2026-04-13)
Average: $632

  2026-02:
    12: $384     ***
    13: $384     ***
    ...
    20: $540     ***
  2026-03:
    06: $609      *
    ...
    20: $689
```

### find_nearby_airports

```
Airports near JFK within 150km:

  LGA - LaGuardia Airport (New York, US), 17km away
  EWR - Newark Liberty International Airport (Newark, US), 33km away
  HPN - Westchester County Airport (White Plains, US), 48km away
```

## How it works

There is no official Google Flights API. This server reverse-engineers Google's internal `FlightsFrontendService` endpoint. It extracts not just flights, but hidden metadata: emissions, price assessments, daily price calendars, aircraft types, and seat details.

### Reliability

- **Caching**: 5-minute TTL cache, identical searches don't hit Google twice
- **Retry with backoff**: exponential backoff + jitter on 429/5xx errors, honors `Retry-After` headers
- **Circuit breaker**: stops requests after 5 consecutive failures, auto-recovers after 30s
- **Structural validation**: clear errors when Google changes their response format
- **TLS mitigation**: `undici` with browser-like headers + rotating User-Agents, `fetch` fallback

### Price tracking

Price history is stored in SQLite at `~/.google-flights-mcp/prices.db`. Each call to `track_price` records the current cheapest price and reports the trend compared to previous observations.

## Development

```bash
npm install         # Install dependencies
npm run build       # Build with tsup
npm test            # Run tests (85 tests)
npm run lint        # ESLint with FP rules (no-let, immutable-data, no-loop-statements)
npm run typecheck   # TypeScript strict type checking
npm run check       # typecheck + lint + test (the full CI pipeline)
npm run dev         # Build in watch mode
```

### Design

Fully functional TypeScript codebase:

- **No mutation**: all types `readonly`, no `let`/`var`/`.push()`/`for` loops
- **Result monad**: errors are values (`Result<T, E>`), not exceptions
- **Pure/IO separation**: pure transforms are separate from network and disk IO
- **Composition**: `pipe()` + `flatMap()` for chaining fallible operations

See [CLAUDE.md](CLAUDE.md) for architecture details and the Google Flights response format reference.

## Limitations

- **No official API**: uses an undocumented Google endpoint that could change at any time. Structural validation makes breakages obvious.
- **Rate limiting**: Google may throttle heavy use. Built-in retry and circuit breaker handle transient issues.
- **Prices are estimates**: prices reflect query time; they can change before booking.
- **Currency**: determined by Google based on IP/locale.

## Contributing

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run `npm run check` to verify
5. Open a PR

## License

ISC
