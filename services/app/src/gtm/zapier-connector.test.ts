import { describe, it, expect, vi } from "vitest";
import { ZapierConnector } from "./zapier-connector.js";
import type { GtmAction } from "./runner.js";

const action: GtmAction = { fn: "marketing", skill: "mega-campaign-generator", actionKind: "outreach", summary: "push", payload: { offer: "x", cta: "https://acp-convene.fly.dev/public/offer/o1" }, audienceSize: 3 };

describe("ZapierConnector (distribution rail)", () => {
  it("POSTs the action to the configured URL with auth and reports sent + reach", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const c = new ZapierConnector("https://hooks.zapier.test/x", "Bearer z", fetchImpl as unknown as typeof fetch);
    const res = await c.deliver(action);
    expect(res).toEqual({ sent: true, reach: 3 });
    const [url, init] = (fetchImpl.mock.calls[0] ?? []) as unknown as [string, RequestInit & { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://hooks.zapier.test/x");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer z");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ function: "marketing", skill: "mega-campaign-generator", action_kind: "outreach", cta: action.payload.cta });
  });

  it("throws on a non-2xx so the motion records it as not-sent", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const c = new ZapierConnector("https://hooks.zapier.test/x", undefined, fetchImpl as unknown as typeof fetch);
    await expect(c.deliver(action)).rejects.toThrow(/zapier 500/);
  });
});
