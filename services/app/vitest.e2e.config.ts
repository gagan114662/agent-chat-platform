import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/e2e/**/*.e2e.test.ts"], pool: "forks", testTimeout: 240_000, hookTimeout: 240_000 },
});
