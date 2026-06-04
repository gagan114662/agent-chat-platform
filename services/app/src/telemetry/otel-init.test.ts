import { describe, it, expect, afterEach } from "vitest";
import { buildTelemetrySDK } from "./otel-init.js";

afterEach(() => { delete process.env.HONEYCOMB_API_KEY; });

describe("otel-init", () => {
  it("returns undefined when no Honeycomb key is set", () => {
    delete process.env.HONEYCOMB_API_KEY;
    expect(buildTelemetrySDK()).toBeUndefined();
  });
  it("builds an SDK when the key is set (no start, no network)", () => {
    process.env.HONEYCOMB_API_KEY = "dummy";
    const sdk = buildTelemetrySDK();
    expect(sdk).toBeDefined();
  });
});
