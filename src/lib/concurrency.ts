// Bounded-concurrency mapping.
//
// Used where a single user-facing call fans out into many upstream requests.
// Google answers an unpaced burst with a payload-less HTTP 200 (a soft
// throttle), so the cap matters more than the wall-clock saving of firing
// everything at once.

const chunk = <T>(arr: readonly T[], n: number): readonly (readonly T[])[] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Applies `fn` across `items` at most `batchSize` at a time, pausing
// `delayMs` between waves. Results keep the input order.
export const mapInBatches = async <T, R>(
  items: readonly T[],
  batchSize: number,
  delayMs: number,
  fn: (item: T) => Promise<R>
): Promise<readonly R[]> => {
  const size = Math.max(1, batchSize);
  if (items.length <= size) return Promise.all(items.map(fn));

  return chunk(items, size).reduce<Promise<readonly R[]>>(
    async (accPromise, batch, i) => {
      const acc = await accPromise;
      if (i > 0 && delayMs > 0) await delay(delayMs);
      const results = await Promise.all(batch.map(fn));
      return [...acc, ...results];
    },
    Promise.resolve([])
  );
};
