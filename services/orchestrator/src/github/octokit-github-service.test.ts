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

  it("finds an existing open PR for a branch", async () => {
    nock(api)
      .get("/repos/o/r/pulls")
      .query({ head: "o:feature/x", state: "open" })
      .reply(200, [{ number: 7, html_url: "https://github.com/o/r/pull/7" }]);
    const svc = new OctokitGitHubService("tok");
    const pr = await svc.findPrForBranch("o", "r", "feature/x");
    expect(pr).toEqual({ number: 7, url: "https://github.com/o/r/pull/7" });
  });

  it("returns null when no open PR exists for a branch", async () => {
    nock(api)
      .get("/repos/o/r/pulls")
      .query({ head: "o:feature/x", state: "open" })
      .reply(200, []);
    const svc = new OctokitGitHubService("tok");
    expect(await svc.findPrForBranch("o", "r", "feature/x")).toBeNull();
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

  it("lists all check contexts for a ref (name + state + url)", async () => {
    nock(api).get("/repos/o/r/commits/abc/status").reply(200, {
      state: "failure",
      statuses: [
        { context: "ci/lint", state: "failure", description: "2 errors", target_url: "https://ci/lint" },
        { context: "ci/test", state: "success", description: null, target_url: null },
      ],
    });
    const svc = new OctokitGitHubService("tok");
    const contexts = await svc.getCheckContexts("o", "r", "abc");
    expect(contexts).toEqual([
      { context: "ci/lint", state: "failure", description: "2 errors", targetUrl: "https://ci/lint" },
      { context: "ci/test", state: "success", description: undefined, targetUrl: undefined },
    ]);
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

  it("routes requests at a GitHub Enterprise base URL", async () => {
    const ghe = "https://ghe.example.com/api/v3";
    nock(ghe)
      .post("/repos/o/r/pulls")
      .reply(201, { number: 9, html_url: "https://ghe.example.com/o/r/pull/9" });

    const svc = new OctokitGitHubService("tok", ghe);
    const pr = await svc.openPr({
      owner: "o", repo: "r", head: "feature/x", base: "main",
      title: "t", body: "b",
    });
    expect(pr).toEqual({ number: 9, url: "https://ghe.example.com/o/r/pull/9" });
  });

  it("defaults to github.com when no base URL is given", async () => {
    nock(api)
      .post("/repos/o/r/pulls")
      .reply(201, { number: 11, html_url: "https://github.com/o/r/pull/11" });

    const svc = new OctokitGitHubService("tok");
    const pr = await svc.openPr({
      owner: "o", repo: "r", head: "feature/x", base: "main",
      title: "t", body: "b",
    });
    expect(pr.number).toBe(11);
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

  it("reads a text file's content (base64 decoded to utf8)", async () => {
    const text = "# Hello\n\nworld\n";
    const b64 = Buffer.from(text, "utf8").toString("base64");
    nock(api)
      .get("/repos/o/r/contents/README.md")
      .query({ ref: "sha" })
      .reply(200, { type: "file", encoding: "base64", content: b64, size: text.length });
    const svc = new OctokitGitHubService("tok");
    const file = await svc.getFileContent("o", "r", "sha", "README.md");
    expect(file).toEqual({ content: text, encoding: "utf8", size: text.length });
  });

  it("reads a binary file's content as raw base64", async () => {
    const b64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    nock(api)
      .get("/repos/o/r/contents/logo.png")
      .query({ ref: "sha" })
      .reply(200, { type: "file", encoding: "base64", content: b64, size: 4 });
    const svc = new OctokitGitHubService("tok");
    const file = await svc.getFileContent("o", "r", "sha", "logo.png");
    expect(file).toEqual({ content: b64, encoding: "base64", size: 4 });
  });

  it("rejects files larger than the size cap", async () => {
    nock(api)
      .get("/repos/o/r/contents/big.txt")
      .query({ ref: "sha" })
      .reply(200, { type: "file", encoding: "base64", content: "", size: 2 * 1024 * 1024 });
    const svc = new OctokitGitHubService("tok");
    await expect(svc.getFileContent("o", "r", "sha", "big.txt")).rejects.toThrow(/too large/i);
  });

  it("rejects a path that is not a file (e.g. a directory)", async () => {
    nock(api)
      .get("/repos/o/r/contents/src")
      .query({ ref: "sha" })
      .reply(200, [{ type: "file", name: "a.ts" }]);
    const svc = new OctokitGitHubService("tok");
    await expect(svc.getFileContent("o", "r", "sha", "src")).rejects.toThrow(/not a file/i);
  });

  it("lists issues and filters out pull requests", async () => {
    nock(api)
      .get("/repos/o/r/issues")
      .query(true)
      .reply(200, [
        { number: 1, title: "Bug", body: "broken", state: "open", html_url: "https://github.com/o/r/issues/1" },
        { number: 2, title: "A PR", body: "code", state: "open", html_url: "https://github.com/o/r/pull/2", pull_request: { url: "x" } },
        { number: 3, title: "Feature", body: null, state: "open", html_url: "https://github.com/o/r/issues/3" },
      ]);
    const svc = new OctokitGitHubService("tok");
    const issues = await svc.listIssues("o", "r");
    expect(issues).toEqual([
      { number: 1, title: "Bug", body: "broken", state: "open", htmlUrl: "https://github.com/o/r/issues/1" },
      { number: 3, title: "Feature", body: undefined, state: "open", htmlUrl: "https://github.com/o/r/issues/3" },
    ]);
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
