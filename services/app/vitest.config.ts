import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/e2e/**"],
    env: { ACP_ALLOW_DEV_HEADERS: "1" },
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
