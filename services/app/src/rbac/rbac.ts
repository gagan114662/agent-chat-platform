import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { members } from "../db/schema.js";

export type Role = "admin" | "member" | "viewer";
export type Action =
  | "channel:create" | "channel:delete" | "channel:manage" | "thread:create" | "message:post" | "dm:start"
  | "agent:share" | "memory:write:org" | "team:manage";

// Explicit (role × action) matrix. `admin` is no longer a wildcard — every admin
// capability must be listed here. `member` keeps its current write capabilities;
// `viewer` is read-only.
const MATRIX: Record<Role, Action[]> = {
  viewer: [], // read-only
  member: ["thread:create", "message:post", "dm:start"],
  admin: ["channel:create", "channel:delete", "channel:manage", "thread:create", "message:post", "dm:start", "agent:share", "memory:write:org", "team:manage"],
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[role]?.includes(action) ?? false;
}

export async function roleOf(db: DB, memberId: string, orgId: string): Promise<Role> {
  const [m] = await db.select().from(members).where(and(eq(members.id, memberId), eq(members.orgId, orgId)));
  return (m?.role as Role) ?? "member";
}
