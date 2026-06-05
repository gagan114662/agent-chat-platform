import { useCallback, useEffect, useState } from "react";
import type { Business, BusinessDetail } from "../api.js";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

// #141/#142 Businesses: each business bundles a repo + live URL + P&L + CRM funnel
// + human-gated revenue (payment intents) and acquisition (campaigns). A workspace
// can hold many. Agents draft charges/outreach; a human approves them here.
export function BusinessesPanel({
  listBusinesses, createBusiness, getBusiness,
  createPaymentIntent, decidePaymentIntent, createCampaign, decideCampaign,
}: {
  listBusinesses: () => Promise<Business[]>;
  createBusiness: (name: string, repoId?: string) => Promise<Business>;
  getBusiness: (id: string) => Promise<BusinessDetail>;
  createPaymentIntent: (id: string, amountCents: number, customer: string) => Promise<unknown>;
  decidePaymentIntent: (intentId: string, approve: boolean) => Promise<unknown>;
  createCampaign: (id: string, channel: string, audience: string, body: string) => Promise<unknown>;
  decideCampaign: (campaignId: string, approve: boolean, costCents?: number) => Promise<unknown>;
}) {
  const [list, setList] = useState<Business[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<BusinessDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [amt, setAmt] = useState(""); const [cust, setCust] = useState("");
  const [aud, setAud] = useState(""); const [chan, setChan] = useState("email");

  const refreshList = useCallback(() => { listBusinesses().then(setList).catch((e) => setError((e as Error).message)); }, [listBusinesses]);
  useEffect(() => { refreshList(); }, [refreshList]);
  const open = useCallback((id: string) => { setSel(id); getBusiness(id).then(setDetail).catch((e) => setError((e as Error).message)); }, [getBusiness]);
  const reload = () => sel && open(sel);

  const wrap = (fn: () => Promise<unknown>) => async () => { setError(null); try { await fn(); reload(); refreshList(); } catch (e) { setError((e as Error).message); } };

  const inputCls = "min-w-0 rounded-lg border border-line bg-elevated px-2 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none";

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-56 shrink-0 overflow-y-auto border-r border-line p-3">
        <div className="mb-2 text-sm font-semibold text-ink">Businesses</div>
        <div className="mb-3 space-y-1">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="new business name" className={`w-full ${inputCls}`} />
          <button onClick={wrap(async () => { if (name.trim()) { await createBusiness(name.trim()); setName(""); } })} disabled={!name.trim()} className="w-full rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50">Create business</button>
        </div>
        <ul className="space-y-1">
          {list.map((b) => (
            <li key={b.id}><button onClick={() => open(b.id)} className={`w-full truncate rounded-lg px-2 py-1.5 text-left text-sm ${sel === b.id ? "bg-elevated-2 text-ink" : "text-ink-2 hover:bg-elevated"}`}>{b.name}</button></li>
          ))}
          {list.length === 0 && <li className="px-2 py-1 text-xs text-ink-3">No businesses yet. Each one bundles a repo (#139), a live URL (#140), its P&amp;L, and its customers.</li>}
        </ul>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {error && <p className="mb-3 text-xs text-danger">{error}</p>}
        {!detail && <div className="text-sm text-ink-3">Select a business to see its P&amp;L, funnel, revenue, and acquisition.</div>}
        {detail && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-ink">{detail.business.name} {detail.business.liveUrl && <a href={detail.business.liveUrl} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">live ↗</a>}</h2>

            {/* P&L */}
            <div className="rounded-lg border border-line bg-surface p-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Profit &amp; Loss</div>
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="text-ink-2">Revenue <span className="font-medium text-ink">{money(detail.pnl.revenueCents)}</span></span>
                <span className="text-ink-2">Cost <span className="font-medium text-ink">{money(detail.pnl.costCents)}</span></span>
                <span className="text-ink-2">Net <span className={`font-semibold ${detail.pnl.netCents >= 0 ? "text-positive" : "text-danger"}`}>{money(detail.pnl.netCents)}</span></span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${detail.pnl.profitable ? "bg-positive/15 text-positive" : "bg-elevated-2 text-ink-3"}`}>{detail.pnl.profitable ? "Profitable" : "Not yet profitable"}</span>
              </div>
            </div>

            {/* Funnel */}
            <div className="rounded-lg border border-line bg-surface p-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Funnel</div>
              <div className="flex gap-4 text-sm text-ink-2">
                <span>Visitors <span className="font-medium text-ink">{detail.funnel.visitor}</span></span>
                <span>Signups <span className="font-medium text-ink">{detail.funnel.signup}</span></span>
                <span>Customers <span className="font-medium text-ink">{detail.funnel.customer}</span></span>
              </div>
            </div>

            {/* Revenue (human-gated) */}
            <div className="rounded-lg border border-line bg-surface p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Revenue — charge a customer (human-approved)</div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <input value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="amount ($)" className={`w-24 ${inputCls}`} />
                <input value={cust} onChange={(e) => setCust(e.target.value)} placeholder="customer (email)" className={`flex-1 ${inputCls}`} />
                <button onClick={wrap(async () => { const c = Math.round(parseFloat(amt) * 100); if (c > 0) { await createPaymentIntent(detail.business.id, c, cust.trim()); setAmt(""); setCust(""); } })} className="rounded-lg border border-line px-2 py-1.5 text-xs text-ink-2 hover:bg-elevated-2 hover:text-ink">Draft charge</button>
              </div>
              <ul className="space-y-1">
                {detail.paymentIntents.map((pi) => (
                  <li key={pi.id} className="flex items-center justify-between gap-2 text-xs text-ink-2">
                    <span className="truncate">{money(pi.amountCents)} · {pi.customer || "—"} · <span className={pi.state === "approved" ? "text-positive" : pi.state === "declined" ? "text-danger" : "text-ink-3"}>{pi.state}</span></span>
                    {pi.state === "pending" && (
                      <span className="flex shrink-0 gap-1">
                        <button onClick={wrap(() => decidePaymentIntent(pi.id, true))} className="rounded bg-positive/15 px-2 py-0.5 text-[11px] text-positive hover:bg-positive/25">Approve</button>
                        <button onClick={wrap(() => decidePaymentIntent(pi.id, false))} className="rounded border border-line px-2 py-0.5 text-[11px] text-ink-3 hover:bg-elevated-2">Decline</button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] text-ink-3">Agents draft charges; a human approves. Approval books revenue + marks the payer a customer. Real processor (Stripe) connect + payout is operator-only — no real money moves here.</p>
            </div>

            {/* Acquisition (human-gated) */}
            <div className="rounded-lg border border-line bg-surface p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Acquisition — reach customers (human-approved)</div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <select value={chan} onChange={(e) => setChan(e.target.value)} className={inputCls}><option value="email">email</option><option value="social">social</option><option value="ads">ads</option></select>
                <input value={aud} onChange={(e) => setAud(e.target.value)} placeholder="audience (comma-separated)" className={`flex-1 ${inputCls}`} />
                <button onClick={wrap(async () => { if (aud.trim()) { await createCampaign(detail.business.id, chan, aud.trim(), ""); setAud(""); } })} className="rounded-lg border border-line px-2 py-1.5 text-xs text-ink-2 hover:bg-elevated-2 hover:text-ink">Draft campaign</button>
              </div>
              <ul className="space-y-1">
                {detail.campaigns.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-xs text-ink-2">
                    <span className="truncate">{c.channel} · {c.audience || "—"} · <span className={c.state === "sent" ? "text-positive" : c.state === "declined" ? "text-danger" : "text-ink-3"}>{c.state}{c.state === "sent" ? ` (${c.sentCount})` : ""}</span></span>
                    {c.state === "pending" && (
                      <span className="flex shrink-0 gap-1">
                        <button onClick={wrap(() => decideCampaign(c.id, true))} className="rounded bg-positive/15 px-2 py-0.5 text-[11px] text-positive hover:bg-positive/25">Approve &amp; send</button>
                        <button onClick={wrap(() => decideCampaign(c.id, false))} className="rounded border border-line px-2 py-0.5 text-[11px] text-ink-3 hover:bg-elevated-2">Decline</button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] text-ink-3">Agents draft outreach; a human approves before anything sends. Approval seeds the funnel + books cost. Real email/ads delivery needs the operator's connected accounts.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
