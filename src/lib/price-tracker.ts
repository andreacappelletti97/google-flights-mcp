/* eslint-disable functional/no-let */
// SQLite-backed price tracking for detecting price changes over time.
// The DB file lives alongside the built output in ~/.google-flights-mcp/prices.db

import Database from "better-sqlite3";
import { join } from "path";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { config } from "./config.js";

export type PriceRecord = {
  readonly route: string; // "SFO-NRT"
  readonly date: string; // travel date
  readonly cabin: string;
  readonly price: number;
  readonly currency: string;
  readonly recordedAt: string; // ISO timestamp
};

export type PriceTrend = {
  readonly route: string;
  readonly date: string;
  readonly cabin: string;
  readonly history: readonly PriceRecord[];
  readonly currentPrice: number;
  readonly lowestSeen: number;
  readonly highestSeen: number;
  readonly priceChange: number; // vs previous recording
  readonly trend: "dropping" | "rising" | "stable" | "new";
};

const DB_DIR = config.priceTracker.dbDir || join(homedir(), ".google-flights-mcp");
const DB_PATH = join(DB_DIR, "prices.db");

const getDb = (() => {
  let db: Database.Database | null = null;
  return (): Database.Database => {
    if (db) return db;
    mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    migrate(db);
    return db;
  };
})();

// Schema versioning via SQLite's user_version pragma.
// Each migration runs once and bumps the version. New migrations must:
//   (1) append to this array, never modify existing entries,
//   (2) be idempotent where possible (CREATE IF NOT EXISTS, etc.).
const MIGRATIONS: readonly ((db: Database.Database) => void)[] = [
  // v1: initial schema
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route TEXT NOT NULL,
        travel_date TEXT NOT NULL,
        cabin TEXT NOT NULL,
        price REAL NOT NULL,
        currency TEXT NOT NULL,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_route_date ON price_history(route, travel_date, cabin);
    `);
  },
];

const migrate = (db: Database.Database): void => {
  const currentVersion = (db.pragma("user_version", { simple: true }) as number) ?? 0;
  const targetVersion = MIGRATIONS.length;
  if (currentVersion >= targetVersion) return;
  const pending = MIGRATIONS.slice(currentVersion);
  db.transaction(() => {
    pending.forEach((run, i) => {
      run(db);
      db.pragma(`user_version = ${currentVersion + i + 1}`);
    });
  })();
};

// IO: record a price observation
export const recordPrice = (
  origin: string,
  destination: string,
  travelDate: string,
  cabin: string,
  price: number,
  currency: string
): void => {
  const db = getDb();
  const route = `${origin}-${destination}`;
  db.prepare(
    "INSERT INTO price_history (route, travel_date, cabin, price, currency) VALUES (?, ?, ?, ?, ?)"
  ).run(route, travelDate, cabin, price, currency);
};

// IO: get price history for a route
export const getPriceHistory = (
  origin: string,
  destination: string,
  travelDate: string,
  cabin: string
): readonly PriceRecord[] => {
  const db = getDb();
  const route = `${origin}-${destination}`;
  const rows = db.prepare(
    "SELECT route, travel_date as date, cabin, price, currency, recorded_at as recordedAt FROM price_history WHERE route = ? AND travel_date = ? AND cabin = ? ORDER BY recorded_at ASC"
  ).all(route, travelDate, cabin) as PriceRecord[];
  return rows;
};

// Pure: compute price trend from history
export const computeTrend = (
  history: readonly PriceRecord[],
  currentPrice: number
): PriceTrend => {
  if (history.length === 0) {
    return {
      route: "", date: "", cabin: "",
      history: [],
      currentPrice,
      lowestSeen: currentPrice,
      highestSeen: currentPrice,
      priceChange: 0,
      trend: "new",
    };
  }

  const latest = history[history.length - 1];
  const lowestSeen = Math.min(currentPrice, ...history.map((h) => h.price));
  const highestSeen = Math.max(currentPrice, ...history.map((h) => h.price));
  const priceChange = currentPrice - latest.price;
  const changePercent = latest.price > 0 ? Math.abs(priceChange / latest.price) : 0;

  const trend: PriceTrend["trend"] =
    changePercent < 0.02 ? "stable" :
    priceChange < 0 ? "dropping" : "rising";

  return {
    route: latest.route,
    date: latest.date,
    cabin: latest.cabin,
    history,
    currentPrice,
    lowestSeen,
    highestSeen,
    priceChange,
    trend,
  };
};

// IO: get all tracked routes
export const getTrackedRoutes = (): readonly { readonly route: string; readonly date: string; readonly cabin: string; readonly lastPrice: number; readonly currency: string; readonly recordings: number }[] => {
  const db = getDb();
  return db.prepare(`
    SELECT route, travel_date as date, cabin,
           (SELECT price FROM price_history p2 WHERE p2.route = p1.route AND p2.travel_date = p1.travel_date AND p2.cabin = p1.cabin ORDER BY recorded_at DESC LIMIT 1) as lastPrice,
           (SELECT currency FROM price_history p2 WHERE p2.route = p1.route AND p2.travel_date = p1.travel_date AND p2.cabin = p1.cabin ORDER BY recorded_at DESC LIMIT 1) as currency,
           COUNT(*) as recordings
    FROM price_history p1
    GROUP BY route, travel_date, cabin
    ORDER BY MAX(recorded_at) DESC
  `).all() as { route: string; date: string; cabin: string; lastPrice: number; currency: string; recordings: number }[];
};
