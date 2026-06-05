import type { FastifyInstance } from "fastify";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { createNote, listNotes, updateNote, deleteNote } from "../nav/notes.js";

// #76 per-workspace notes CRUD. All routes are org-scoped via actor(req).orgId;
// a cross-org note id is invisible → 404. List is also workspace-scoped.
export function registerNotesRoutes(app: FastifyInstance, d: { db: DB }) {
  app.post("/notes", async (req, reply) => {
    const { orgId, userId } = actor(req);
    const { workspaceId, title, body } = (req.body ?? {}) as {
      workspaceId?: string; title?: string; body?: string;
    };
    if (!workspaceId?.trim()) return reply.code(400).send({ error: "workspaceId required" });
    const note = await createNote(d.db, {
      orgId, workspaceId, title, body, createdById: userId,
    });
    return reply.code(201).send(note);
  });

  app.get("/notes", async (req, reply) => {
    const { orgId } = actor(req);
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId?.trim()) return reply.code(400).send({ error: "workspaceId required" });
    return listNotes(d.db, orgId, workspaceId);
  });

  app.patch("/notes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { orgId } = actor(req);
    const { title, body } = (req.body ?? {}) as { title?: string; body?: string };
    const note = await updateNote(d.db, orgId, id, { title, body });
    if (!note) return reply.code(404).send({ error: "note not found" });
    return note;
  });

  app.delete("/notes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { orgId } = actor(req);
    const ok = await deleteNote(d.db, orgId, id);
    if (!ok) return reply.code(404).send({ error: "note not found" });
    return reply.code(204).send();
  });
}
