import { describe, it, expect, afterEach } from "vitest";
import nock from "nock";
import { OctokitGitHubService } from "./octokit-github-service.js";

const api = "https://api.github.com";

afterEach(() => nock.cleanAll());

describe("OctokitGitHubService", () => {
  it("opens a PR", async () => {
    nock(api)
      .post("/repos/o/r/pulls")
      .reply(201, { number: 7, html_url: "https://github.com/o/r/pull/7" });

    const svc = new OctokitGitHubService("tok");
    const pr = await svc.openPr({
      owner: "o", repo: "r", head: "feature/x", base: "main",
      title: "t", body: "b",
    });
    expect(pr).toEqual({ number: 7, url: "https://github.com/o/r/pull/7" });
  });

  it("maps combined status to ChecksStatus", async () => {
    nock(api).get("/repos/o/r/commits/abc/status").reply(200, { state: "success" });
    const svc = new OctokitGitHubService("tok");
    expect(await svc.getChecksStatus("o", "r", "abc")).toBe("success");
  });

  it("merges a PR", async () => {
    nock(api).put("/repos/o/r/pulls/7/merge").reply(200, { merged: true });
    const svc = new OctokitGitHubService("tok");
    await expect(svc.merge("o", "r", 7)).resolves.toBeUndefined();
  });

  it("rejects when GitHub reports the merge did not happen", async () => {
    nock(api)
      .put("/repos/o/r/pulls/7/merge")
      .reply(200, { merged: false, message: "Pull Request is not mergeable" });
    const svc = new OctokitGitHubService("tok");
    await expect(svc.merge("o", "r", 7)).rejects.toThrow(/not mergeable/);
  });

  it("summarizes failing check contexts", async () => {
    nock(api).get("/repos/o/r/commits/abc/status").reply(200, {
      state: "failure",
      statuses: [
        { context: "ci/lint", state: "failure" },
        { context: "ci/test", state: "success" },
        { context: "ci/build", state: "error" },
      ],
    });
    const svc = new OctokitGitHubService("tok");
    const ctx = await svc.getCheckFailureContext("o", "r", "abc");
    expect(ctx).toContain("ci/lint");
    expect(ctx).toContain("ci/build");
    expect(ctx).not.toContain("ci/test");
  });

  it("lists review comments for a PR", async () => {
    nock(api).get("/repos/o/r/pulls/7/comments").reply(200, [
      { id: 101, body: "fix this", user: { login: "alice" }, path: "src/a.ts", line: 12 },
      { id: 102, body: "nit", user: { login: "bob" }, path: "src/b.ts", line: null },
    ]);
    const svc = new OctokitGitHubService("tok");
    const comments = await svc.listReviewComments("o", "r", 7);
    expect(comments).toEqual([
      { id: 101, body: "fix this", user: "alice", path: "src/a.ts", line: 12 },
      { id: 102, body: "nit", user: "bob", path: "src/b.ts", line: undefined },
    ]);
  });

  it("updates a PR with only the provided fields", async () => {
    let sentBody: unknown;
    nock(api)
      .patch("/repos/o/r/pulls/7", (body) => { sentBody = body; return true; })
      .reply(200, { number: 7 });
    const svc = new OctokitGitHubService("tok");
    await expect(svc.updatePr("o", "r", 7, { title: "x" })).resolves.toBeUndefined();
    expect(sentBody).toEqual({ title: "x" });
  });

  it("lists changed files for a PR", async () => {
    const patch = "@@ -1,2 +1,3 @@\n context\n-removed\n+added\n+added2";
    nock(api).get("/repos/o/r/pulls/7/files").reply(200, [
      { filename: "src/a.ts", additions: 3, deletions: 1, status: "modified", patch },
      { filename: "README.md", additions: 1, deletions: 0, status: "added" },
    ]);
    const svc = new OctokitGitHubService("tok");
    const files = await svc.getChangedFiles("o", "r", 7);
    expect(files.map((f) => f.filename)).toEqual(["src/a.ts", "README.md"]);
    expect(files[0]).toMatchObject({ additions: 3, deletions: 1, status: "modified", patch });
  });
});
