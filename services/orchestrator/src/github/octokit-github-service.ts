import { Octokit } from "@octokit/rest";
import * as https from "node:https";
import * as http from "node:http";
import type { GitHubService, OpenPrInput } from "./github-service.js";
import type { ChecksStatus, PullRequest } from "../types.js";

/**
 * A minimal fetch implementation built on Node's https/http modules so that
 * nock (which patches those modules) can intercept requests in tests.
 * Octokit v21 accepts a custom fetch via `request.fetch`.
 */
function nodeFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const u = typeof url === "string" ? new URL(url) : url;
    const transport = u.protocol === "https:" ? https : http;
    const options: https.RequestOptions = {
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method: (init?.method ?? "GET").toUpperCase(),
      headers: init?.headers as Record<string, string> | undefined,
    };

    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        const status = res.statusCode ?? 200;
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined) {
            const vals = Array.isArray(v) ? v : [v];
            for (const val of vals) headers.append(k, val);
          }
        }
        resolve(
          new Response(body, {
            status,
            statusText: res.statusMessage ?? "",
            headers,
          })
        );
      });
      res.on("error", reject);
    });

    req.on("error", reject);

    if (init?.body) {
      if (typeof init.body === "string") {
        req.write(init.body);
      } else if (init.body instanceof Uint8Array) {
        req.write(init.body);
      }
    }

    req.end();
  });
}

export class OctokitGitHubService implements GitHubService {
  private readonly octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({
      auth: token,
      request: { fetch: nodeFetch as typeof globalThis.fetch },
    });
  }

  async openPr(input: OpenPrInput): Promise<PullRequest> {
    const res = await this.octokit.pulls.create({
      owner: input.owner,
      repo: input.repo,
      head: input.head,
      base: input.base,
      title: input.title,
      body: input.body,
    });
    return { number: res.data.number, url: res.data.html_url };
  }

  async getChecksStatus(owner: string, repo: string, ref: string): Promise<ChecksStatus> {
    const res = await this.octokit.repos.getCombinedStatusForRef({ owner, repo, ref });
    const state = res.data.state; // "success" | "pending" | "failure" | "error"
    if (state === "success") return "success";
    if (state === "failure" || state === "error") return "failure";
    return "pending";
  }

  async merge(owner: string, repo: string, prNumber: number): Promise<void> {
    await this.octokit.pulls.merge({ owner, repo, pull_number: prNumber });
  }
}
