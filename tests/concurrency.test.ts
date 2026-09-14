import { describe, it, expect } from "vitest";
import { mapInBatches } from "../src/lib/concurrency.js";

// Runs fn over items while recording how many calls were in flight at once.
const withConcurrencyProbe = async <T>(
  items: readonly T[],
  batchSize: number,
  delayMs: number
): Promise<{ results: readonly T[]; maxInFlight: number }> => {
  const state = { inFlight: 0, maxInFlight: 0 };
  const results = await mapInBatches(items, batchSize, delayMs, async (item) => {
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    await new Promise((r) => setTimeout(r, 5));
    state.inFlight -= 1;
    return item;
  });
  return { results, maxInFlight: state.maxInFlight };
};

describe("mapInBatches", () => {
  it("never exceeds the batch size in flight", async () => {
    const items = Array.from({ length: 8 }, (_, i) => i);
    const { maxInFlight } = await withConcurrencyProbe(items, 3, 0);
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("preserves input order", async () => {
    const items = Array.from({ length: 8 }, (_, i) => i);
    const { results } = await withConcurrencyProbe(items, 3, 0);
    expect(results).toEqual(items);
  });

  it("applies fn to every item exactly once", async () => {
    const seen: number[] = [];
    const items = Array.from({ length: 7 }, (_, i) => i);
    await mapInBatches(items, 2, 0, async (i) => {
      seen.push(i);
      return i;
    });
    expect(seen.toSorted((a, b) => a - b)).toEqual(items);
  });

  it("runs a batch-sized or smaller input in one wave", async () => {
    const items = [1, 2, 3];
    const { maxInFlight, results } = await withConcurrencyProbe(items, 3, 0);
    expect(maxInFlight).toBe(3);
    expect(results).toEqual(items);
  });

  it("handles an empty input", async () => {
    expect(await mapInBatches([], 3, 0, async (x) => x)).toEqual([]);
  });

  it("treats a batch size below 1 as 1 rather than dividing by zero", async () => {
    const items = [1, 2, 3, 4];
    const { maxInFlight, results } = await withConcurrencyProbe(items, 0, 0);
    expect(maxInFlight).toBe(1);
    expect(results).toEqual(items);
  });

  it("pauses between waves but not before the first", async () => {
    const items = Array.from({ length: 6 }, (_, i) => i);
    const started = Date.now();
    await mapInBatches(items, 3, 40, async (i) => i);
    // 2 waves => exactly one inter-wave pause.
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(35);
    expect(elapsed).toBeLessThan(200);
  });

  it("propagates a rejection from fn", async () => {
    await expect(
      mapInBatches([1, 2, 3], 2, 0, async (i) => {
        if (i === 2) throw new Error("boom");
        return i;
      })
    ).rejects.toThrow("boom");
  });
});
