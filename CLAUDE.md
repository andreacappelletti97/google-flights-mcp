# google-flights-mcp

MCP server for searching Google Flights. No API key required — loads Google Flights' public search page (`/travel/flights?tfs=...`) and reads the result payload it embeds.

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
│   ├── http.ts               # HTTP GET with retry, undici + fetch fallback
│   ├── concurrency.ts        # mapInBatches: paced fan-out
│   └── price-tracker.ts      # SQLite-backed price persistence
├── google/                   # Google Flights integration
│   ├── types.ts              # Immutable types (readonly, const objects, discriminated unions)
│   ├── tfs.ts                # Pure: FlightSearchFilters -> `tfs` protobuf for the search page URL
│   ├── page.ts               # IO: fetch the search page, extract its ds:1 payload
│   ├── response-parser.ts    # Pure: payload -> Result<FlightResult[]> with structural validation
│   ├── calendar.ts           # IO: cheapest fare per day, one search per day
│   └── client.ts             # IO: fetch + cache + circuit breaker + combo assembly
├── tools/                    # MCP tool handlers (12 tools, thin IO shells around pure functions)
│   ├── search-flights.ts     # search_flights (one-way, round-trip, with emissions + price context)
│   ├── search-multi-city.ts  # search_multi_city
│   ├── price-insights.ts     # get_price_insights (date range scan)
│   ├── calendar-heatmap.ts   # get_calendar_heatmap (cheapest fare per day, up to 31 days)
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
- **No official API**: Google Flights has no public API. Since 2026-08 its `FlightsFrontendService` RPCs (`GetShoppingResults`, `GetCalendarGraph`) only accept requests signed by the page's own JavaScript (`x-goog-batchexecute-bgr`); anything else gets HTTP 200 with a payload-less `[13]` row. Like [punitarani/fli](https://github.com/punitarani/fli) (see fli#223), we load the public search page instead: `tfs.ts` encodes the search, and the page inlines the same payload the RPC returned, in its `ds:1` data block. Multi-city has no page equivalent and is refused.
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

Tests cover: Result monad, date utilities, `tfs` encoding (byte-identical to fli's encoder), page payload extraction, calendar sweep, response parser (valid/invalid/malformed inputs), airport lookup, cache TTL. Run with `npm test`.

The response parser tests use synthetic fixtures that mirror Google's nested-array format. When Google changes their format, add a new fixture from a real response and update the parser.

## Adding a new tool

1. Create `src/tools/my-tool.ts` with a zod schema and a handler returning `Promise<Result<string>>`
2. Register it in `src/index.ts` in the `registerTools` function
3. Add tests in `tests/my-tool.test.ts`

## Google Flights response format (reference)

```
Search page: AF_initDataCallback({key: 'ds:1', ..., data: <inner>, sideChannel: {}})
(The old RPC returned )]}'<newline>[["wrb.fr", null, "<inner as JSON string>"], ...].)
Inner[2][0] = outbound flights array
Inner[3][0] = return flights array

Per flight: [0][2] = legs, [0][9] = duration, [1] = price block
Per leg: [3]=dep airport, [6]=arr airport, [8]=dep time, [10]=arr time,
         [11]=duration, [20]=dep date, [21]=arr date, [22]=[airline, flight#]
Price block: [[null, price_int], base64_protobuf_with_currency]
```
