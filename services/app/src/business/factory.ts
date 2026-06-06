import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { offerings, goals } from "../db/schema.js";
import { createBusiness } from "./businesses.js";
import { createOffering } from "./catalog.js";
import { incomeStatement, portfolioPnl } from "./accounting.js";
import { createGoal } from "../autonomy/goals.js";
import { record } from "../audit/audit-log.js";

// #152 the FACTORY tier: discover opportunities (#154) → spawn a business unit from a
// spec (#153) → manage the portfolio by margin (#155). This is the layer that lets the
// system run MANY businesses, not one — allocate to winners, cut losers, on a schedule.
// HARD BOUNDARY unchanged: spawning provisions software + a self-driving goal; it never
// forms an entity or moves real money (revenue is still human-gated at the payment).

export interface OpportunitySpec {
  title: string;          // business unit name
  offer: string;          // what's sold
  targetCustomer: string; // who buys it
  priceCents: number;     // proposed price
  successMetric: string;  // the done-criterion the autonomy engine drives toward
  demandSignal: number;   // 0..1 cheap-validated demand score
}

// ---- #154 opportunity discovery + validation ----
// Generate candidate ideas, score demand cheaply, return ranked specs. `generate` and
// `score` are injectable — the default is a deterministic heuristic; the LLM gateway
// (#147) is the production upgrade for both (idea generation + demand probing).
export type IdeaGenerator = () => Omit<OpportunitySpec, "demandSignal">[];
export type DemandProbe = (idea: Omit<OpportunitySpec, "demandSignal">) => number;

const SEED_IDEAS: Omit<OpportunitySpec, "demandSignal">[] = [
  { title: "ResumeAI", offer: "AI resume review with a scored rewrite", targetCustomer: "job seekers", priceCents: 3300, successMetric: "first paying customer for a reviewed resume" },
  { title: "PRPolish", offer: "automated PR description + changelog writer", targetCustomer: "engineering teams", priceCents: 4900, successMetric: "first team subscribes and ships a generated changelog" },
  { title: "DeckDoctor", offer: "investor deck critique + redesign", targetCustomer: "early founders", priceCents: 9900, successMetric: "first founder pays for a redesigned deck" },
  { title: "InboxZeroBot", offer: "support-inbox triage + draft replies", targetCustomer: "small SaaS teams", priceCents: 5900, successMetric: "first team triages a real inbox" },
  { title: "SEOBrief", offer: "ranked keyword brief + outline per topic", targetCustomer: "content marketers", priceCents: 2900, successMetric: "first marketer buys a brief" },
];
const DEMAND_WEIGHTS: [RegExp, number][] = [
  [/job|resume|career/i, 0.9], [/engineering|developer|pr|code/i, 0.8],
  [/founder|investor|deck|startup/i, 0.7], [/support|inbox|saas/i, 0.75], [/seo|content|marketer/i, 0.6],
];
const defaultGenerate: IdeaGenerator = () => SEED_IDEAS;
// Cheap demand heuristic: market-keyword weight, nudged by price affordability. A real
// probe would query search volume / run a smoke test; this is the deterministic seam.
const defaultProbe: DemandProbe = (idea) => {
  const market = DEMAND_WEIGHTS.find(([re]) => re.test(idea.targetCustomer + " " + idea.offer))?.[1] ?? 0.5;
  const priceFit = idea.priceCents <= 5000 ? 1 : idea.priceCents <= 10000 ? 0.85 : 0.7;
  return Math.round(market * priceFit * 100) / 100;
};

export function discoverOpportunities(opts?: { generate?: IdeaGenerator; score?: DemandProbe; limit?: number; minDemand?: number }): OpportunitySpec[] {
  const ideas = (opts?.generate ?? defaultGenerate)();
  const probe = opts?.score ?? defaultProbe;
  const minDemand = opts?.minDemand ?? 0.5;
  return ideas
    .map((i) => ({ ...i, demandSignal: probe(i) }))
    .filter((s) => s.demandSignal >= minDemand) // cheap validation gate
    .sort((a, b) => b.demandSignal - a.demandSignal)
    .slice(0, opts?.limit ?? ideas.length);
}

