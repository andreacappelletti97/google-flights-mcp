import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// Keep backoff negligible; config reads env at import time, so set it first.
process.env.GF_MCP_RETRY_BASE_DELAY_MS = "1";
process.env.GF_MCP_RETRY_MAX = "2";

const THROTTLE_BODY =
  ")]}'\n" + JSON.stringify([["wrb.fr", null, null, null, null, [13]], ["di", 120]]);
const REAL_BODY =
  ")]}'\n" + JSON.stringify([["wrb.fr", "svc", JSON.stringify([null, null, [[]]])]]);

let server: Server;
let baseUrl: string;
let hits: string[] = [];
let mode: "always-throttle" | "throttle-once" = "always-throttle";

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? "");
    const throttled = mode === "always-throttle" || hits.length === 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(throttled ? THROTTLE_BODY : REAL_BODY);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("postWithRetry on a payload-less 200", () => {
  it("retries instead of handing the empty body straight to the parser", async () => {
    const { httpPost } = await import("../src/lib/http.js");
    hits = [];
    mode = "always-throttle";

    const result = await httpPost(`${baseUrl}/always`, "f.req=x", "application/x-www-form-urlencoded");

    // 1 initial attempt + GF_MCP_RETRY_MAX retries.
    expect(hits).toHaveLength(3);
    // Reports rate limiting rather than letting the parser call it a format change.
    expect(result.tag).toBe("err");
    if (result.tag !== "err") return;
    expect(result.error).toContain("rate limiting");
    expect(result.error).toContain("not a format change");
  });

  it("recovers when a later attempt carries a payload", async () => {
    const { httpPost } = await import("../src/lib/http.js");
    hits = [];
    mode = "throttle-once";

    const result = await httpPost(`${baseUrl}/recover`, "f.req=x", "application/x-www-form-urlencoded");

    expect(hits).toHaveLength(2);
    expect(result.tag).toBe("ok");
    if (result.tag !== "ok") return;
    expect(result.value).toContain("wrb.fr");
    expect(result.value).toContain("svc");
  });
});
