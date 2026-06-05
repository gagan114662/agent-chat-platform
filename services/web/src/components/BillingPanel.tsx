import { useEffect, useState } from "react";
import type { Billing, Plan, QuotaKind } from "../api.js";

const QUOTA_KINDS: QuotaKind[] = ["seats", "agents", "messages", "tasks"];

const fmtLimit = (limit: number) => (limit < 0 ? "∞" : String(limit));

// #85 billing panel: the org's current plan + a usage/quota table (seats/agents/
// messages/tasks: used vs limit, an "over" indicator) + an Upgrade button per
// purchasable plan that builds a Stripe Checkout Session and redirects to it.
// `redirect` is injectable so tests don't touch window.location.
export function BillingPanel({
  getBilling,
  listPlans,
  billingCheckout,
  redirect = (url: string) => { window.location.href = url; },
}: {
  getBilling: () => Promise<Billing>;
  listPlans: () => Promise<Plan[]>;
  billingCheckout: (planId: string) => Promise<{ url: string }>;
  redirect?: (url: string) => void;
}) {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBilling().then(setBilling).catch((e) => setError((e as Error).message));
    listPlans().then(setPlans).catch((e) => setError((e as Error).message));
  }, [getBilling, listPlans]);

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
      <h2 className="mb-4 text-sm font-semibold text-neutral-800">Billing</h2>
      {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

      {billing && (
        <>
          <div className="mb-4 rounded-lg border border-[#e7e7f0] bg-white px-3 py-2 text-sm text-neutral-700">
            Current plan: <span className="font-semibold text-neutral-900">{billing.plan.name}</span>
          </div>

          <div className="mb-4 overflow-hidden rounded-lg border border-[#e7e7f0] bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e7e7f0] text-left text-xs text-neutral-400">
                  <th className="px-3 py-2 font-medium">Resource</th>
                  <th className="px-3 py-2 font-medium">Used</th>
                  <th className="px-3 py-2 font-medium">Limit</th>
                </tr>
              </thead>
              <tbody>
                {QUOTA_KINDS.map((k) => {
                  const q = billing.quotas[k];
                  return (
                    <tr key={k} aria-label={`quota ${k}`} className="border-b border-[#f2f2f7] last:border-0">
                      <td className="px-3 py-2 capitalize text-neutral-700">{k}</td>
                      <td className="px-3 py-2 text-neutral-800">{q.used}</td>
                      <td className="px-3 py-2 text-neutral-500">
                        {fmtLimit(q.limit)}
                        {!q.ok && (
                          <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">over</span>
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

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Plans</h3>
      <ul className="space-y-2">
        {plans.map((p) => {
          const isCurrent = billing?.plan.id === p.id;
          return (
            <li key={p.id} className="flex items-center justify-between rounded-lg border border-[#e7e7f0] bg-white px-3 py-2">
              <div>
                <div className="text-sm font-medium text-neutral-800">{p.name}</div>
                <div className="text-xs text-neutral-400">
                  {fmtLimit(p.seatLimit)} seats · {fmtLimit(p.agentLimit)} agents · {fmtLimit(p.messageQuota)} messages · {fmtLimit(p.taskQuota)} tasks
                </div>
              </div>
              {isCurrent ? (
                <span className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-500">Current</span>
              ) : p.stripePriceId ? (
                <button
                  onClick={() => upgrade(p.id)}
                  disabled={busy !== null}
                  aria-label={`upgrade to ${p.name}`}
                  className="rounded-lg bg-[#5b5bd6] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#4a4ac4] disabled:opacity-50"
                >
                  Upgrade
                </button>
              ) : (
                <span className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-400">Contact sales</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
