// #41 adoption of Zapier's gtm-cheat-codes playbook (github.com/zapier/gtm-cheat-codes):
// function-organized GTM agent skills. We carry over the registry faithfully — each
// skill's function, the business outcome, and the kind of action it produces — and map
// it onto our primitives (the business funnel, leads, ledger, audit). The upstream
// model keeps a human approval gate on every send; per the operator's explicit choice
// this adoption runs WITHOUT a human-in-the-loop gate (see gtm/runner.ts). The only
// remaining gate is capability: real sends require operator-provisioned connector creds
// (Zapier MCP), so nothing physically leaves the system until that's wired.

export type GtmFunction =
  | "marketing" | "sales-revops" | "customer-support"
  | "customer-advocacy" | "content-ops" | "gtm-ops";

// What the motion materially does when it runs a skill. Each maps to a concrete effect
// on our data model (funnel/ledger/audit) and to a connector call when one is wired.
export type GtmActionKind =
  | "outreach"      // demand-gen / sequence sends → funnel visitors + spend
  | "sequence"      // multi-step sales follow-up
  | "content"       // a drafted asset (page, story, clip)
  | "social-proof"  // approved customer proof for use in assets
  | "audit"         // lead/CX audit → an ops brief
  | "triage";       // inbound triage → routed action list

export interface GtmPlaybook {
  id: string;
  name: string;
  fn: GtmFunction;
  outcome: string;
  actionKind: GtmActionKind;
  // upstream gtm-cheat-codes path this was adopted from (provenance/audit).
  source: string;
}

// Adopted from registry/skills.csv. A representative, high-value set across every GTM
// function — enough to run a real motion end to end, not all 30 (the catalog is
// extensible: add a row to grow coverage).
export const GTM_PLAYBOOKS: GtmPlaybook[] = [
  // --- Marketing / Demand Gen ---
  { id: "mega-campaign-generator", name: "Mega Campaign Generator", fn: "marketing", actionKind: "outreach", outcome: "Turn campaign context into a review-ready launch package: positioning, audiences, messages, activation.", source: "skills/marketing/mega-campaign-generator" },
  { id: "campaign-postmortem", name: "Campaign Postmortem", fn: "marketing", actionKind: "audit", outcome: "Sourced campaign retro: what happened, what worked, what broke, what changes next.", source: "skills/marketing/campaign-postmortem" },
  { id: "html-mockup-builder", name: "HTML Mockup Builder", fn: "marketing", actionKind: "content", outcome: "Reviewable HTML mockup from a campaign / landing-page brief.", source: "skills/marketing/html-mockup-builder" },
  // --- Sales / RevOps ---
  { id: "sales-sequence-builder", name: "Sales Sequence Builder", fn: "sales-revops", actionKind: "sequence", outcome: "Source-backed outbound / follow-up sequence tailored to account, persona, trigger.", source: "skills/sales-revops/sales-sequence-builder" },
  { id: "named-account-trigger-radar", name: "Named Account Trigger Radar", fn: "sales-revops", actionKind: "audit", outcome: "Rank target accounts by why-now signals; recommend the next best seller action.", source: "skills/sales-revops/named-account-trigger-radar" },
  // --- Customer Support ---
  { id: "support-ticket-triage", name: "Support Ticket Triage Agent", fn: "customer-support", actionKind: "triage", outcome: "Pull ticket context, classify, and produce rep-ready next actions.", source: "skills/customer-support/support-ticket-triage" },
  // --- Customer Advocacy ---
  { id: "find-customer-social-proof", name: "Find Customer Social Proof", fn: "customer-advocacy", actionKind: "social-proof", outcome: "Find approved customer proof for campaigns, pages, decks, emails.", source: "skills/customer-advocacy/find-customer-social-proof" },
  { id: "customer-story-writer", name: "Customer Story Writer", fn: "customer-advocacy", actionKind: "content", outcome: "Turn transcripts + proof points into a narrative customer story.", source: "skills/customer-advocacy/customer-story-writer" },
  // --- Content Ops ---
  { id: "company-recording-clip", name: "Company Recording To Postable Clip", fn: "content-ops", actionKind: "content", outcome: "Find source recordings, locate useful moments, prepare clips for distribution.", source: "skills/content-ops/company-recording-clip" },
  // --- GTM Ops ---
  { id: "inbound-lead-audit-cx-map", name: "Inbound Lead Audit + CX Map", fn: "gtm-ops", actionKind: "audit", outcome: "Audit lead handling; map the customer experience from form fill to follow-up.", source: "skills/gtm-ops/inbound-lead-audit-cx-map" },
  { id: "daily-lead-steward", name: "Daily Lead Steward", fn: "gtm-ops", actionKind: "audit", outcome: "A daily operating view of leads needing attention, follow-up, or escalation.", source: "skills/gtm-ops/daily-lead-steward" },
];

export function playbooksFor(fn?: GtmFunction): GtmPlaybook[] {
  return fn ? GTM_PLAYBOOKS.filter((p) => p.fn === fn) : GTM_PLAYBOOKS;
}
export const GTM_FUNCTIONS: GtmFunction[] = ["marketing", "sales-revops", "customer-support", "customer-advocacy", "content-ops", "gtm-ops"];
