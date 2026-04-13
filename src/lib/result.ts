// Discriminated union for type-safe error handling without exceptions.

export type Result<T, E = string> =
  | { readonly tag: "ok"; readonly value: T }
  | { readonly tag: "err"; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({
  tag: "ok",
  value,
});

export const err = <E>(error: E): Result<never, E> => ({
  tag: "err",
  error,
});

export const isOk = <T, E>(r: Result<T, E>): r is { tag: "ok"; value: T } =>
  r.tag === "ok";

export const isErr = <T, E>(r: Result<T, E>): r is { tag: "err"; error: E } =>
  r.tag === "err";

export const map = <T, U, E>(f: (value: T) => U) =>
  (r: Result<T, E>): Result<U, E> =>
    r.tag === "ok" ? ok(f(r.value)) : r;

export const flatMap = <T, U, E>(f: (value: T) => Result<U, E>) =>
  (r: Result<T, E>): Result<U, E> =>
    r.tag === "ok" ? f(r.value) : r;

export const mapErr = <T, E, F>(f: (error: E) => F) =>
  (r: Result<T, E>): Result<T, F> =>
    r.tag === "err" ? err(f(r.error)) : r;

export const getOrElse = <T, E>(fallback: (error: E) => T) =>
  (r: Result<T, E>): T =>
    r.tag === "ok" ? r.value : fallback(r.error);

export const fromTryCatch = <T>(
  f: () => T,
  onError: (e: unknown) => string = (e) =>
    e instanceof Error ? e.message : String(e)
): Result<T> => {
  try {
    return ok(f());
  } catch (e) {
    return err(onError(e));
  }
};

export const fromPromise = async <T>(
  p: Promise<T>,
  onError: (e: unknown) => string = (e) =>
    e instanceof Error ? e.message : String(e)
): Promise<Result<T>> => {
  try {
    return ok(await p);
  } catch (e) {
    return err(onError(e));
  }
};

// Collect an array of Results into a Result of array.
// Short-circuits on first error via reduce.
export const sequence = <T, E>(
  results: ReadonlyArray<Result<T, E>>
): Result<readonly T[], E> =>
  results.reduce<Result<readonly T[], E>>(
    (acc, r) =>
      acc.tag === "err"
        ? acc
        : r.tag === "err"
          ? r
          : ok([...acc.value, r.value]),
    ok([])
  );

// Collect Results, keeping successes and failures separate.
export const partition = <T, E>(
  results: ReadonlyArray<Result<T, E>>
): { readonly successes: readonly T[]; readonly failures: readonly E[] } =>
  results.reduce(
    (acc, r) =>
      r.tag === "ok"
        ? { ...acc, successes: [...acc.successes, r.value] }
        : { ...acc, failures: [...acc.failures, r.error] },
    { successes: [] as readonly T[], failures: [] as readonly E[] }
  );
