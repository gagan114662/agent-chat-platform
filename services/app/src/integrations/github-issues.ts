import type { DB } from "../db/client.js";
import { tasks } from "../db/schema.js";
import type { GitHubService } from "@acp/orchestrator/github/github-service.js";

export interface ImportGitHubInput {
  orgId: string;
  threadId: string;
  owner: string;
  repo: string;
  // Only listIssues is needed here; a Pick keeps the seam minimal so tests can
  // pass a tiny fake (and PRs are already filtered inside listIssues).
  github: Pick<GitHubService, "listIssues">;
}

// Pulls a repo's GitHub issues into org-scoped Tasks on the given thread. The
// task id is deterministic per source issue (`gh:${owner}/${repo}#${number}`)
// and the insert uses onConflictDoNothing, so re-importing creates 0 new Tasks
// (idempotent). Returns the ids of the Tasks actually created on this call.
export async function importGitHubIssues(db: DB, i: ImportGitHubInput): Promise<string[]> {
  const issues = await i.github.listIssues(i.owner, i.repo);
  const created: string[] = [];
  for (const issue of issues) {
    const id = `gh:${i.owner}/${i.repo}#${issue.number}`;
    const [row] = await db
      .insert(tasks)
      .values({
        id,
        orgId: i.orgId,
        threadId: i.threadId,
        title: `#${issue.number} ${issue.title}`,
        state: "open",
        createdByKind: "integration",
        createdById: "github",
      })
      .onConflictDoNothing()
      .returning();
    if (row) created.push(row.id);
  }
  return created;
}
