import { describe, it, expect } from "vitest";
import { extractPayload } from "../src/google/page.js";

const page = (blobs: string[]) =>
  `<html><script>${blobs.map((b) => `AF_initDataCallback(${b});`).join("</script><script>")}</script></html>`;

describe("extractPayload", () => {
  it("returns the ds:1 data, skipping other blocks", () => {
    const html = page([
      `{key: 'ds:0', hash: '1', data:[1,2], sideChannel: {}}`,
      `{key: 'ds:1', hash: '2', data:[null,null,[[["flight"]]],null], sideChannel: {}}`,
    ]);
    expect(extractPayload(html)).toEqual([null, null, [[["flight"]]], null]);
  });

  it("returns null when the page has no ds:1 block", () => {
    expect(extractPayload(page([`{key: 'ds:0', hash: '1', data:[1], sideChannel: {}}`]))).toBeNull();
    expect(extractPayload("<html></html>")).toBeNull();
  });

  it("returns null when ds:1 is not valid JSON", () => {
    expect(extractPayload(page([`{key: 'ds:1', hash: '2', data:[1,, sideChannel: {}}`]))).toBeNull();
  });
});
