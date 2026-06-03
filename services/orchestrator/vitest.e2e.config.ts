import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/e2e/**/*.e2e.test.ts"],
    // Must exceed the test's worst-case poll budget so the "timeout" outcome is
    // reachable cleanly instead of the harness killing the test: the fusion loop
    // sleeps (maxPolls-1)*pollMs (23*5s = 115s) plus sandbox-run + openPr + up to
    // 24 check polls + merge network round-trips. 180s leaves margin.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
