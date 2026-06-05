import { useEffect, useState } from "react";
import type { Billing, Plan, QuotaKind, Treasury } from "../api.js";

const QUOTA_KINDS: QuotaKind[] = ["seats", "agents", "messages", "tasks"];

const fmtLimit = (limit: number) => (limit < 0 ? "∞" : String(limit));
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// #85 billing panel: the org's current plan + a usage/quota table (seats/agents/
// messages/tasks: used vs limit, an "over" indicator) + an Upgrade button per
// purchasable plan that builds a Stripe Checkout Session and redirects to it.
// `redirect` is injectable so tests don't touch window.location.
export function BillingPanel({
  getBilling,
  listPlans,
  billingCheckout,
  getTreasury,
  redirect = (url: string) => { window.location.href = url; },
}: {
  getBilling: () => Promise<Billing>;
  listPlans: () => Promise<Plan[]>;
  billingCheckout: (planId: string) => Promise<{ url: string }>;
  getTreasury?: () => Promise<Treasury>;
  redirect?: (url: string) => void;
}) {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [treasury, setTreasury] = useState<Treasury | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBilling().then(setBilling).catch((e) => setError((e as Error).message));
    listPlans().then(setPlans).catch((e) => setError((e as Error).message));
    getTreasury?.().then(setTreasury).catch(() => {});
  }, [getBilling, listPlans, getTreasury]);

  const upgrade = async (planId: string) => {
    if (busy) return;
    setBusy(planId); setError(null);
    try {
      const { url } = await billingCheckout(planId);
      redirect(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h2 className="mb-4 text-sm font-semibold text-ink">Billing</h2>
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}

      {billing && (
        <>
          <div className="mb-4 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-2">
            Current plan: <span className="font-semibold text-ink">{billing.plan.name}</span>
          </div>

          <div className="mb-4 overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-3">
                  <th className="px-3 py-2 font-medium">Resource</th>
                  <th className="px-3 py-2 font-medium">Used</th>
                  <th className="px-3 py-2 font-medium">Limit</th>
                </tr>
              </thead>
              <tbody>
                {QUOTA_KINDS.map((k) => {
                  const q = billing.quotas[k];
                  // "over" = strictly past the limit; at-limit (1/1) is fine. The
                  // backend `ok` means "room to add one more", so reusing it here
                  // wrongly flagged at-limit as over (#107).
                  const over = q.limit >= 0 && q.used > q.limit;
                  return (
                    <tr key={k} aria-label={`quota ${k}`} className="border-b border-line-soft last:border-0">
                      <td className="px-3 py-2 capitalize text-ink-2">{k}</td>
                      <td className="px-3 py-2 text-ink">{q.used}</td>
                      <td className="px-3 py-2 text-ink-3">
                        {fmtLimit(q.limit)}
                        {over && (
                          <span className="ml-2 rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-semibold text-danger">over</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {treasury && (
        <div className="mb-4 rounded-lg border border-line bg-surface p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Treasury & P&amp;L</h3>
            <span className="text-sm font-semibold text-ink">{usd(treasury.balanceCents)} <span className="text-[11px] font-normal text-ink-3">balance</span></span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-elevated px-2 py-1.5"><div className="text-[10px] uppercase text-ink-3">Revenue</div><div className="text-sm font-medium text-positive">{usd(treasury.pnl.revenueCents)}</div></div>
            <div className="rounded-lg bg-elevated px-2 py-1.5"><div className="text-[10px] uppercase text-ink-3">Cost</div><div className="text-sm font-medium text-warn">{usd(treasury.pnl.costCents)}</div></div>
            <div className="rounded-lg bg-elevated px-2 py-1.5"><div className="text-[10px] uppercase text-ink-3">Profit ({treasury.pnl.marginPct}%)</div><div className={`text-sm font-medium ${treasury.pnl.profitCents >= 0 ? "text-positive" : "text-danger"}`}>{usd(treasury.pnl.profitCents)}</div></div>
          </div>
          <p className="mt-2 text-[11px] text-ink-3">{treasury.profitGoal}</p>
          {treasury.decisions.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Recent gated payments</div>
              <ul className="space-y-1">
                {treasury.decisions.slice(0, 5).map((d) => (
                  <li key={d.id} className="flex items-center justify-between text-xs">
                    <span className="truncate text-ink-2">{d.tool} {usd(d.amountCents)}{d.recipient ? ` → ${d.recipient}` : ""}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${d.decision === "approve" ? "bg-positive/10 text-positive" : d.decision === "decline" ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn"}`}>{d.decision}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Plans</h3>
      <ul className="space-y-2">
        {plans.map((p) => {
          const isCurrent = billing?.plan.id === p.id;
          return (
            <li key={p.id} className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2">
              <div>
                <div className="text-sm font-medium text-ink">{p.name}</div>
                <div className="text-xs text-ink-3">
                  {fmtLimit(p.seatLimit)} seats · {fmtLimit(p.agentLimit)} agents · {fmtLimit(p.messageQuota)} messages · {fmtLimit(p.taskQuota)} tasks
                </div>
              </div>
              {isCurrent ? (
                <span className="rounded bg-elevated-2 px-2 py-1 text-xs text-ink-3">Current</span>
              ) : p.stripePriceId ? (
                <button
                  onClick={() => upgrade(p.id)}
                  disabled={busy !== null}
                  aria-label={`upgrade to ${p.name}`}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  Upgrade
                </button>
              ) : (
                <span className="rounded bg-elevated-2 px-2 py-1 text-xs text-ink-3">Contact sales</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
