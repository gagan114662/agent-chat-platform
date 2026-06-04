import { and, eq } from "drizzle-orm";
import type postgres from "postgres";
import type { Client } from "@temporalio/client";
import type { DB } from "../db/client.js";
import { notify } from "../db/client.js";
import { parseMentions } from "./mentions.js";
import { createMessage } from "./messages.js";
import { resolveMention, isPermittedOnRepo, agentModelConfig, agentMcp } from "../agents/agents.js";
import { openTaskForMention } from "../tasks/tasks.js";
import { startFusionRun } from "../fusion/start.js";
import { THREAD_CHANNEL } from "../fusion/events.js";
import { threads, repos } from "../db/schema.js";

export interface MentionDeps { db: DB; sql: postgres.Sql; temporal: Client; sandboxUrl: string; }

export interface MentionInput {
  orgId: string;
  threadId: string;
  body: string;
  authorKind: "human" | "agent";
  authorId: string;
  // Depth of the message author in the mention chain. Humans start at 0; the
  // children they trigger run at depth 1, and so on. A run authored by an agent
  // passes its own depth so its mentions are bounded.
  depth: number;
}

// #27 loop guard: bound how deep an agent↔agent @mention chain can go. A human
// message is depth 0 → its children run at depth 1; an agent message at depth 1
// → children at depth 2. At MAX_DEPTH we stop spawning, so a cycle of agents
// @mentioning each other can never run forever.
export const MAX_DEPTH = 2;

// Shared mention handler used by BOTH the human POST /messages route and the
// agent-authored path. Parses @mentions in `body`, resolves each agent org-scoped,
// enforces repo/token permission (existing behavior), and starts a fusion run per
// eligible mention. Returns the started run ids.
//
// Two guards make agent-authored mentions safe:
//   - depth >= MAX_DEPTH  → return [] (no further fan-out)
//   - self-trigger        → an agent mentioning itself is skipped
// Children are started at depth + 1.
export async function handleMentions(d: MentionDeps, m: MentionInput): Promise<string[]> {
  // Loop guard: never spawn beyond the bound. Humans (depth 0) still trigger
  // their direct children (depth 1).
  if (m.depth >= MAX_DEPTH) return [];

  const [thread] = await d.db.select().from(threads).where(and(eq(threads.id, m.threadId), eq(threads.orgId, m.orgId)));
  if (!thread) return [];

  const started: string[] = [];
  for (const handle of parseMentions(m.body)) {
    const agent = await resolveMention(d.db, m.orgId, handle);
    if (!agent || !thread.repoId) continue;
    // No self-trigger: an agent author can't kick off a run for itself.
    if (m.authorKind === "agent" && agent.id === m.authorId) continue;
    if (!(await isPermittedOnRepo(d.db, agent.id, thread.repoId))) continue;
    const [repo] = await d.db.select().from(repos).where(and(eq(repos.id, thread.repoId), eq(repos.orgId, m.orgId)));
    if (!repo) continue; // dangling repoId (no FK constraint) — skip rather than 500
    const token = process.env[repo.tokenEnvVar];
    if (!token) continue;

    const { run } = await openTaskForMention(d.db, {
      orgId: m.orgId, threadId: m.threadId, intent: m.body, agentId: agent.id,
      createdByKind: m.authorKind, createdById: m.authorId,
    });
    await startFusionRun(d.temporal, {
      run, orgId: m.orgId, threadId: m.threadId, repo, agentId: agent.id, intent: m.body, sandboxUrl: d.sandboxUrl,
      planMode: repo.planMode, // #20: plan-first when the repo opts in
      mentionDepth: m.depth + 1, // #27: children one level deeper
      ...agentModelConfig(agent), // #58: per-agent model/provider from agents.config
      ...(agentMcp(agent) ? { mcpServers: agentMcp(agent) } : {}), // #57: per-agent MCP servers
    });
    started.push(run.id);
  }
  return started;
}

// The primitive an agent run uses to coordinate: write an agent-authored message,
// notify subscribers, then run the guarded mention handler so the message's
// @mentions can start other agents' runs (bounded by depth + self-trigger guards).
export async function postAgentMessage(
  d: MentionDeps,
  m: { orgId: string; threadId: string; agentId: string; body: string; depth: number },
): Promise<{ message: Awaited<ReturnType<typeof createMessage>>; startedRuns: string[] }> {
  const message = await createMessage(d.db, {
    orgId: m.orgId, threadId: m.threadId, authorKind: "agent", authorId: m.agentId, body: m.body,
  });
  await notify(d.sql, THREAD_CHANNEL, { threadId: m.threadId, message });
  const startedRuns = await handleMentions(d, {
    orgId: m.orgId, threadId: m.threadId, body: m.body,
    authorKind: "agent", authorId: m.agentId, depth: m.depth,
  });
  return { message, startedRuns };
}
