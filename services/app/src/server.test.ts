import { describe, it, expect } from "vitest";
import { loggerOptions } from "./server.js";

describe("loggerOptions pino redaction (VF-07)", () => {
  it("redacts auth/token fields in logs", () => {
    expect(loggerOptions.redact.paths).toContain("req.headers.authorization");
    expect(loggerOptions.redact.paths).toContain("req.query.token");
    expect(loggerOptions.redact.censor).toBe("[redacted]");
  });
});
