import { SpanStatusCode } from "@opentelemetry/api";
import { getTracer } from "./tracer.js";
import { runFusion, type FusionDeps, type FusionInput, type FusionOptions, type FusionResult } from "../core/run-fusion.js";

// Additive tracing wrapper around runFusion: one `fusion.run` span carrying
// step events + outcome/PR attributes. No-op when no provider is registered.
export async function runFusionTraced(
  deps: FusionDeps,
  input: FusionInput,
  opts: FusionOptions,
): Promise<FusionResult> {
  const tracer = getTracer();
  return tracer.startActiveSpan("fusion.run", async (span) => {
    span.setAttribute("acp.intent", input.intent);
    span.setAttribute("acp.branch", input.branch);
    span.setAttribute("acp.repo", `${input.owner}/${input.repo}`);
    const userOnEvent = opts.onEvent;
    try {
      const res = await runFusion(deps, input, {
        ...opts,
        onEvent: async (e) => {
          span.addEvent(e.type);
          if (userOnEvent) await userOnEvent(e);
        },
      });
      span.setAttribute("acp.outcome", res.outcome);
      if (res.prNumber !== undefined) span.setAttribute("acp.pr_number", res.prNumber);
      if (res.commitSha !== undefined) span.setAttribute("acp.commit_sha", res.commitSha);
      if (res.outcome !== "merged") {
        span.setStatus({ code: SpanStatusCode.ERROR, message: res.outcome });
      }
      return res;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}
