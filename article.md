# I Built a 12-Tool Google Flights MCP Server That Gives AI Assistants Real-Time Flight Data

Google Flights has no public API. Google shut down the QPX Express API back in 2018 and never replaced it. If you want flight data programmatically, your options are paid scrapers, third-party aggregators, or reverse engineering.

I chose reverse engineering.

I built **google-flights-mcp**, an open-source MCP (Model Context Protocol) server that lets AI assistants like Claude search Google Flights directly. It has 12 tools, 85 tests, and extracts data that even the Google Flights website barely surfaces -- carbon emissions per flight, price assessments, daily price calendars, aircraft types, and seat pitch measurements.

This post walks through how it works, what I learned building it, and why MCP is changing how we think about AI tool use.

## What is MCP and Why Does It Matter

Model Context Protocol is an open standard that lets AI assistants call external tools. Think of it as a USB-C port for AI -- a universal interface that any model can use to interact with any service.

Before MCP, giving Claude the ability to search flights would mean building a custom integration. With MCP, you publish a server once and it works with Claude Desktop, Claude Code, Cursor, and any other MCP-compatible client.

The install is one command:

```bash
claude mcp add google-flights -- npx -y google-flights-mcp
```

After that, you can ask Claude things like:

- Find nonstop flights from JFK to London next month
- What is the cheapest week to fly SFO to Tokyo?
- Compare economy vs business class for LAX to Paris
- Track the price of SFO to NRT on June 15 and tell me if it drops

Claude calls the appropriate tool, gets real-time data from Google Flights, and responds with prices, airlines, durations, emissions, and more.

## The 12 Tools

Most Google Flights MCP servers on GitHub offer 2 or 3 tools. I wanted to build something comprehensive enough that you would never need to open google.com/flights again.

**Search tools** handle the core use case. `search_flights` supports one-way and round-trip searches with cabin class, stop filters, and sorting. `search_multi_city` handles complex multi-leg itineraries with up to 5 segments.

**Price intelligence** is where this server stands apart. `get_calendar_heatmap` returns roughly 60 days of daily cheapest prices in a single API call -- no scanning or batching needed. Google embeds this data in every search response, but nobody else extracts it. `compare_cabin_classes` runs economy, premium economy, business, and first class searches in parallel and presents them side by side with price multipliers. `track_price` records the current cheapest price to a local SQLite database and reports whether the price is dropping, rising, or stable compared to previous checks. `get_price_history` and `list_tracked_routes` let you review your tracked data.

**Airport tools** include `lookup_airport`, which searches a bundled database of 8,811 IATA airports by city, name, code, or country. `find_nearby_airports` uses Haversine distance to suggest alternatives -- search JFK and it tells you about LGA (17km away) and EWR (33km away), which often have cheaper flights.

**Utility tools** round things out. `get_flight_url` generates a direct Google Flights booking link users can click. `analyze_layovers` examines connecting flights and classifies each layover as tight, comfortable, long, or overnight based on connection time and whether the transfer is domestic or international.

## How It Extracts Data From Google Flights

There is no API. What Google Flights uses internally is an RPC endpoint at:

```
POST https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetShoppingResults
```

The request body is a URL-encoded parameter `f.req` containing a deeply nested JSON array structure. The response comes back with a `)]}'` XSSI prefix followed by another nested array.

This is the same approach used by the popular Python library fli (1.9k+ stars on GitHub). I ported the request/response format to TypeScript and then went further by parsing fields that nobody else extracts.

For example, each flight leg has an index `[31]` that contains CO2 emissions in grams. Index `[17]` has the aircraft type. Index `[30]` has seat pitch in inches. The top-level response at index `[5]` contains Google's own price assessment -- the current price, the typical price, the low and high range, and a daily price calendar stretching back and forward about 60 days.

None of the existing Google Flights MCP servers parse any of this. They stop at price, airline, and duration.

## Architecture Decisions

I wrote the entire codebase in a functional programming style. Every type is immutable with `readonly` fields. There are no `let` declarations, no `.push()` calls, no `for` or `while` loops (with one documented exception for a protobuf byte scanner where recursion would allocate unnecessarily). Errors flow as `Result<T, E>` values through `pipe` and `flatMap` chains rather than thrown exceptions.

This is enforced by tooling, not just convention. ESLint runs with `eslint-plugin-functional` configured to error on `no-let`, `immutable-data`, and `no-loop-statements`. The CI pipeline runs lint, type-check, and 85 tests on every push.

For reliability, the server includes several layers of protection against Google blocking requests or changing their response format:

**Caching** keeps a 5-minute TTL in-memory cache so identical searches do not hit Google twice. **Retry with exponential backoff** handles transient 429 and 5xx errors with jitter to avoid thundering herd. **Circuit breaker** stops sending requests after 5 consecutive failures and auto-recovers after 30 seconds. **Structural validation** checks the response shape at every nesting level before indexing into arrays, producing clear error messages like "response format changed: expected array at index 2" instead of cryptic null dereferences. **TLS fingerprinting mitigation** uses `undici` with rotating User-Agent strings and browser-like headers, falling back to native `fetch` if undici fails.

All configuration values -- cache TTL, retry limits, circuit breaker thresholds, default search parameters -- live in a centralized config module that reads from environment variables with sensible defaults.

## What I Learned

**Google embeds more data than they display.** The Flights UI shows price, airline, duration, and stops. The underlying response contains emissions, aircraft type, seat pitch, fare class details, airline alliance membership, airport coordinates, and a full daily price calendar. Parsing these hidden fields is what differentiates this server from everything else on GitHub.

**MCP servers benefit from being opinionated about UX.** A raw JSON dump of flight data is not useful to an AI assistant. The response formatting matters -- grouping flights clearly, showing price context inline, adding CO2 comparisons, warning about tight layovers. The tool descriptions also matter. A well-written description helps the AI model choose the right tool without the user having to know the exact tool name.

**Functional programming in TypeScript requires discipline but pays off.** The `Result` monad eliminated every `try/catch` block from the business logic. When Google changes their response format, the error propagates cleanly through the entire call chain with context about exactly which parsing step failed. The immutability constraints caught several bugs during development where I was accidentally mutating a filters object during round-trip combo assembly.

## Try It

The server is open source and published on npm:

```bash
npm install -g google-flights-mcp
```

Or use it directly with Claude Code:

```bash
claude mcp add google-flights -- npx -y google-flights-mcp
```

GitHub: https://github.com/andreacappelletti97/google-flights-mcp
npm: https://www.npmjs.com/package/google-flights-mcp

It works with Claude Desktop, Claude Code, Cursor, and any MCP-compatible client. No API key, no account, no configuration. Just install and ask about flights.

If you find it useful, a star on GitHub helps with discoverability. Issues and PRs are welcome -- the CLAUDE.md file in the repo has the full architecture reference including the Google Flights response format documentation.
