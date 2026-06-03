import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/e2e/**"],
    // Temporal's testing/worker bundling + the ESM `import.meta.url`
    // `workflowsPath` resolution need a real Node process; the default threads
    // pool breaks `require`/native-module assumptions. Use forks.
    pool: "forks",
  },
});
