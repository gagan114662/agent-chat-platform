import type { RunResult, SandboxRunRequest, SandboxFeedbackRequest } from "../types.js";
import { nodeFetch } from "../http/node-fetch.js";

export interface SandboxRunner {
  run(req: SandboxRunRequest): Promise<RunResult>;
  // Re-run the agent on an existing branch to address feedback (e.g. failing CI),
  // committing + pushing to the same branch. Backs the fix-on-red loop.
  feedback(req: SandboxFeedbackRequest): Promise<RunResult>;
}

export class SandboxRunnerClient implements SandboxRunner {
  constructor(private readonly baseUrl: string) {}

  // DEVIATION FROM SPEC: The spec body used undici's `request`. As warned in the
  // task note (and confirmed by a failing test that did real DNS lookups —
  // `getaddrinfo ENOTFOUND runner`), `nock` cannot intercept undici's transport.
  // We reuse the same nock-interceptable `nodeFetch` shim (node:http/https based)
  // already used for the GitHub service. The public API is unchanged:
  // `new SandboxRunnerClient(baseUrl)` and `.run(req): Promise<RunResult>`, with
  // the same throw-on-non-200 behavior.
  async run(req: SandboxRunRequest): Promise<RunResult> {
    const url = `${this.baseUrl}/run`;
    const res = await nodeFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (res.status !== 200) {
      const text = await res.text();
      throw new Error(`sandbox-runner ${res.status}: ${text}`);
    }
    try {
      return (await res.json()) as RunResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`sandbox-runner ${url}: invalid JSON response: ${message}`);
    }
  }

  async feedback(req: SandboxFeedbackRequest): Promise<RunResult> {
    const url = `${this.baseUrl}/feedback`;
    const res = await nodeFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (res.status !== 200) {
      const text = await res.text();
      throw new Error(`sandbox-runner ${res.status}: ${text}`);
    }
    try {
      return (await res.json()) as RunResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`sandbox-runner ${url}: invalid JSON response: ${message}`);
    }
  }
}
