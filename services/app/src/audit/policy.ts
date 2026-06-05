// #150.3 per-action authorization. RBAC alone is insufficient for delegating,
// asynchronous agents: a hallucinated "delete prod" / "transfer funds" must be
// blocked at the MOMENT of execution, decoupled from the model's reasoning. This is
// a small zero-trust policy engine (the OPA-style hook): every consequential action
// is evaluated here before it runs. Deny-by-default for high-stakes.

export type ActorRole = "admin" | "member" | "agent" | "viewer";

export interface AuthzRequest {
  role: ActorRole;
  action: string;        // "payment.charge" | "payment.payout" | "repo.merge" | "deploy.prod" | "tool.call" | "outreach.send" | …
  resource?: string;
  amountCents?: number;
  production?: boolean;
}
export interface AuthzDecision { allow: boolean; requiresHuman: boolean; reason: string }

// High-stakes actions agents may PROPOSE but never EXECUTE on their own — they
// require a human approval (the money/outreach/prod gate).
const HUMAN_REQUIRED = /^(payment\.(charge|payout|refund|transfer)|outreach\.send|deploy\.prod|repo\.merge\.production|entity\.|bank\.)/i;
// Actions that are categorically denied to agents regardless (destructive/irreversible).
const AGENT_DENIED = /(delete.*prod|drop.*(database|table)|rotate.*(secret|key)|transfer.*funds|wire\.)/i;

export function authorize(req: AuthzRequest): AuthzDecision {
  // Categorical deny for agents on destructive/irreversible actions.
  if (req.role === "agent" && AGENT_DENIED.test(req.action)) {
    return { allow: false, requiresHuman: true, reason: `denied: agents cannot execute "${req.action}" (destructive/irreversible)` };
  }
  // High-stakes → an agent/member can DRAFT but a human (admin) must approve.
  if (HUMAN_REQUIRED.test(req.action)) {
    if (req.role === "admin") return { allow: true, requiresHuman: false, reason: "admin-approved high-stakes action" };
    return { allow: false, requiresHuman: true, reason: `"${req.action}" requires human approval (the money/prod gate)` };
  }
  // viewers can't act.
  if (req.role === "viewer") return { allow: false, requiresHuman: false, reason: "viewers are read-only" };
  // everything else (ordinary tool calls, drafts, code work) → allowed.
  return { allow: true, requiresHuman: false, reason: "permitted" };
}
