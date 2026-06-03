import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { fusionWorkflow } from "./workflow.js";
import type { FusionResult } from "../core/run-fusion.js";

// ESM resolution note: this project is `"type": "module"`, so `require` /
// `require.resolve` are not defined. We resolve `workflowsPath` from
// `import.meta.url` instead. There is no build step in tests, so we point at the
// `.ts` source module (Temporal bundles workflows from source via its bundler);
// the non-existent compiled `.js` would not resolve. We use `fileURLToPath`
// (NOT `URL.pathname`) so a path containing spaces (e.g. ".../my projects/...")
// is decoded — `.pathname` leaves it percent-encoded ("my%20projects") and the
// bundler's `statSync` then fails with ENOENT. See vitest.config.ts
// (`pool: "forks"`) for the accompanying config the fallback requires.
describe("fusionWorkflow", () => {
  // Generous timeout: the time-skipping env downloads/launches a test server
  // binary and bundles the workflow on first run.
  it("returns the activity's merged outcome", { timeout: 120_000 }, async () => {
    const env = await TestWorkflowEnvironment.createTimeSkipping();
    try {
      const worker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: "test",
        workflowsPath: fileURLToPath(new URL("./workflow.ts", import.meta.url)),
        activities: {
          runFusionActivity: async (): Promise<FusionResult> => ({
            outcome: "merged", prNumber: 7, prUrl: "u", commitSha: "sha1",
          }),
        },
      });

      const result = await worker.runUntil(
        env.client.workflow.execute(fusionWorkflow, {
          taskQueue: "test",
          workflowId: "wf-test-1",
          args: [{
            owner: "o", repo: "r", repoUrl: "https://github.com/o/r.git",
            baseBranch: "main", intent: "x", branch: "feature/x",
            githubToken: "tok", sandboxUrl: "http://runner:8090",
            pollMs: 0, maxPolls: 3,
          }],
        }),
      );
      expect(result.outcome).toBe("merged");
    } finally {
      await env.teardown();
    }
  });
});
