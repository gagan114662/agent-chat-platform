import { describe, it, expect, afterEach } from "vitest";
import nock from "nock";
import { SandboxRunnerClient } from "./sandbox-runner-client.js";

afterEach(() => nock.cleanAll());

describe("SandboxRunnerClient", () => {
  it("posts /run and returns RunResult", async () => {
    nock("http://runner:8090")
      .post("/run")
      .reply(200, { branch: "feature/x", commitSha: "deadbeef" });

    const client = new SandboxRunnerClient("http://runner:8090");
    const res = await client.run({
      repoUrl: "https://github.com/o/r.git",
      baseBranch: "main",
      intent: "do it",
      branch: "feature/x",
    });
    expect(res).toEqual({ branch: "feature/x", commitSha: "deadbeef" });
  });

  it("posts /feedback and returns RunResult", async () => {
    nock("http://runner:8090")
      .post("/feedback", { repoUrl: "https://github.com/o/r.git", branch: "feature/x", notes: "ci: lint failed" })
      .reply(200, { branch: "feature/x", commitSha: "fixsha" });

    const client = new SandboxRunnerClient("http://runner:8090");
    const res = await client.feedback({
      repoUrl: "https://github.com/o/r.git",
      branch: "feature/x",
      notes: "ci: lint failed",
    });
    expect(res).toEqual({ branch: "feature/x", commitSha: "fixsha" });
  });

  it("rejects with status and body on a non-200 response", async () => {
    nock("http://runner:8090").post("/run").reply(500, "boom");

    const client = new SandboxRunnerClient("http://runner:8090");
    await expect(
      client.run({
        repoUrl: "https://github.com/o/r.git",
        baseBranch: "main",
        intent: "do it",
        branch: "feature/x",
      }),
    ).rejects.toThrow(/sandbox-runner 500.*boom/);
  });

  it("rejects with a debuggable error when the 200 body is not JSON", async () => {
    nock("http://runner:8090").post("/run").reply(200, "not json");

    const client = new SandboxRunnerClient("http://runner:8090");
    await expect(
      client.run({
        repoUrl: "https://github.com/o/r.git",
        baseBranch: "main",
        intent: "do it",
        branch: "feature/x",
      }),
    ).rejects.toThrow(/invalid JSON response/);
  });
});
