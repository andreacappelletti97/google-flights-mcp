/* eslint-disable functional/immutable-data */
// TTL cache using Map. Mutation is confined to this module's IO boundary.

import { config } from "./config.js";

type CacheEntry<T> = {
  readonly value: T;
  readonly expiresAt: number;
};

type Cache<T> = Map<string, CacheEntry<T>>;

export const createCache = <T>(): Cache<T> => new Map();

const isValid = <T>(entry: CacheEntry<T>, now: number): boolean =>
  entry.expiresAt > now;

export const get = <T>(cache: Cache<T>, key: string): T | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (!isValid(entry, Date.now())) {
    cache.delete(key);
    return null;
  }
  return entry.value;
};

export const set = <T>(
  cache: Cache<T>,
  key: string,
  value: T,
  ttlMs: number = config.cache.ttlMs
): void => {
  if (cache.size >= config.cache.maxEntries) {
    const now = Date.now();
    const keysToDelete = [...cache.entries()]
      .filter(([, entry]) => !isValid(entry, now))
      .map(([k]) => k);
    keysToDelete.forEach((k) => cache.delete(k));

    if (cache.size >= config.cache.maxEntries) {
      const oldest = [...cache.entries()]
        .reduce((min, curr) => (curr[1].expiresAt < min[1].expiresAt ? curr : min));
      cache.delete(oldest[0]);
    }
  }

  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
};

// Recursively sorts object keys so two structurally equal filter objects
// serialize identically regardless of key insertion order.
//
// NOTE: do not replace this with JSON.stringify(obj, Object.keys(obj).sort()).
// The array form of the replacer is an allowlist applied at EVERY level of the
// tree, so top-level keys only would strip every nested key (each segment would
// serialize to {}) and unrelated searches would collide on one cache key.
const sortKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeysDeep(record[key])])
    );
  }
  return value;
};

export const buildCacheKey = (obj: unknown): string =>
  typeof obj === "object" && obj !== null
    ? JSON.stringify(sortKeysDeep(obj))
    : String(obj);
