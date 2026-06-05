import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { tools } from "../db/schema.js";

// #99 persistent internal tools. Every helper is org-scoped (and workspace-scoped
// for list) so a foreign org id is invisible — callers map an undefined/false
// result to 404. Content is stored verbatim and rendered ONLY in a `sandbox=""`
// iframe on the client (scripts disabled), so there is no server-side sanitising.

export const TOOL_KINDS = ["dashboard", "form", "page"] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

function assertKind(kind: string): asserts kind is ToolKind {
  if (!(TOOL_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`invalid kind: ${kind} (must be ${TOOL_KINDS.join("|")})`);
  }
}

export interface NewTool {
  orgId: string;
  workspaceId: string;
  name: string;
  kind?: string;
  content?: string;
  byKind: string;
  byId: string;
}

export async function createTool(db: DB, t: NewTool) {
  const kind = t.kind ?? "page";
  assertKind(kind);
  const row = {
    id: randomUUID(),
    orgId: t.orgId,
    workspaceId: t.workspaceId,
    name: t.name,
    kind,
    content: t.content ?? "",
    published: false,
    createdByKind: t.byKind,
    createdById: t.byId,
  };
  const [inserted] = await db.insert(tools).values(row).returning();
  return inserted;
}

// listTools returns an org's tools (newest first). Filters by workspace and/or
// published flag when requested.
export function listTools(
  db: DB,
  orgId: string,
  opts: { workspaceId?: string; publishedOnly?: boolean } = {},
) {
  const conds = [eq(tools.orgId, orgId)];
  if (opts.workspaceId) conds.push(eq(tools.workspaceId, opts.workspaceId));
  if (opts.publishedOnly) conds.push(eq(tools.published, true));
  return db.select().from(tools).where(and(...conds)).orderBy(desc(tools.createdAt));
}

// getTool fetches a single org-scoped tool (cross-org id → undefined).
export async function getTool(db: DB, orgId: string, id: string) {
  const [t] = await db.select().from(tools)
    .where(and(eq(tools.id, id), eq(tools.orgId, orgId)));
  return t;
}

// updateTool patches name/content/kind (only provided fields) and bumps updatedAt.
// Org-scoped: a cross-org id matches nothing → undefined (no write).
export async function updateTool(
  db: DB,
  patch: { orgId: string; id: string; name?: string; content?: string; kind?: string },
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.content !== undefined) set.content = patch.content;
  if (patch.kind !== undefined) {
    assertKind(patch.kind);
    set.kind = patch.kind;
  }
  const [t] = await db.update(tools).set(set)
    .where(and(eq(tools.id, patch.id), eq(tools.orgId, patch.orgId)))
    .returning();
  return t;
}

// publishTool flips the published flag (org-scoped → cross-org id is a no-op).
export async function publishTool(
  db: DB,
  args: { orgId: string; id: string; published: boolean },
) {
  const [t] = await db.update(tools)
    .set({ published: args.published, updatedAt: new Date() })
    .where(and(eq(tools.id, args.id), eq(tools.orgId, args.orgId)))
    .returning();
  return t;
}

// deleteTool removes an org-scoped tool. Returns true if a row was deleted.
export async function deleteTool(db: DB, orgId: string, id: string): Promise<boolean> {
  const deleted = await db.delete(tools)
    .where(and(eq(tools.id, id), eq(tools.orgId, orgId)))
    .returning({ id: tools.id });
  return deleted.length > 0;
}
