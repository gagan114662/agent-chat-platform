import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { trace } from "@opentelemetry/api";
import { runFusionTraced } from "./traced-fusion.js";
import type { SandboxRunner } from "../sandbox/sandbox-runner-client.js";
import type { GitHubService } from "../github/github-service.js";
import type { ChecksStatus } from "../types.js";

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.setGlobalTracerProvider(provider);
});
afterAll(() => { trace.disable(); });

function deps(checks: ChecksStatus[]) {
  const sandbox: SandboxRunner = {
    run: vi.fn().mockResolvedValue({ branch: "feature/x", commitSha: "sha1" }),
    feedback: vi.fn().mockResolvedValue({ branch: "feature/x", commitSha: "fixsha" }),
    plan: vi.fn().mockResolvedValue({ plan: "PLAN" }),
  };
  let i = 0;
  const github: GitHubService = {
    openPr: vi.fn().mockResolvedValue({ number: 7, url: "u" }),
    getChecksStatus: vi.fn().mockImplementation(async () => checks[Math.min(i++, checks.length - 1)]),
    merge: vi.fn().mockResolvedValue(undefined),
    getChangedFiles: vi.fn().mockResolvedValue([]),
    getFileContent: vi.fn().mockResolvedValue({ content: "", encoding: "utf8", size: 0 }),
    getCheckFailureContext: vi.fn().mockResolvedValue("ci: lint failed"),
    listReviewComments: vi.fn().mockResolvedValue([]),
    updatePr: vi.fn().mockResolvedValue(undefined),
  };
  return { sandbox, github };
}
const input = { owner: "o", repo: "r", repoUrl: "https://github.com/o/r.git", baseBranch: "main", intent: "do it", branch: "feature/x" };

describe("runFusionTraced", () => {
  it("emits a fusion.run span with the outcome attribute and step events", async () => {
    exporter.reset();
    const out = await runFusionTraced(deps(["success"]), input, { pollMs: 0, maxPolls: 3 });
    expect(out.outcome).toBe("merged");
    const spans = exporter.getFinishedSpans();
    const run = spans.find((s) => s.name === "fusion.run");
    expect(run).toBeTruthy();
    expect(run!.attributes["acp.outcome"]).toBe("merged");
    expect(run!.attributes["acp.pr_number"]).toBe(7);
    const eventNames = run!.events.map((e) => e.name);
    expect(eventNames).toContain("sandbox_started");
    expect(eventNames).toContain("outcome");
  });

  it("forwards a caller onEvent and still records span events", async () => {
    exporter.reset();
    const seen: string[] = [];
    await runFusionTraced(deps(["success"]), input, { pollMs: 0, maxPolls: 3, onEvent: (e) => { seen.push(e.type); } });
    expect(seen).toContain("pr_opened");
  });
});
