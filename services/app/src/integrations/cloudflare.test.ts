import { describe, it, expect } from "vitest";
import { parseLogpush, detectIncidents } from "./cloudflare.js";

describe("parseLogpush", () => {
  it("parses each non-empty NDJSON line and skips malformed/blank lines", () => {
    const ndjson = [
      `{"Action":"block","ClientIP":"1.2.3.4"}`,
      ``,
      `{"Action":"allow"}`,
      `not-json-here`,
      `   `,
      `{"Action":"challenge"}`,
    ].join("\n");
    const records = parseLogpush(ndjson);
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({ Action: "block" });
    expect(records[2]).toMatchObject({ Action: "challenge" });
  });

  it("returns [] for empty input", () => {
    expect(parseLogpush("")).toEqual([]);
    expect(parseLogpush("\n\n")).toEqual([]);
  });
});

describe("detectIncidents", () => {
  it("aggregates WAF/firewall blocks into ONE medium incident with the count", () => {
    const records = [
      { Action: "block", ClientIP: "1.1.1.1" },
      { Action: "BLOCK", ClientIP: "2.2.2.2" },
      { action: "challenge", ClientIP: "3.3.3.3" },
      { Action: "allow", ClientIP: "9.9.9.9" }, // benign — ignored
    ];
    const incidents = detectIncidents(records, { window: "2026-06-04T00:00" });
    const waf = incidents.filter((i) => i.key.startsWith("cf-waf:"));
    expect(waf).toHaveLength(1);
    expect(waf[0].severity).toBe("medium");
    expect(waf[0].title).toBe("WAF blocked 3 requests");
    expect(waf[0].key).toBe("cf-waf:2026-06-04T00:00");
  });

  it("respects ACP_WAF_BLOCK_THRESHOLD (no incident below threshold)", () => {
    const prev = process.env.ACP_WAF_BLOCK_THRESHOLD;
    process.env.ACP_WAF_BLOCK_THRESHOLD = "5";
    try {
      const records = [{ Action: "block" }, { Action: "drop" }];
      const incidents = detectIncidents(records, { window: "w1" });
      expect(incidents.filter((i) => i.key.startsWith("cf-waf:"))).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.ACP_WAF_BLOCK_THRESHOLD;
      else process.env.ACP_WAF_BLOCK_THRESHOLD = prev;
    }
  });

  it("raises a HIGH incident per sensitive audit action (delete/token/role)", () => {
    const records = [
      { ActionType: "user.delete", id: "a1" },
      { action: "api_token.create", id: "a2" },
      { ActionType: "role.update", RayID: "a3" },
      { ActionType: "login", id: "benign" }, // not sensitive — ignored
    ];
    const incidents = detectIncidents(records);
    const audit = incidents.filter((i) => i.key.startsWith("cf-audit:"));
    expect(audit).toHaveLength(3);
    for (const a of audit) expect(a.severity).toBe("high");
    // deterministic, per-record dedup key uses the record id
    expect(audit.map((a) => a.key).sort()).toEqual([
      "cf-audit:a1", "cf-audit:a2", "cf-audit:a3",
    ]);
  });

  it("mixed batch: 3 blocks + 1 benign + 1 delete audit → one WAF + one audit", () => {
    const ndjson = [
      `{"Action":"block","ClientIP":"1.1.1.1"}`,
      `{"Action":"block","ClientIP":"2.2.2.2"}`,
      `{"Action":"block","ClientIP":"3.3.3.3"}`,
      `{"Action":"allow","ClientIP":"9.9.9.9"}`,
      `garbage-line`,
      `{"ActionType":"token.delete","id":"audit-1"}`,
    ].join("\n");
    const incidents = detectIncidents(parseLogpush(ndjson), { window: "win" });
    const waf = incidents.filter((i) => i.key.startsWith("cf-waf:"));
    const audit = incidents.filter((i) => i.key.startsWith("cf-audit:"));
    expect(waf).toHaveLength(1);
    expect(waf[0].title).toBe("WAF blocked 3 requests");
    expect(audit).toHaveLength(1);
    expect(audit[0].key).toBe("cf-audit:audit-1");
    expect(audit[0].severity).toBe("high");
  });
});
