// Structured logger writing JSON to stderr (stdout is reserved for MCP protocol).
// Respects GF_MCP_LOG_LEVEL env var. Pure construction, effectful write.

import { config } from "./config.js";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogEntry = {
  readonly level: LogLevel;
  readonly msg: string;
  readonly ts: string;
  readonly [key: string]: unknown;
};

const LOG_LEVELS: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = (): number => LOG_LEVELS[config.logging.level] ?? 1;

const buildEntry = (
  level: LogLevel,
  msg: string,
  meta: Readonly<Record<string, unknown>> = {}
): LogEntry => ({
  level,
  msg,
  ts: new Date().toISOString(),
  ...meta,
});

const write = (level: LogLevel, entry: LogEntry): void => {
  if (LOG_LEVELS[level] >= currentLevel()) {
    process.stderr.write(JSON.stringify(entry) + "\n");
  }
};

export const logger = {
  debug: (msg: string, meta?: Readonly<Record<string, unknown>>): void =>
    write("debug", buildEntry("debug", msg, meta)),

  info: (msg: string, meta?: Readonly<Record<string, unknown>>): void =>
    write("info", buildEntry("info", msg, meta)),

  warn: (msg: string, meta?: Readonly<Record<string, unknown>>): void =>
    write("warn", buildEntry("warn", msg, meta)),

  error: (msg: string, meta?: Readonly<Record<string, unknown>>): void =>
    write("error", buildEntry("error", msg, meta)),
} as const;

export const startTimer = (): (() => number) => {
  const start = performance.now();
  return () => Math.round(performance.now() - start);
};
