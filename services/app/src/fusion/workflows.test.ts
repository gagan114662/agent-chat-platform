import { describe, it, expect } from "vitest";
import { fusionActivityOptions } from "./workflows.js";

// The live Temporal test harness (integration.test.ts) needs a network download
// of the ephemeral server, so we assert the exported retry config directly (#70).
describe("fusion workflow activity options", () => {
  it("retries transient failures up to 3 attempts with backoff (#70)", () => {
    expect(fusionActivityOptions.retry?.maximumAttempts).toBe(3);
    expect(fusionActivityOptions.retry?.backoffCoefficient).toBeGreaterThan(1);
    expect(fusionActivityOptions.retry?.initialInterval).toBeTruthy();
  });

  it("keeps a generous start-to-close timeout", () => {
    expect(fusionActivityOptions.startToCloseTimeout).toBe("15 minutes");
  });
});
