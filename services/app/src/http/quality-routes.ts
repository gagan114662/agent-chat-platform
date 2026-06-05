import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { agents, runs } from "../db/schema.js";
import { actor } from "./actor.js";
import { listReputations } from "../delegation/reputation-store.js";
import { evaluate } from "../quality/evals.js";

// #151 quality/observability surface. Per-agent pass rate (from reputation #128) +
// how many runs are currently held for human review (the quality gate blocked them
// from merge). Plus an on-demand eval endpoint (the online check the gate runs).
export function registerQualityRoutes(app: FastifyInstance, d: { db: DB }) {
  app.get("/quality", async (req) => {
    const { orgId } = actor(req);
    const reps = await listReputations(d.db, orgId);
    const roster = await d.db.select({ id: agents.id, handle: agents.handle }).from(agents).where(eq(agents.orgId, orgId));
    // runs the gate held for human review (placeholder/secret/risk) — the "blocked
    // bad output" surface; never auto-merged.
    const held = await d.db.select({ id: runs.id }).from(runs)
      .where(and(eq(runs.orgId, orgId), inArray(runs.state, ["held_for_human", "checks_failed"])));
    return {
      agents: roster.map((a) => ({ ...(reps[a.id] ?? { scorePct: 50, runs: 0, success: 0, fail: 0 }), id: a.id, handle: a.handle })),
      heldForReview: held.length,
    };
  });

  // Run the eval harness on a deliverable (placeholder/secret scan + criteria
  // coverage). The same checks the merge gate runs — exposed for tests/offline evals.
  app.post("/quality/evaluate", async (req) => {
    const b = (req.body ?? {}) as { files?: { filename: string; patch?: string; additions?: number; deletions?: number; status?: string }[]; deliverable?: string; criteria?: string };
    return evaluate({ files: b.files as never, deliverable: b.deliverable, criteria: b.criteria });
  });
}
