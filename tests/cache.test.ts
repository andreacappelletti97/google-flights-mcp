import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCache, get, set, buildCacheKey } from "../src/lib/cache.js";

describe("cache", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("stores and retrieves values", () => {
    const cache = createCache<string>();
    set(cache, "key1", "value1");
    expect(get(cache, "key1")).toBe("value1");
  });

  it("returns null for missing keys", () => {
    const cache = createCache<string>();
    expect(get(cache, "missing")).toBeNull();
  });

  it("expires entries after TTL", () => {
    const cache = createCache<string>();
    set(cache, "key1", "value1", 1000); // 1 second TTL

    expect(get(cache, "key1")).toBe("value1");

    vi.advanceTimersByTime(1500);
    expect(get(cache, "key1")).toBeNull();
  });

  it("overwrites existing entries", () => {
    const cache = createCache<string>();
    set(cache, "key1", "first");
    set(cache, "key1", "second");
    expect(get(cache, "key1")).toBe("second");
  });
});

describe("buildCacheKey", () => {
  it("produces deterministic keys", () => {
    const obj = { b: 2, a: 1 };
    expect(buildCacheKey(obj)).toBe(buildCacheKey(obj));
  });

  it("sorts keys for consistency", () => {
    expect(buildCacheKey({ b: 2, a: 1 })).toBe(buildCacheKey({ a: 1, b: 2 }));
  });
});
