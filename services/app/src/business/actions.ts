import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { businesses, paymentIntents, outreachCampaigns, tasks } from "../db/schema.js";
import { createPaymentIntent, createCampaign, addLead } from "./businesses.js";

// #146 the bridge between the agent/goal loop and the business funnel. A business
// goal's task is a DIRECTIVE the platform executes as a business action — a draft
// charge / campaign / signup that lands as PENDING in the same human-approval
// surface (#141/#142). So "land the first paying customer" becomes
// draft-campaign → (human approves) → draft-charge → (human approves), driven by
// the autonomy loop, with the money/outreach gate intact. Agents never move money.

export type BusinessAction =
  | { kind: "charge"; amountCents: number; customer: string }
  | { kind: "campaign"; channel: "email" | "social" | "ads"; audience: string }
  | { kind: "signup"; identifier: string };

const EMAIL = /[^\s,]+@[^\s,]+/;

// parseBusinessAction: pull a structured action from a task/directive line. Returns
// null when the line is NOT a business directive (then it's a normal/code task).
export function parseBusinessAction(text: string): BusinessAction | null {
  const t = text.trim();
  // charge $39 to dave@x.com  |  charge dave@x.com $39
  const charge = /\bcharge\b/i.test(t) ? t : null;
  if (charge) {
    const amt = charge.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
    const cust = charge.match(EMAIL);
    if (amt && cust) return { kind: "charge", amountCents: Math.round(parseFloat(amt[1]) * 100), customer: cust[0] };
  }
  // email/social/ads campaign to a@x.com, b@x.com
  if (/\bcampaign\b|\boutreach\b|\bemail\b.*\bto\b/i.test(t)) {
    const channel = /\bsocial\b/i.test(t) ? "social" : /\bads?\b/i.test(t) ? "ads" : "email";
    const to = t.split(/\bto\b/i).slice(1).join(" to ");
    const audience = (to.match(/[^\s,][^,]*@[^,]+/g) ?? to.match(/[^\s,]+@[^\s,]+/g) ?? []).map((s) => s.trim()).join(", ");
    if (audience) return { kind: "campaign", channel: channel as "email" | "social" | "ads", audience };
  }
  // (record) signup alice@x.com
  if (/\bsign\s?up\b|\blead\b/i.test(t)) {
    const id = t.match(EMAIL);
    if (id) return { kind: "signup", identifier: id[0] };
  }
  return null;
}

// findBusinessByName: resolve "@business ResumeAI" / a goal's businessId target.
export async function findBusinessByName(db: DB, orgId: string, name: string) {
  const all = await db.select().from(businesses).where(eq(businesses.orgId, orgId));
  const n = name.trim().toLowerCase();
  return all.find((b) => b.name.toLowerCase() === n) ?? all.find((b) => b.name.toLowerCase().includes(n));
}

export interface RunActionResult { ok: boolean; kind?: string; reason: string; pendingId?: string }

// runBusinessAction: execute a parsed action against a business → a PENDING draft
// (charge/campaign) or a recorded signup lead. Attributed to taskId so approving the
// draft can mark that goal task verified (#145). Money/sends stay human-gated.
export async function runBusinessAction(
  db: DB, args: { orgId: string; businessId: string; action: BusinessAction; taskId?: string },
): Promise<RunActionResult> {
  const { orgId, businessId, action, taskId } = args;
  if (action.kind === "charge") {
    const pi = await createPaymentIntent(db, { orgId, businessId, amountCents: action.amountCents, customer: action.customer, memo: "drafted by goal loop", taskId });
    return { ok: true, kind: "charge", reason: `drafted charge $${(action.amountCents / 100).toFixed(2)} to ${action.customer} (pending approval)`, pendingId: pi.id };
  }
  if (action.kind === "campaign") {
    const c = await createCampaign(db, { orgId, businessId, channel: action.channel, audience: action.audience, body: "drafted by goal loop", taskId });
    return { ok: true, kind: "campaign", reason: `drafted ${action.channel} campaign to ${action.audience} (pending approval)`, pendingId: c.id };
  }
  // signup → a recorded lead (no money/sending, so no approval needed).
  await addLead(db, { orgId, businessId, identifier: action.identifier, stage: "signup", source: "goal" });
  return { ok: true, kind: "signup", reason: `recorded signup ${action.identifier}` };
}

// runBusinessGoal: execute a business goal's OPEN tasks as business actions. Each
// parseable task drafts a pending charge/campaign (→ task "merged", awaiting the
// human approval that verifies it, #145) or records a signup (→ task "done", no
// money/sending). Returns what it drafted. This is what makes the autonomy loop
// reach the funnel instead of only opening code PRs (#146).
export interface BusinessGoalResult { drafted: { taskId: string; kind: string; reason: string }[]; skipped: number }
export async function runBusinessGoal(db: DB, orgId: string, goalId: string): Promise<BusinessGoalResult> {
  const { goals } = await import("../db/schema.js");
  const [g] = await db.select().from(goals).where(and(eq(goals.id, goalId), eq(goals.orgId, orgId)));
  if (!g?.businessId) return { drafted: [], skipped: 0 };
  const open = await db.select().from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.goalId, goalId), eq(tasks.state, "open")));
  const drafted: { taskId: string; kind: string; reason: string }[] = [];
  let skipped = 0;
  for (const t of open) {
    const action = parseBusinessAction(t.title);
    if (!action) { skipped++; continue; }
    const res = await runBusinessAction(db, { orgId, businessId: g.businessId, action, taskId: t.id });
    // charge/campaign → "merged" (drafted, awaiting human approval); signup → "done".
    const next = action.kind === "signup" ? "done" : "merged";
    await db.update(tasks).set({ state: next }).where(and(eq(tasks.orgId, orgId), eq(tasks.id, t.id)));
    drafted.push({ taskId: t.id, kind: res.kind ?? action.kind, reason: res.reason });
  }
  return { drafted, skipped };
}

// onDraftApproved: when a human approves a payment intent / campaign that a goal
// task drafted, mark that task "done" (verified) — closing the loop from autonomous
// draft → human approval → verified outcome (#145).
export async function onDraftApproved(db: DB, orgId: string, taskId: string | null | undefined) {
  if (!taskId) return;
  await db.update(tasks).set({ state: "done" }).where(and(eq(tasks.orgId, orgId), eq(tasks.id, taskId), eq(tasks.state, "merged")));
}

// taskIdOf helpers — read the task a draft was attributed to (for the approval hook).
export async function paymentTaskId(db: DB, orgId: string, intentId: string): Promise<string | null> {
  const [r] = await db.select({ taskId: paymentIntents.taskId }).from(paymentIntents).where(and(eq(paymentIntents.orgId, orgId), eq(paymentIntents.id, intentId)));
  return r?.taskId ?? null;
}
export async function campaignTaskId(db: DB, orgId: string, campaignId: string): Promise<string | null> {
  const [r] = await db.select({ taskId: outreachCampaigns.taskId }).from(outreachCampaigns).where(and(eq(outreachCampaigns.orgId, orgId), eq(outreachCampaigns.id, campaignId)));
  return r?.taskId ?? null;
}
