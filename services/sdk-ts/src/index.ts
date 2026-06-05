// @acp/sdk-ts — a thin, typed TypeScript client for the agent-chat-platform
// public API (#86). Pure `fetch` (Node 20+ / edge / browser); no runtime deps.
//
// Auth: pass a bearer `token` — either a user session token (from POST /auth/login)
// or an `acp_`-prefixed API key (#83). It rides on every request as
// `Authorization: Bearer <token>`.
//
// `fetch` is injectable (`opts.fetch`) so tests can assert URL/method/headers/body
// against a fake without a live server.

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface AcpClientOptions {
  baseUrl: string;
  token: string;
  /** Injectable fetch (defaults to globalThis.fetch). */
  fetch?: FetchLike;
}

export interface BulkTaskItem {
  title: string;
  priority?: "low" | "medium" | "high" | "urgent";
  dueDate?: string | null;
}

export class AcpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "AcpError";
  }
}

export class AcpClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: AcpClientOptions) {
    // Trim a trailing slash so `${baseUrl}${path}` never doubles up.
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.token = opts.token;
    const f = opts.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (!f) throw new Error("No fetch available; pass opts.fetch");
    this.fetchImpl = f;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body: payload });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const msg =
        parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : `request failed: ${res.status}`;
      throw new AcpError(res.status, msg, parsed);
    }
    return parsed as T;
  }

  // ---- chat ----
  listChannels(opts?: { includeArchived?: boolean }): Promise<unknown[]> {
    const q = opts?.includeArchived ? "?includeArchived=1" : "";
    return this.request("GET", `/channels${q}`);
  }

  listMessages(threadId: string, opts?: { before?: string; after?: string; limit?: number }): Promise<unknown[]> {
    const params = new URLSearchParams();
    if (opts?.before) params.set("before", opts.before);
    if (opts?.after) params.set("after", opts.after);
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    const q = params.toString() ? `?${params.toString()}` : "";
    return this.request("GET", `/threads/${encodeURIComponent(threadId)}/messages${q}`);
  }

  postMessage(threadId: string, body: string): Promise<{ message: unknown; startedRuns: string[] }> {
    return this.request("POST", `/threads/${encodeURIComponent(threadId)}/messages`, { body });
  }

  // ---- tasks ----
  getTask(taskId: string): Promise<unknown> {
    return this.request("GET", `/tasks/${encodeURIComponent(taskId)}`);
  }

  createTasksBulk(threadId: string, items: BulkTaskItem[]): Promise<{ ids: string[] }> {
    return this.request("POST", "/tasks/bulk", { threadId, items });
  }

  // ---- runs ----
  runDiff(runId: string): Promise<unknown[]> {
    return this.request("GET", `/runs/${encodeURIComponent(runId)}/diff`);
  }

  approveRun(runId: string): Promise<unknown> {
    return this.request("POST", `/runs/${encodeURIComponent(runId)}/approve`);
  }

  declineRun(runId: string): Promise<{ ok: boolean }> {
    return this.request("POST", `/runs/${encodeURIComponent(runId)}/decline`);
  }

  // ---- memory ----
  memoryRecall(q: string, limit?: number): Promise<unknown[]> {
    const params = new URLSearchParams({ q });
    if (limit !== undefined) params.set("limit", String(limit));
    return this.request("GET", `/memory/recall?${params.toString()}`);
  }

  // ---- integrations ----
  importLinear(threadId: string): Promise<{ imported: number; ids: string[] }> {
    return this.request("POST", "/integrations/linear/import", { threadId });
  }

  importGitHub(threadId: string): Promise<{ imported: number; ids: string[] }> {
    return this.request("POST", "/integrations/github/import", { threadId });
  }

  // ---- billing ----
  getBilling(): Promise<unknown> {
    return this.request("GET", "/billing");
  }
}
