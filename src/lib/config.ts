// Centralized configuration. All tunable values in one place.
// Override any value via environment variables prefixed with GF_MCP_.

const envInt = (key: string, fallback: number): number => {
  const val = process.env[`GF_MCP_${key}`];
  return val !== undefined ? parseInt(val, 10) : fallback;
};

const envString = (key: string, fallback: string): string =>
  process.env[`GF_MCP_${key}`] ?? fallback;

export const config = {
  // Cache
  cache: {
    ttlMs: envInt("CACHE_TTL_MS", 5 * 60 * 1000), // 5 minutes
    maxEntries: envInt("CACHE_MAX_ENTRIES", 100),
  },

  // HTTP retry
  retry: {
    maxRetries: envInt("RETRY_MAX", 2),
    baseDelayMs: envInt("RETRY_BASE_DELAY_MS", 500),
    maxDelayMs: envInt("RETRY_MAX_DELAY_MS", 5000),
  },

  // Circuit breaker
  circuitBreaker: {
    failureThreshold: envInt("CB_FAILURE_THRESHOLD", 5),
    resetTimeoutMs: envInt("CB_RESET_TIMEOUT_MS", 30_000),
  },

  // Search defaults
  search: {
    defaultMaxResults: envInt("DEFAULT_MAX_RESULTS", 5),
    defaultCabinClass: envString("DEFAULT_CABIN_CLASS", "economy"),
    priceInsightsMaxDays: envInt("PRICE_INSIGHTS_MAX_DAYS", 30),
    priceInsightsBatchDelay: envInt("PRICE_INSIGHTS_BATCH_DELAY_MS", 500),
  },

  // Nearby airports
  airports: {
    defaultRadiusKm: envInt("AIRPORT_RADIUS_KM", 200),
    maxResults: envInt("AIRPORT_MAX_RESULTS", 10),
  },

  // Price tracker
  priceTracker: {
    dbDir: envString("PRICE_DB_DIR", ""),  // empty = default ~/.google-flights-mcp
  },

  // Logging
  logging: {
    level: envString("LOG_LEVEL", "info") as "debug" | "info" | "warn" | "error",
  },
} as const;
