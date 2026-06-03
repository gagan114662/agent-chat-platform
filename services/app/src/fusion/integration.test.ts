import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import { testDb, closeDb } from "../db/test-harness.js";
import { makeFusionSink } from "./events.js";
import { openTaskForMention } from "../tasks/tasks.js";
import { listMessages } from "../chat/messages.js";
import { chatFusionWorkflow } from "./workflows.js";
import { orgs, workspaces, channels, threads, agents } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "g" });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T", repoId: "r1" });
  await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "C", adapter: "fake", config: {} });
});

describe("chat fusion integration", () => {
  it("drives the loop end to end with a stubbed activity", async () => {
    const { run } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "fix bug", agentId: "a1", createdByKind: "human", createdById: "m1",
    });

    const env = await TestWorkflowEnvironment.createTimeSkipping();
    try {
      const worker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: "test",
        workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
        activities: {
          runChatFusionActivity: async (input: any) => {
            const sink = makeFusionSink(h.db, h.sql, input.sink);
            await sink({ type: "sandbox_started" });
            await sink({ type: "branch_pushed", branch: "agent/x", commitSha: "deadbeef" });
            await sink({ type: "pr_opened", prNumber: 7, prUrl: "https://gh/pr/7" });
            await sink({ type: "checks", status: "pending" });
            await sink({ type: "checks", status: "success" });
            await sink({ type: "outcome", outcome: "merged", prNumber: 7, prUrl: "https://gh/pr/7", commitSha: "deadbeef" });
            return { outcome: "merged", prNumber: 7, prUrl: "https://gh/pr/7", commitSha: "deadbeef" };
          },
        },
      });

      const result = await worker.runUntil(
        env.client.workflow.execute(chatFusionWorkflow, {
          taskQueue: "test", workflowId: run.workflowId,
          args: [{
            owner: "o", repo: "r", repoUrl: "x", baseBranch: "main", intent: "fix bug",
            branch: "agent/x", githubToken: "tok", sandboxUrl: "http://runner:8090",
            pollMs: 0, maxPolls: 3, sink: { orgId: "o1", threadId: "t1", runId: run.id, agentId: "a1" },
          }],
        }),
      );
      expect(result.outcome).toBe("merged");

      const msgs = await listMessages(h.db, "t1");
      expect(msgs.at(-1)?.kind).toBe("pr_card");
      expect(msgs.some((m) => m.kind === "system")).toBe(true);
    } finally {
      await env.teardown();
    }
  }, 120_000);
});
