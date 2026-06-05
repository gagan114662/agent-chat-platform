import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { notes } from "../db/schema.js";

// #76 per-workspace notes. Every helper is scoped by orgId (and workspaceId for
// list/create) so a foreign org id is invisible — callers map an undefined/false
// result to 404.

export interface NewNote {
  orgId: string;
  workspaceId: string;
  title?: string;
  body?: string;
  createdById: string;
}

export async function createNote(db: DB, n: NewNote) {
  const row = {
    id: randomUUID(),
    orgId: n.orgId,
    workspaceId: n.workspaceId,
    title: n.title ?? "",
    body: n.body ?? "",
    createdById: n.createdById,
  };
  const [inserted] = await db.insert(notes).values(row).returning();
  return inserted;
}

// listNotes returns a workspace's notes (org+workspace scoped), newest first.
export function listNotes(db: DB, orgId: string, workspaceId: string) {
  return db.select().from(notes)
    .where(and(eq(notes.orgId, orgId), eq(notes.workspaceId, workspaceId)))
    .orderBy(desc(notes.createdAt));
}

// getNote fetches a single org-scoped note (cross-org id → undefined).
export async function getNote(db: DB, orgId: string, noteId: string) {
  const [n] = await db.select().from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.orgId, orgId)));
  return n;
}

// updateNote patches title/body (only provided fields) and bumps updatedAt.
// Org-scoped: a cross-org id matches nothing → undefined (no write).
export async function updateNote(
  db: DB,
  orgId: string,
  noteId: string,
  patch: { title?: string; body?: string },
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.body !== undefined) set.body = patch.body;
  const [n] = await db.update(notes).set(set)
    .where(and(eq(notes.id, noteId), eq(notes.orgId, orgId)))
    .returning();
  return n;
}

// deleteNote removes an org-scoped note. Returns true if a row was deleted, false
// otherwise (unknown / cross-org id → no-op).
export async function deleteNote(db: DB, orgId: string, noteId: string): Promise<boolean> {
  const deleted = await db.delete(notes)
    .where(and(eq(notes.id, noteId), eq(notes.orgId, orgId)))
    .returning({ id: notes.id });
  return deleted.length > 0;
}
