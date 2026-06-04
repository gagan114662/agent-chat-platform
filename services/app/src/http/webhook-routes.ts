import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type postgres from "postgres";
import type { DB } from "../db/client.js";
import { repos, threads, tasks } from "../db/schema.js";
import { verifyGitHubSignature } from "../integrations/github-webhook.js";

export interface WebhookDeps {
  db: DB;
  sql: postgres.Sql;
}

// Body cap for a webhook delivery (1 MiB). GitHub payloads are well under this;
// the cap protects memory against an oversized/abusive POST.
const BODY_LIMIT = 1024 * 1024;

// registerWebhookRoutes exposes the GitHub App webhook. Auth here is GitHub's own
// HMAC (X-Hub-Signature-256 over the raw body), NOT the user session — the
// user-auth preHandler treats /webhooks/* as public (see auth-routes) and this
// route enforces the signature itself.
//
// We register a route-scoped content-type parser for application/json that KEEPS
// the raw buffer (and parses it) so the HMAC is computed over the exact bytes
// GitHub signed — Fastify's default JSON parser would discard the raw body.
export function registerWebhookRoutes(app: FastifyInstance, d: WebhookDeps) {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer", bodyLimit: BODY_LIMIT },
    (req, body, done) => {
      // Stash the raw bytes for the HMAC, then parse JSON for the handler.
      (req as { rawBody?: Buffer }).rawBody = body as Buffer;
      try {
        done(null, body.length ? JSON.parse(body.toString("utf8")) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.post("/webhooks/github", { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    // 1) Verify GitHub's HMAC over the RAW body BEFORE any work. A wrong/missing
    //    signature → 401 (constant-time compare inside verifyGitHubSignature).
    const raw = (req as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    const ok = verifyGitHubSignature(
      process.env.GITHUB_APP_WEBHOOK_SECRET,
      raw,
      req.headers["x-hub-signature-256"],
    );
    if (!ok) return reply.code(401).send({ error: "invalid signature" });

    const event = req.headers["x-github-event"];

    // ping → acknowledge so GitHub's "Recent Deliveries" goes green.
    if (event === "ping") return reply.code(200).send({ ok: true });

    // Only issues.opened maps to a Task; everything else is acknowledged + ignored.
    const payload = (req.body ?? {}) as {
      action?: string;
      issue?: { number?: number; title?: string };
      repository?: { name?: string; owner?: { login?: string } };
    };
    if (event !== "issues" || payload.action !== "opened") {
      return reply.code(200).send({ ok: true, ignored: true });
    }

    const owner = payload.repository?.owner?.login;
    const name = payload.repository?.name;
    const number = payload.issue?.number;
    const title = payload.issue?.title ?? "";
    if (!owner || !name || typeof number !== "number") {
      return reply.code(200).send({ ok: true, ignored: true });
    }

    // Map the event's repo → our repos row → org. Unknown repo → 200 ignored
    // (a webhook for a repo we don't track is not an error).
    const [repo] = await d.db.select().from(repos)
      .where(and(eq(repos.githubOwner, owner), eq(repos.githubName, name)));
    if (!repo) return reply.code(200).send({ ok: true, ignored: true });

    // Find a thread for this repo (org-scoped). Without one we can't open a Task
    // (tasks.threadId is NOT NULL) — acknowledge + ignore.
    const [thread] = await d.db.select().from(threads)
      .where(and(eq(threads.repoId, repo.id), eq(threads.orgId, repo.orgId)));
    if (!thread) return reply.code(200).send({ ok: true, ignored: true });

    // Idempotent Task — same id scheme as importGitHubIssues (#22). A
    // re-delivery (GitHub retries) collapses via onConflictDoNothing → 0 new.
    const id = `gh:${owner}/${name}#${number}`;
    const [row] = await d.db.insert(tasks).values({
      id,
      orgId: repo.orgId,
      threadId: thread.id,
      title: `#${number} ${title}`,
      state: "open",
      createdByKind: "integration",
      createdById: "github",
    }).onConflictDoNothing().returning();

    return reply.code(200).send({ ok: true, taskId: id, created: Boolean(row) });
  });
}
