import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { runs, tasks, threads, repos } from "../db/schema.js";
import { createMessage } from "../chat/messages.js";
import { transitionRun } from "../tasks/tasks.js";
import type { GitHubService } from "@acp/orchestrator/github/github-service.js";

export interface ApprovalInput { orgId: string; runId: string; }

// Loads a held_for_human run (org-scoped) together with its task→thread→repo so we
// can resolve owner/repo + token env var. Throws if the run is missing, belongs to
// another org, or is not in the held_for_human state — the only state a human can act on.
async function loadHeldRunWithRepo(db: DB, { orgId, runId }: ApprovalInput) {
  const [run] = await db.select().from(runs)
    .where(and(eq(runs.id, runId), eq(runs.orgId, orgId), eq(runs.state, "held_for_human")));
  if (!run) throw new Error(`held run not found: ${runId}`);

  const [task] = await db.select().from(tasks).where(and(eq(tasks.id, run.taskId), eq(tasks.orgId, orgId)));
  if (!task) throw new Error(`task not found for run: ${runId}`);

  const [thread] = await db.select().from(threads).where(and(eq(threads.id, task.threadId), eq(threads.orgId, orgId)));
  if (!thread?.repoId) throw new Error(`thread/repo not found for run: ${runId}`);

  const [repo] = await db.select().from(repos).where(and(eq(repos.id, thread.repoId), eq(repos.orgId, orgId)));
  if (!repo) throw new Error(`repo not found for run: ${runId}`);

  return { run, task, thread, repo };
}

// Approve a held_for_human run: merge its PR via the injected GitHub client, transition
// run→merged (which flips the task→done), and post a confirmation pr_card into the thread.
// The GitHub client is injected (Pick<GitHubService,"merge">) so callers/tests control it.
export async function approveRun(db: DB, github: Pick<GitHubService, "merge">, input: ApprovalInput) {
  const { run, task, thread, repo } = await loadHeldRunWithRepo(db, input);
  if (run.prNumber == null) throw new Error(`run has no PR to merge: ${input.runId}`);

  await github.merge(repo.githubOwner, repo.githubName, run.prNumber);
  const updated = await transitionRun(db, run.id, "merged", {}, input.orgId);

  await createMessage(db, {
    orgId: input.orgId, threadId: thread.id, authorKind: "agent", authorId: task.assigneeId ?? "agent",
    kind: "pr_card",
    body: `✅ approved & merged PR #${run.prNumber}`,
    metadata: { outcome: "merged", prNumber: run.prNumber, prUrl: run.prUrl, runId: run.id, approved: true },
  });
  return updated;
}

// Decline a held_for_human run: record the rejection with a system message. The run stays
// held_for_human (terminal) and the task stays blocked — no transition.
export async function declineRun(db: DB, input: ApprovalInput) {
  const { run, task, thread } = await loadHeldRunWithRepo(db, input);
  await createMessage(db, {
    orgId: input.orgId, threadId: thread.id, authorKind: "agent", authorId: task.assigneeId ?? "agent",
    kind: "system",
    body: `🚫 declined PR #${run.prNumber} — left for revision`,
    metadata: { outcome: "declined", prNumber: run.prNumber, runId: run.id },
  });
}
