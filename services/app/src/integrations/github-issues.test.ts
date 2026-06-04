import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { importGitHubIssues } from "./github-issues.js";
import type { GitHubIssue } from "@acp/orchestrator/github/github-service.js";
import { orgs, workspaces, channels, threads, tasks } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

// Two real issues — the fake listIssues already filters PRs (mirrors the Octokit
// impl), so this returns only issues.
const ISSUES: GitHubIssue[] = [
  { number: 1, title: "Bug", body: "broken", state: "open", htmlUrl: "https://github.com/o/r/issues/1" },
  { number: 3, title: "Feature", state: "open", htmlUrl: "https://github.com/o/r/issues/3" },
];

function fakeGitHub(issues: GitHubIssue[]) {
  return { listIssues: async () => issues };
}

async function seed() {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }]);
  await h.db.insert(workspaces).values({ id: "wA", orgId: "oA", name: "W" });
  await h.db.insert(channels).values({ id: "cA", orgId: "oA", workspaceId: "wA", name: "g" });
  await h.db.insert(threads).values({ id: "tA", orgId: "oA", channelId: "cA", title: "T" });
}

describe("importGitHubIssues", () => {
  beforeEach(seed);

  it("creates one org-scoped Task per issue with '#N title' titles", async () => {
    const ids = await importGitHubIssues(h.db, {
      orgId: "oA", threadId: "tA", owner: "acme", repo: "widgets", github: fakeGitHub(ISSUES),
    });
    expect(ids).toEqual(["gh:acme/widgets#1", "gh:acme/widgets#3"]);
    const rows = await h.db.select().from(tasks).where(eq(tasks.orgId, "oA"));
    expect(rows).toHaveLength(2);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId["gh:acme/widgets#1"]).toMatchObject({
      orgId: "oA", threadId: "tA", title: "#1 Bug",
      state: "open", createdByKind: "integration", createdById: "github",
    });
    expect(byId["gh:acme/widgets#3"].title).toBe("#3 Feature");
  });

  it("is idempotent: re-import creates 0 new Tasks", async () => {
    const first = await importGitHubIssues(h.db, {
      orgId: "oA", threadId: "tA", owner: "acme", repo: "widgets", github: fakeGitHub(ISSUES),
    });
    expect(first).toHaveLength(2);
    const second = await importGitHubIssues(h.db, {
      orgId: "oA", threadId: "tA", owner: "acme", repo: "widgets", github: fakeGitHub(ISSUES),
    });
    expect(second).toEqual([]);
    const rows = await h.db.select().from(tasks).where(eq(tasks.orgId, "oA"));
    expect(rows).toHaveLength(2);
  });
});
