import { describe, it, expect } from "vitest";
import { isPayloadlessEnvelope } from "../src/lib/http.js";

// A real response: at least one wrb.fr entry whose [2] is the payload string.
const realResponse = ")]}'\n" + JSON.stringify([
  ["wrb.fr", "FlightsFrontendService", JSON.stringify([null, null, [[]]])],
  ["di", 120],
]);

// Google's soft throttle: HTTP 200, well-formed frame, no payload.
const throttleResponse = ")]}'\n" + JSON.stringify([
  ["wrb.fr", null, null, null, null, [13]],
  ["di", 120],
  ["af.httprm", 120, "-1717975504004165497", 10],
]);

// Hard rejection, as reported in issue #1 (bug 2).
const errorResponse = ")]}'\n" + JSON.stringify([
  ["er", null, null, null, null, 400, null, null, null, 3],
  ["di", 27],
]);

describe("isPayloadlessEnvelope", () => {
  it("accepts a response carrying a payload", () => {
    expect(isPayloadlessEnvelope(realResponse)).toBe(false);
  });

  it("flags the throttle envelope", () => {
    expect(isPayloadlessEnvelope(throttleResponse)).toBe(true);
  });

  it("flags the HTTP 400 error envelope", () => {
    expect(isPayloadlessEnvelope(errorResponse)).toBe(true);
  });

  it("flags an empty body", () => {
    expect(isPayloadlessEnvelope("")).toBe(true);
    expect(isPayloadlessEnvelope(")]}'")).toBe(true);
    expect(isPayloadlessEnvelope(")]}'\n\n")).toBe(true);
  });

  it("does not flag unparseable bodies, which would mask a real format change", () => {
    expect(isPayloadlessEnvelope(")]}'\nnot json at all")).toBe(false);
  });

  it("does not flag a payload-bearing entry that appears after other entries", () => {
    const reordered = ")]}'\n" + JSON.stringify([
      ["di", 120],
      ["wrb.fr", "FlightsFrontendService", "[]"],
    ]);
    expect(isPayloadlessEnvelope(reordered)).toBe(false);
  });

  it("flags a wrb.fr entry whose payload slot is not a string", () => {
    const noPayload = ")]}'\n" + JSON.stringify([["wrb.fr", "svc", null]]);
    expect(isPayloadlessEnvelope(noPayload)).toBe(true);
  });

  it("does not flag a non-array top level", () => {
    expect(isPayloadlessEnvelope(')]}\'\n{"a":1}')).toBe(false);
  });
});
