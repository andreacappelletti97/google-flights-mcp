# google-flights-mcp

MCP server for searching Google Flights. No API key required — reverse-engineers Google's internal `FlightsFrontendService` protobuf endpoint.

## Architecture

```
src/
├── index.ts                  # Entry point: MCP server + tool registration (IO boundary)
├── lib/                      # FP foundation (pure, reusable)
│   ├── result.ts             # Result<T,E> monad with map/flatMap/sequence/partition
│   ├── pipe.ts               # Type-safe left-to-right composition
│   ├── date.ts               # Timezone-safe date arithmetic
│   ├── format.ts             # Price formatting
│   ├── logger.ts             # Structured JSON logger to stderr
│   ├── cache.ts              # TTL cache (5min, LRU eviction)
│   ├── retry.ts              # Circuit breaker
│   ├── http.ts               # HTTP client with retry, undici + fetch fallback
│   └── price-tracker.ts      # SQLite-backed price persistence
├── google/                   # Google Flights integration
│   ├── types.ts              # Immutable types (readonly, const objects, discriminated unions)
│   ├── request-builder.ts    # Pure: FlightSearchFilters -> URL-encoded request body
│   ├── response-parser.ts    # Pure: raw text -> Result<FlightResult[]> with structural validation
│   └── client.ts             # IO: fetch + cache + circuit breaker + combo assembly
├── tools/                    # MCP tool handlers (12 tools, thin IO shells around pure functions)
│   ├── search-flights.ts     # search_flights (one-way, round-trip, with emissions + price context)
│   ├── search-multi-city.ts  # search_multi_city
│   ├── price-insights.ts     # get_price_insights (date range scan)
│   ├── calendar-heatmap.ts   # get_calendar_heatmap (60-day daily prices from one call)
│   ├── cabin-comparison.ts   # compare_cabin_classes (economy/premium/business/first)
│   ├── price-tracker.ts      # track_price, get_price_history, list_tracked_routes (SQLite)
│   ├── lookup-airport.ts     # lookup_airport
│   ├── nearby-airports.ts    # find_nearby_airports (Haversine distance)
│   ├── flight-url.ts         # get_flight_url (Google Flights booking link)
│   └── layover-analysis.ts   # analyze_layovers (connection risk assessment)
└── data/
    ├── airports.ts           # Airport lookup with pre-computed search index
    └── airports.json         # 8,800+ IATA airports (bundled, no network call)
```

## Key design decisions

- **Functional programming**: No `let`/`var`, no `.push()`, no `for` loops, no `any`, no classes. Errors flow as `Result<T,E>` values, not exceptions. IO isolated to module boundaries.
- **No official API**: Google Flights has no public API. We reverse-engineer the same protobuf endpoint as [punitarani/fli](https://github.com/punitarani/fli) (1.9k stars). See `request-builder.ts` for the nested-array format.
- **TLS fingerprinting risk**: Google may block non-browser requests. We use `undici` with browser-like headers and fallback to `fetch`. See `http.ts` header comment for the full risk analysis and fallback strategy.
- **Structural validation**: The response parser validates array shapes before indexing. When Google changes their response format, you get clear error messages like "expected array at index 2, got null" instead of silent corruption.

## Commands

```bash
npm run build      # Build with tsup (output: dist/)
npm test           # Run vitest
npm run typecheck  # tsc --noEmit
npm run check      # typecheck + test
npm start          # Run the MCP server (stdio)
```

## Testing

Tests cover: Result monad, date utilities, request builder (encodes correct structure), response parser (valid/invalid/malformed inputs), airport lookup, cache TTL. Run with `npm test`.

The response parser tests use synthetic fixtures that mirror Google's nested-array format. When Google changes their format, add a new fixture from a real response and update the parser.

## Adding a new tool

1. Create `src/tools/my-tool.ts` with a zod schema and a handler returning `Promise<Result<string>>`
2. Register it in `src/index.ts` in the `registerTools` function
3. Add tests in `tests/my-tool.test.ts`

## Google Flights response format (reference)

```
Response: )]}'<newline><JSON array>
Outer: array of entries, one has [2] = JSON string of inner data
Inner[2][0] = outbound flights array
Inner[3][0] = return flights array

Per flight: [0][2] = legs, [0][9] = duration, [1] = price block
Per leg: [3]=dep airport, [6]=arr airport, [8]=dep time, [10]=arr time,
         [11]=duration, [20]=dep date, [21]=arr date, [22]=[airline, flight#]
Price block: [[null, price_int], base64_protobuf_with_currency]
```
