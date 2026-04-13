import { describe, it, expect } from "vitest";
import { ok, err, map, flatMap, mapErr, getOrElse, sequence, partition, fromTryCatch } from "../src/lib/result.js";
import { pipe } from "../src/lib/pipe.js";

describe("Result", () => {
  describe("ok / err", () => {
    it("creates ok values", () => {
      const r = ok(42);
      expect(r).toEqual({ tag: "ok", value: 42 });
    });

    it("creates err values", () => {
      const r = err("boom");
      expect(r).toEqual({ tag: "err", error: "boom" });
    });
  });

  describe("map", () => {
    it("transforms ok values", () => {
      expect(pipe(ok(2), map((x: number) => x * 3))).toEqual(ok(6));
    });

    it("passes through err values", () => {
      expect(pipe(err("nope"), map((x: number) => x * 3))).toEqual(err("nope"));
    });
  });

  describe("flatMap", () => {
    it("chains ok results", () => {
      const double = (x: number) => (x > 0 ? ok(x * 2) : err("negative"));
      expect(pipe(ok(5), flatMap(double))).toEqual(ok(10));
    });

    it("short-circuits on err", () => {
      const double = (x: number) => ok(x * 2);
      expect(pipe(err("no") as any, flatMap(double))).toEqual(err("no"));
    });

    it("propagates inner errors", () => {
      const failIfBig = (x: number) => (x > 10 ? err("too big") : ok(x));
      expect(pipe(ok(20), flatMap(failIfBig))).toEqual(err("too big"));
    });
  });

  describe("mapErr", () => {
    it("transforms error values", () => {
      expect(pipe(err("bad"), mapErr((e: string) => `Error: ${e}`))).toEqual(err("Error: bad"));
    });

    it("passes through ok values", () => {
      expect(pipe(ok(1), mapErr((e: string) => `Error: ${e}`))).toEqual(ok(1));
    });
  });

  describe("getOrElse", () => {
    it("returns value for ok", () => {
      expect(pipe(ok(42), getOrElse(() => 0))).toBe(42);
    });

    it("returns fallback for err", () => {
      expect(pipe(err("oops"), getOrElse(() => -1))).toBe(-1);
    });
  });

  describe("sequence", () => {
    it("collects all ok values", () => {
      expect(sequence([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
    });

    it("returns first error", () => {
      expect(sequence([ok(1), err("fail"), ok(3)])).toEqual(err("fail"));
    });

    it("handles empty array", () => {
      expect(sequence([])).toEqual(ok([]));
    });
  });

  describe("partition", () => {
    it("separates successes and failures", () => {
      const results = [ok(1), err("a"), ok(2), err("b")];
      expect(partition(results)).toEqual({
        successes: [1, 2],
        failures: ["a", "b"],
      });
    });

    it("handles all ok", () => {
      expect(partition([ok(1), ok(2)])).toEqual({ successes: [1, 2], failures: [] });
    });

    it("handles all err", () => {
      expect(partition([err("x")])).toEqual({ successes: [], failures: ["x"] });
    });
  });

  describe("fromTryCatch", () => {
    it("catches thrown errors", () => {
      const result = fromTryCatch(() => JSON.parse("not json"));
      expect(result.tag).toBe("err");
    });

    it("wraps successful results", () => {
      const result = fromTryCatch(() => JSON.parse('{"a":1}'));
      expect(result).toEqual(ok({ a: 1 }));
    });
  });
});
