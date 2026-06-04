import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { members } from "../db/schema.js";

export type Role = "admin" | "member";
export type Action = "channel:create" | "channel:delete" | "thread:create" | "message:post" | "dm:start";

const MEMBER_ACTIONS: Action[] = ["thread:create", "message:post", "dm:start"];

export function can(role: Role, action: Action): boolean {
  if (role === "admin") return true;
  return MEMBER_ACTIONS.includes(action);
}

export async function roleOf(db: DB, memberId: string): Promise<Role> {
  const [m] = await db.select().from(members).where(eq(members.id, memberId));
  return (m?.role as Role) ?? "member";
}
