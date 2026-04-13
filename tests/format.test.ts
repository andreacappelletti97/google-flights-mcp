import { describe, it, expect } from "vitest";
import { formatPrice } from "../src/lib/format.js";

describe("formatPrice", () => {
  it("formats USD with dollar sign", () => {
    expect(formatPrice(499, "USD")).toBe("$499");
  });

  it("formats null currency with dollar sign", () => {
    expect(formatPrice(199, null)).toBe("$199");
  });

  it("formats non-USD with currency suffix", () => {
    expect(formatPrice(850, "EUR")).toBe("850 EUR");
  });

  it("formats JPY correctly", () => {
    expect(formatPrice(95000, "JPY")).toBe("95000 JPY");
  });
});
