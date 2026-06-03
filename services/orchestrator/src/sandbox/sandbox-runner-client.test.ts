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
});
