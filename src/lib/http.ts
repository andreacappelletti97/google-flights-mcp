// HTTP client with retry, browser-like TLS fingerprinting mitigation, and undici+fetch fallback.
//
// RISK: Google Flights has no official API. We hit their internal endpoint
// which may block requests that don't look like a real browser. The `fli`
// Python library uses curl_cffi with Chrome impersonation for this reason.
//
// MITIGATION STRATEGY:
// 1. Use undici with HTTP/1.1 (avoids some TLS fingerprint checks)
// 2. Rotate realistic User-Agent strings
// 3. Include plausible browser headers (Accept-Language, etc.)
// 4. If undici fails, fall back to Node.js built-in fetch
// 5. Retry on 429/5xx with exponential backoff + jitter
//
// If Google tightens enforcement, the fallback options are:
// - Use a headless browser (playwright) for the actual requests
// - Switch to SerpAPI as a paid alternative
// - Use a proxy service that handles TLS fingerprinting

import { request } from "undici";
import { ok, err, type Result } from "./result.js";
import { logger, startTimer } from "./logger.js";
import { config } from "./config.js";

const USER_AGENTS: readonly string[] = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
];

const pickUserAgent = (): string =>
  USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const BROWSER_HEADERS: Readonly<Record<string, string>> = {
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": "https://www.google.com",
  "Referer": "https://www.google.com/travel/flights",
};

const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

const computeDelay = (attempt: number): number =>
  Math.min(
    config.retry.baseDelayMs * Math.pow(2, attempt) + Math.random() * config.retry.baseDelayMs,
    config.retry.maxDelayMs
  );

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Parse a Retry-After header value. The header may be either:
//   - a non-negative integer number of seconds
//   - an HTTP-date (RFC 7231)
// Returns ms, or null if the header is missing/unparseable.
const parseRetryAfter = (raw: string | string[] | null | undefined): number | null => {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
};

// Single-attempt POST via undici with fetch fallback
const postOnce = async (
  url: string,
  body: string,
  headers: Record<string, string>
): Promise<{ readonly status: number; readonly text: string; readonly retryAfterMs: number | null }> => {
  try {
    const { statusCode, headers: responseHeaders, body: responseBody } = await request(url, {
      method: "POST",
      headers,
      body,
    });
    return {
      status: statusCode,
      text: await responseBody.text(),
      retryAfterMs: parseRetryAfter(responseHeaders["retry-after"]),
    };
  } catch (undiciErr) {
    logger.warn("undici_failed_fallback_to_fetch", {
      error: undiciErr instanceof Error ? undiciErr.message : String(undiciErr),
    });
    const response = await fetch(url, { method: "POST", headers, body });
    return {
      status: response.status,
      text: await response.text(),
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
    };
  }
};

// Recursive retry with exponential backoff (or Retry-After when provided)
const postWithRetry = async (
  url: string,
  body: string,
  headers: Record<string, string>,
  attempt: number
): Promise<Result<string>> => {
  try {
    const { status, text, retryAfterMs } = await postOnce(url, body, headers);

    if (status >= 200 && status < 300) return ok(text);

    if (attempt < config.retry.maxRetries && RETRYABLE_STATUSES.has(status)) {
      const waitMs = retryAfterMs !== null
        ? Math.min(retryAfterMs, config.retry.maxDelayMs)
        : computeDelay(attempt);
      logger.warn("http_retry", {
        status,
        attempt: attempt + 1,
        retryInMs: Math.round(waitMs),
        honoredRetryAfter: retryAfterMs !== null,
      });
      await delay(waitMs);
      return postWithRetry(url, body, headers, attempt + 1);
    }

    return err(`HTTP ${status}`);
  } catch (e) {
    if (attempt < config.retry.maxRetries) {
      const waitMs = computeDelay(attempt);
      logger.warn("http_network_retry", {
        error: e instanceof Error ? e.message : String(e),
        attempt: attempt + 1,
        retryInMs: Math.round(waitMs),
      });
      await delay(waitMs);
      return postWithRetry(url, body, headers, attempt + 1);
    }
    return err(e instanceof Error ? e.message : String(e));
  }
};

export const httpPost = async (
  url: string,
  body: string,
  contentType: string
): Promise<Result<string>> => {
  const headers = {
    ...BROWSER_HEADERS,
    "Content-Type": contentType,
    "User-Agent": pickUserAgent(),
  };
  const elapsed = startTimer();
  const result = await postWithRetry(url, body, headers, 0);
  if (result.tag === "ok") {
    logger.debug("http_post_success", { url: url.split("?")[0], durationMs: elapsed() });
  }
  return result;
};
