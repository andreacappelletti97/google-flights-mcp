import { describe, it, expect } from "vitest";
import { formatPrice } from "../src/lib/format.js";

describe("formatPrice", () => {
  it("formats USD with dollar sign", () => {
    expect(formatPrice(499, "USD")).toBe("$499");
  });

  it("formats null currency with dollar sign", () => {
    expect(formatPrice(199, null)).toBe("$199");
  });

  it("formats EUR with the euro sign", () => {
    expect(formatPrice(850, "EUR")).toBe("\u20AC850");
  });

  it("formats JPY with the yen sign", () => {
    expect(formatPrice(95000, "JPY")).toBe("\u00A595000");
  });

  it("falls back to trailing code for unknown currencies", () => {
    expect(formatPrice(100, "CHF")).toBe("100 CHF");
  });
});
