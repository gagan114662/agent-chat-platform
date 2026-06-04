import { describe, it, expect } from "vitest";
import { getTracer, TRACER_NAME } from "./tracer.js";

describe("tracer", () => {
  it("returns a tracer that can start/end a span without a provider", () => {
    expect(TRACER_NAME).toBe("acp-orchestrator");
    const span = getTracer().startSpan("t");
    expect(() => span.end()).not.toThrow();
  });
});
