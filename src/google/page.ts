// IO: fetch Google Flights' public search page and read the result payload it
// inlines. See tfs.ts for why this replaced the GetShoppingResults RPC.
//
// The page embeds its data as AF_initDataCallback({key: 'ds:1', ..., data: [...],
// sideChannel: {}}). The ds:1 data is the same array the RPC returned as a JSON
// string, so response-parser.ts reads it unchanged.
import { httpGet } from "../lib/http.js";
import { ok, err, type Result } from "../lib/result.js";
import { logger } from "../lib/logger.js";

const DS_BLOB = /AF_initDataCallback\((\{[\s\S]*?\})\);/g;
const DS_KEY = /key:\s*'([^']+)'/;
const DS_DATA = /data:([\s\S]*?), sideChannel/;

// Pure: the ds:1 payload of a rendered search page, or null when the page
// carries none (or it is not valid JSON).
export const extractPayload = (html: string): unknown => {
  const blob = [...html.matchAll(DS_BLOB)]
    .map((m) => m[1] ?? "")
    .find((b) => DS_KEY.exec(b)?.[1] === "ds:1");
  const data = blob === undefined ? undefined : DS_DATA.exec(blob)?.[1];
  if (data === undefined) return null;
  try {
    return JSON.parse(data);
  } catch (e) {
    logger.warn("page_payload_invalid_json", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
};

// About one page in sixty comes back 200 with every other data block but no
// ds:1, and the identical request succeeds seconds later (observed by
// punitarani/fli). Retry only that case: HTTP and network errors are already
// retried by httpGet.
const PAGE_ATTEMPTS = 3;
const PAGE_BACKOFF_MS: readonly number[] = [500, 1500];

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const fetchPagePayload = async (url: string, attempt = 0): Promise<Result<unknown>> => {
  const html = await httpGet(url);
  if (html.tag === "err") return html;

  const payload = extractPayload(html.value);
  if (payload !== null) return ok(payload);

  if (attempt + 1 < PAGE_ATTEMPTS) {
    const waitMs = PAGE_BACKOFF_MS[Math.min(attempt, PAGE_BACKOFF_MS.length - 1)];
    logger.warn("page_payload_missing_retry", { attempt: attempt + 1, retryInMs: waitMs });
    await delay(waitMs);
    return fetchPagePayload(url, attempt + 1);
  }
  return err(
    `Google's search page carried no flight data after ${PAGE_ATTEMPTS} attempts. ` +
    "The page layout may have changed, or Google is blocking this network; try again later."
  );
};