// ---- #153 business spawner ----
// One call stands up a live business unit from a spec: the business entity, a catalog
// offering at the proposed price, and a self-driving goal whose criteria are the steps
// to first revenue. Autonomy is turned ON so the scheduler (#137/#138) picks it up.
export async function spawnBusiness(db: DB, args: { orgId: string; spec: OpportunitySpec; byKind?: string; byId?: string }) {
  const { orgId, spec } = args;
  const business = await createBusiness(db, { orgId, name: spec.title });
  const offering = await createOffering(db, {
    orgId, businessId: business.id,
    sku: spec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    name: spec.offer, deliverable: spec.offer, scope: `for ${spec.targetCustomer}`, priceCents: spec.priceCents,
  });
  const criteria = [
    `Deploy a public offer page for ${spec.offer}`,
    `Capture an inbound lead for ${spec.title}`,
    spec.successMetric,
  ].join("\n");
  const goal = await createGoal(db, { orgId, title: `Grow ${spec.title} to first revenue`, criteria, byKind: args.byKind ?? "agent", byId: args.byId ?? "factory", businessId: business.id });
  // Hand it straight to the autonomy engine: autonomy ON + state ACTIVE so the
  // scheduler picks it up immediately. Business goals are driven by their criteria
  // (runBusinessGoal) + the GTM motion, not by task decomposition — no human step.
  await db.update(goals).set({ autonomy: true, state: "active" }).where(and(eq(goals.orgId, orgId), eq(goals.id, goal.id)));
  await record(db, { orgId, actorKind: "agent", actorId: args.byId ?? "factory", action: "business.spawned", resource: business.id, payload: { spec, offeringId: offering.id, goalId: goal.id } });
  return { business, offering, goal };
}

// ---- #155 portfolio manager ----
export type PortfolioAction = "scale" | "kill" | "hold";
export interface PortfolioDecision { businessId: string; name: string; action: PortfolioAction; reason: string; netCents: number; marginPct: number; allocCents: number }

// Decide kill/scale/hold per business from its P&L, allocate a budget to the survivors
// weighted by net contribution, and APPLY: kill = pause the business's goals + retire
// its offerings (stop spending on a loser); scale = ensure autonomy stays on. New
// businesses with no revenue yet get runway (hold). Every decision is audit-logged.
export async function rebalancePortfolio(db: DB, args: { orgId: string; totalBudgetCents?: number; killMarginPct?: number; scaleMarginPct?: number; byId?: string }) {
  const killMargin = args.killMarginPct ?? 0;      // losing money (net<0) → kill
  const scaleMargin = args.scaleMarginPct ?? 30;   // healthy margin → scale
  const totalBudget = args.totalBudgetCents ?? 0;
  const pf = await portfolioPnl(db, args.orgId);

  const decisions: PortfolioDecision[] = [];
  for (const b of pf.businesses) {
    let action: PortfolioAction = "hold";
    let reason = "holding — within band or awaiting runway";
    if (b.revenueCents === 0) { action = "hold"; reason = "new — no revenue yet, giving runway"; }
    else if (b.netCents < 0 || b.marginPct < killMargin) { action = "kill"; reason = `unprofitable (net ${b.netCents}¢, margin ${b.marginPct}%)`; }
    else if (b.marginPct >= scaleMargin) { action = "scale"; reason = `healthy margin ${b.marginPct}% — scale`; }
    decisions.push({ businessId: b.businessId, name: b.name, action, reason, netCents: b.netCents, marginPct: b.marginPct, allocCents: 0 });
  }

  // Allocate budget to non-killed businesses, weighted by net contribution (winners
  // get more); a floor so a held/new business still gets a little runway.
  const survivors = decisions.filter((d) => d.action !== "kill");
  const weights = survivors.map((d) => Math.max(d.netCents, 0) + 100); // +100¢ floor
  const weightSum = weights.reduce((s, w) => s + w, 0) || 1;
  survivors.forEach((d, i) => { d.allocCents = Math.round((weights[i] / weightSum) * totalBudget); });

  // Apply + audit each decision.
  for (const d of decisions) {
    if (d.action === "kill") {
      await db.update(goals).set({ autonomy: false }).where(and(eq(goals.orgId, args.orgId), eq(goals.businessId, d.businessId)));
      await db.update(offerings).set({ active: false }).where(and(eq(offerings.orgId, args.orgId), eq(offerings.businessId, d.businessId)));
    } else if (d.action === "scale") {
      await db.update(goals).set({ autonomy: true }).where(and(eq(goals.orgId, args.orgId), eq(goals.businessId, d.businessId)));
    }
    await record(db, { orgId: args.orgId, actorKind: "agent", actorId: args.byId ?? "portfolio-manager", action: `portfolio.${d.action}`, resource: d.businessId, payload: { reason: d.reason, netCents: d.netCents, marginPct: d.marginPct, allocCents: d.allocCents } });
  }

  return { decisions, totalBudgetCents: totalBudget, totalNetCents: pf.totalNetCents, profitableCount: pf.profitableCount, killed: decisions.filter((d) => d.action === "kill").length, scaled: decisions.filter((d) => d.action === "scale").length };
}

// Convenience for the autonomy loop / a route: discover → spawn the top opportunity.
export async function spawnTopOpportunity(db: DB, args: { orgId: string; byId?: string; discover?: Parameters<typeof discoverOpportunities>[0] }) {
  const [top] = discoverOpportunities({ ...args.discover, limit: 1 });
  if (!top) return undefined;
  return spawnBusiness(db, { orgId: args.orgId, spec: top, byId: args.byId });
}

// re-export for callers that compute a single statement
export { incomeStatement };
