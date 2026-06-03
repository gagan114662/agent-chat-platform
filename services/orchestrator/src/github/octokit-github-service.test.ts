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
});
