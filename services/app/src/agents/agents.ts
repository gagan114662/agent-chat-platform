import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { agents, repos } from "../db/schema.js";

// AgentModelConfig is the optional per-agent model/provider selection (#58),
// stored on the agent's jsonb `config`. Both fields are optional; empty = the
// platform default (Anthropic, the sandbox/CLI default model — today's behavior).
export interface AgentModelConfig {
  provider?: string;
  model?: string;
}

// agentModelConfig reads the model/provider selection off an agent's jsonb config.
// Tolerant of an absent/loosely-typed config (jsonb): only string values are
// surfaced; anything else is ignored so a malformed config never injects argv/env.
export function agentModelConfig(agent: { config?: unknown } | null | undefined): AgentModelConfig {
  const cfg = agent?.config;
  if (!cfg || typeof cfg !== "object") return {};
  const c = cfg as Record<string, unknown>;
  const out: AgentModelConfig = {};
  if (typeof c.provider === "string" && c.provider !== "") out.provider = c.provider;
  if (typeof c.model === "string" && c.model !== "") out.model = c.model;
  return out;
}

// agentMcp reads the per-agent MCP server selection (#57) off an agent's jsonb
// `config.mcpServers` (an array of built-in catalog names). Tolerant of an
// absent/loosely-typed config: returns undefined unless config.mcpServers is a
// non-empty array of non-empty strings (anything else is ignored so a malformed
// config never injects names). Undefined = no MCP servers (today's behavior).
// Authorization is enforced downstream in the sandbox (default-deny catalog).
export function agentMcp(agent: { config?: unknown } | null | undefined): string[] | undefined {
  const cfg = agent?.config;
  if (!cfg || typeof cfg !== "object") return undefined;
  const c = cfg as Record<string, unknown>;
  if (!Array.isArray(c.mcpServers)) return undefined;
  const names = c.mcpServers.filter((n): n is string => typeof n === "string" && n !== "");
  return names.length > 0 ? names : undefined;
}

export async function resolveMention(db: DB, orgId: string, handle: string) {
  const [a] = await db.select().from(agents)
    .where(and(eq(agents.orgId, orgId), eq(agents.handle, handle.toLowerCase())));
  return a;
}

export async function isPermittedOnRepo(db: DB, agentId: string, repoId: string) {
  const [a] = await db.select().from(agents).where(eq(agents.id, agentId));
  const [r] = await db.select().from(repos).where(eq(repos.id, repoId));
  if (!a || !r) return false;
  if (a.orgId !== r.orgId) return false;            // never cross-org
  return a.shared || a.workspaceId === r.workspaceId; // #28: shared → any workspace in the org
}

// #28: toggle an agent's `shared` flag (org-scoped). Returns the updated agent,
// or undefined if no agent with that id exists in the org.
export async function setAgentShared(db: DB, { orgId, agentId, shared }: { orgId: string; agentId: string; shared: boolean }) {
  const [a] = await db.update(agents).set({ shared })
    .where(and(eq(agents.id, agentId), eq(agents.orgId, orgId)))
    .returning();
  return a;
}
