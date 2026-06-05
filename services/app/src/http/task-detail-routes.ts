import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import {
  updateTask, addTaskComment, listTaskComments,
  addTaskRelation, listTaskRelations, bulkCreateTasks,
  type TaskPriority, type TaskState, type TaskRelationKind, type BulkCreateItem,
} from "../tasks/tasks.js";
import { tasks } from "../db/schema.js";
import { actor } from "./actor.js";

export interface TaskDetailDeps { db: DB; }

// Map a thrown error to an HTTP status: validation problems (invalid value / over
// the bulk cap) → 400; missing/cross-org entities → 404. Keeps the org-scoped 404
// contract (#14) while surfacing bad input as 400.
function statusFor(err: Error): number {
  const m = err.message;
  if (m.startsWith("invalid ") || m.startsWith("too many ")) return 400;
  return 404;
}

export function registerTaskDetailRoutes(app: FastifyInstance, d: TaskDetailDeps) {
  // List all tasks for the actor's org (newest first) — powers the Tasks board
  // (#106). Org-scoped: only the caller's org's tasks are returned.
  app.get("/tasks", async (req, reply) => {
    const { orgId } = actor(req);
    const rows = await d.db.select().from(tasks)
      .where(eq(tasks.orgId, orgId))
      .orderBy(desc(tasks.dueDate));
    return reply.code(200).send({ tasks: rows });
  });

  // PATCH a task's priority/due/status, org-scoped (#14). Invalid value → 400;
  // cross-org/unknown task → 404.
  app.patch("/tasks/:id", async (req, reply) => {
    const { id: taskId } = req.params as { id: string };
    const body = (req.body ?? {}) as { priority?: TaskPriority; dueDate?: string | null; state?: TaskState };
    const { orgId } = actor(req);
    try {
      const task = await updateTask(d.db, {
        orgId, taskId, priority: body.priority, dueDate: body.dueDate, state: body.state,
      });
      return reply.code(200).send({ task });
    } catch (e) {
      const err = e as Error;
      return reply.code(statusFor(err)).send({ error: err.message });
    }
  });

  // Add a comment to a task (author = the actor). Cross-org/unknown task → 404.
  app.post("/tasks/:id/comments", async (req, reply) => {
    const { id: taskId } = req.params as { id: string };
    const { body } = req.body as { body: string };
    const { orgId, userId } = actor(req);
    try {
      const comment = await addTaskComment(d.db, {
        orgId, taskId, authorKind: "human", authorId: userId, body,
      });
      return reply.code(201).send({ comment });
    } catch (e) {
      const err = e as Error;
      return reply.code(statusFor(err)).send({ error: err.message });
    }
  });

  // GET a task with its comments + relations (org-scoped). Cross-org/unknown → 404.
  app.get("/tasks/:id", async (req, reply) => {
    const { id: taskId } = req.params as { id: string };
    const { orgId } = actor(req);
    const [task] = await d.db.select().from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)));
    if (!task) return reply.code(404).send({ error: `task not found: ${taskId}` });
    const [comments, relations] = await Promise.all([
      listTaskComments(d.db, orgId, taskId),
      listTaskRelations(d.db, orgId, taskId),
    ]);
    return reply.code(200).send({ task, comments, relations });
  });

  // Link two tasks (blocks|related|duplicate), idempotent. Cross-org/unknown task →
  // 404; invalid relation → 400.
  app.post("/tasks/:id/relations", async (req, reply) => {
    const { id: fromTaskId } = req.params as { id: string };
    const { toTaskId, relation } = req.body as { toTaskId: string; relation: TaskRelationKind };
    const { orgId } = actor(req);
    try {
      const rel = await addTaskRelation(d.db, { orgId, fromTaskId, toTaskId, relation });
      return reply.code(201).send({ relation: rel });
    } catch (e) {
      const err = e as Error;
      return reply.code(statusFor(err)).send({ error: err.message });
    }
  });

  // Bulk-create ≤50 tasks in one transaction. Over the cap → 400; invalid item → 400.
  app.post("/tasks/bulk", async (req, reply) => {
    const { threadId, items } = req.body as { threadId: string; items: BulkCreateItem[] };
    const { orgId, userId } = actor(req);
    try {
      const { ids } = await bulkCreateTasks(d.db, {
        orgId, threadId, items: items ?? [], byKind: "human", byId: userId,
      });
      return reply.code(201).send({ ids });
    } catch (e) {
      const err = e as Error;
      return reply.code(statusFor(err)).send({ error: err.message });
    }
  });
}
