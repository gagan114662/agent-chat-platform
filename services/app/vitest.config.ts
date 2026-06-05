import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/e2e/**"],
    env: { ACP_ALLOW_DEV_HEADERS: "1" },
    // Vitest 4 removed `poolOptions`; `fileParallelism: false` + one worker keeps
    // the DB-backed suites serial (single fork) so they don't race on shared state.
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 30_000,
  },
});
