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

export const buildCacheKey = (obj: unknown): string =>
  typeof obj === "object" && obj !== null
    ? JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort())
    : String(obj);
