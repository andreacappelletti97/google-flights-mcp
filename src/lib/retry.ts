/* eslint-disable functional/immutable-data */
// Circuit breaker pattern.
// Mutable state is scoped to the closure — unavoidable for a stateful pattern.

import { err, type Result } from "./result.js";
import { logger } from "./logger.js";
import { config } from "./config.js";

type CircuitState = {
  failures: number;
  lastFailureTime: number;
  state: "closed" | "open" | "half-open";
};

type CircuitBreakerConfig = {
  readonly failureThreshold: number;
  readonly resetTimeoutMs: number;
};

const DEFAULT_CB_CONFIG: CircuitBreakerConfig = {
  failureThreshold: config.circuitBreaker.failureThreshold,
  resetTimeoutMs: config.circuitBreaker.resetTimeoutMs,
};

export const createCircuitBreaker = (
  config: Partial<CircuitBreakerConfig> = {}
) => {
  const cfg = { ...DEFAULT_CB_CONFIG, ...config };
  const circuit: CircuitState = { failures: 0, lastFailureTime: 0, state: "closed" };

  const canRequest = (): boolean => {
    if (circuit.state === "closed") return true;
    if (circuit.state === "open") {
      if (Date.now() - circuit.lastFailureTime > cfg.resetTimeoutMs) {
        circuit.state = "half-open";
        return true;
      }
      return false;
    }
    return true; // half-open: allow one probe
  };

  const recordSuccess = (): void => {
    circuit.failures = 0;
    circuit.state = "closed";
  };

  const recordFailure = (): void => {
    circuit.failures += 1;
    circuit.lastFailureTime = Date.now();
    if (circuit.failures >= cfg.failureThreshold) {
      circuit.state = "open";
      logger.warn("circuit_breaker_open", {
        failures: circuit.failures,
        resetTimeoutMs: cfg.resetTimeoutMs,
      });
    }
  };

  return {
    execute: async <T>(fn: () => Promise<Result<T>>): Promise<Result<T>> => {
      if (!canRequest()) {
        return err("Circuit breaker is open — too many recent failures. Try again later.");
      }
      const result = await fn();
      if (result.tag === "ok") recordSuccess();
      else recordFailure();
      return result;
    },
  };
};
