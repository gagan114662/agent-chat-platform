import type { DB } from "../db/client.js";
import { tasks } from "../db/schema.js";

// A Linear issue, narrowed to the fields we surface as Tasks.
export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: string;
  url: string;
}

// Injectable Linear client so routes/tests can swap in a fake (no live API).
export interface LinearClient {
  listIssues(opts?: { first?: number }): Promise<LinearIssue[]>;
}

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

interface LinearGraphqlNode {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  state?: { name?: string | null } | null;
  url: string;
}

// Real client: POSTs the GraphQL query to Linear, authenticating with the raw
// API key in the Authorization header (Linear personal API keys are sent as-is,
// not as a Bearer token). Flattens `state.name` → `state`.
export function makeLinearClient(apiKey: string): LinearClient {
  return {
    async listIssues(opts?: { first?: number }): Promise<LinearIssue[]> {
      const first = opts?.first ?? 50;
      const query = `{ issues(first: ${first}) { nodes { id identifier title description state { name } url } } }`;
      const res = await fetch(LINEAR_GRAPHQL_URL, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: apiKey },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) {
        throw new Error(`Linear API error: ${res.status}`);
      }
      const json = (await res.json()) as { data?: { issues?: { nodes?: LinearGraphqlNode[] } } };
      const nodes = json.data?.issues?.nodes ?? [];
      return nodes.map((n) => ({
        id: n.id,
        identifier: n.identifier,
        title: n.title,
        description: n.description ?? undefined,
        state: n.state?.name ?? "",
        url: n.url,
      }));
    },
  };
}

export interface ImportLinearInput {
  orgId: string;
  threadId: string;
  client: LinearClient;
}

// Pulls Linear issues into org-scoped Tasks on the given thread. The task id is
// deterministic per source issue (`linear:${id}`) and the insert uses
// onConflictDoNothing, so re-importing the same issues creates 0 new Tasks
// (idempotent). Returns the ids of the Tasks actually created on this call.
export async function importLinearIssues(db: DB, i: ImportLinearInput): Promise<string[]> {
  const issues = await i.client.listIssues();
  const created: string[] = [];
  for (const issue of issues) {
    const id = `linear:${issue.id}`;
    const [row] = await db
      .insert(tasks)
      .values({
        id,
        orgId: i.orgId,
        threadId: i.threadId,
        title: `[${issue.identifier}] ${issue.title}`,
        state: "open",
        createdByKind: "integration",
        createdById: "linear",
      })
      .onConflictDoNothing()
      .returning();
    if (row) created.push(row.id);
  }
  return created;
}
