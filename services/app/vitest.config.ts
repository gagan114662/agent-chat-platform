import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/e2e/**"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
