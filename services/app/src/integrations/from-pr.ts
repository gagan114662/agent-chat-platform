import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { tasks } from "../db/schema.js";
import { createMessage } from "../chat/messages.js";
import { createThread } from "../nav/nav.js";
import type { GitHubService } from "@acp/orchestrator/github/github-service.js";

// Only the two read seams (#17 changed files + #19 review comments) are needed
// here. A Pick keeps the injectable surface minimal so tests pass a tiny fake
// (no live GitHub); production passes the full OctokitGitHubService.
export type FromPrGitHub = Pick<GitHubService, "getChangedFiles" | "listReviewComments">;

export interface StartFromPrInput {
  orgId: string;
  channelId: string;
  repoId: string;
  owner: string;
  repo: string;
  prNumber: number;
  github: FromPrGitHub;
}

export interface StartFromPrResult {
  threadId: string;
  taskId: string;
}

// #78 Checkout PRs: open a thread + task seeded from an existing GitHub PR — the
// reverse of agent→PR. Idempotent: the task id is deterministic
// (`from-pr:${owner}/${repo}#${n}`) and the seeded messages use deterministic ids
// so a re-run creates no duplicate task/messages. The thread is reused on re-run
// (looked up via the existing task's threadId) so a re-import lands in the same
// place. Org-scoped: the caller resolves the repo org-scoped and passes repoId.
export async function startFromPr(db: DB, i: StartFromPrInput): Promise<StartFromPrResult> {
  const taskId = `from-pr:${i.owner}/${i.repo}#${i.prNumber}`;

  // Idempotency anchor: if the task already exists, reuse its thread + id and
  // re-run the (deterministic-id) message seeding — no dup task, no dup messages.
  const [existingTask] = await db.select().from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, i.orgId)));

  let threadId: string;
  if (existingTask) {
    threadId = existingTask.threadId;
  } else {
    const thread = await createThread(db, {
      orgId: i.orgId,
      channelId: i.channelId,
      title: `PR #${i.prNumber} ${i.owner}/${i.repo}`,
      repoId: i.repoId,
    });
    threadId = thread.id;
    await db.insert(tasks).values({
      id: taskId,
      orgId: i.orgId,
      threadId,
      title: `PR #${i.prNumber} ${i.owner}/${i.repo}`,
      state: "todo",
      createdByKind: "integration",
      createdById: "github",
    }).onConflictDoNothing();
  }

  // Seed the thread with the PR's changed-file summary + review comments. Both use
  // deterministic message ids + onConflictDoNothing (in createMessage) so a re-run
  // posts no duplicates.
  const files = await i.github.getChangedFiles(i.owner, i.repo, i.prNumber);
  const fileLines = files.map((f) => `${f.status} ${f.filename} (+${f.additions}/-${f.deletions})`);
  const filesBody = fileLines.length
    ? `📦 PR #${i.prNumber} ${i.owner}/${i.repo} — ${files.length} changed file${files.length === 1 ? "" : "s"}:\n${fileLines.join("\n")}`
    : `📦 PR #${i.prNumber} ${i.owner}/${i.repo} — no changed files`;
  await createMessage(db, {
    id: `${taskId}:files`,
    orgId: i.orgId,
    threadId,
    authorKind: "agent",
    authorId: "github",
    kind: "pr_card",
    body: filesBody,
    metadata: { owner: i.owner, repo: i.repo, prNumber: i.prNumber, fileCount: files.length },
  });

  const comments = await i.github.listReviewComments(i.owner, i.repo, i.prNumber);
  for (const c of comments) {
    const loc = c.path ? ` on ${c.path}${c.line ? `:${c.line}` : ""}` : "";
    await createMessage(db, {
      id: `${taskId}:rc:${c.id}`,
      orgId: i.orgId,
      threadId,
      authorKind: "agent",
      authorId: "github",
      kind: "pr_card",
      body: `💬 ${c.user}${loc}: ${c.body}`,
      metadata: { reviewCommentId: c.id, path: c.path, line: c.line },
    });
  }

  return { threadId, taskId };
}
