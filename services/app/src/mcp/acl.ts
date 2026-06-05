// #150.1 MCP tool ACLs. Connecting agents to default-open MCP servers causes
// context rot (too many irrelevant tools degrade selection + inflate tokens) and
// over-permissioning. The gateway returns ONLY the tools whitelisted for an agent's
// role; unauthorized tools are HIDDEN from the context entirely (not just
// prompt-discouraged), so an agent can't call what it can't see.

export type AgentRole = "coder" | "researcher" | "reviewer" | "product" | "qa" | "devops" | "default";

// role → allowed tool-name patterns. "*" = all (devops/admin agents). Patterns match
// tool names like "fs.read", "git.commit", "web.search", "shell.exec", "payment.*".
const ROLE_TOOLS: Record<AgentRole, RegExp[]> = {
  coder:      [/^fs\./, /^git\.(status|diff|commit|branch)/, /^build\./, /^test\./, /^lsp\./],
  reviewer:   [/^fs\.read/, /^git\.(diff|log|status)/, /^test\./, /^lint\./],
  researcher: [/^web\.(search|fetch)/, /^fs\.read/, /^docs\./],
  product:    [/^web\.(search|fetch)/, /^docs\./, /^issue\./],
  qa:         [/^test\./, /^browser\./, /^fs\.read/],
  devops:     [/^.+/], // trusted: all tools (still subject to per-action authz #150.3)
  default:    [/^fs\.read/, /^web\.search/],
};

export interface ToolSpec { name: string; [k: string]: unknown }

export function isToolAllowed(role: AgentRole, tool: string): boolean {
  return (ROLE_TOOLS[role] ?? ROLE_TOOLS.default).some((re) => re.test(tool));
}

// filterTools: the subset of a server's tools an agent of `role` may see/use.
// Unauthorized tools are removed entirely (hidden from the agent's context).
export function filterTools<T extends ToolSpec>(tools: T[], role: AgentRole): T[] {
  return tools.filter((t) => isToolAllowed(role, t.name));
}

export interface ToolAuthz { allow: boolean; reason: string }
export function authorizeTool(role: AgentRole, tool: string): ToolAuthz {
  return isToolAllowed(role, tool)
    ? { allow: true, reason: "in role ACL" }
    : { allow: false, reason: `tool "${tool}" is not in the ${role} role's ACL` };
}
