// Cloudflare Logpush ingestion: parse NDJSON batches and run simple detection
// over them, producing incidents. Pure functions (no DB, no I/O) so they're
// trivially testable; the HTTP route (ingest-routes.ts) persists the results.
//
// Cloudflare datasets vary in field names (HTTP requests / firewall events use
// `Action`; audit logs use `ActionType`), so matching is intentionally tolerant
// — we look across a few common keys, case-insensitively.

// A detected incident, pre-persistence. `key` is the deterministic dedup key:
// combined with the orgId it forms the incident id (`${orgId}:${key}`) so
// re-ingesting the same batch collapses (idempotent).
export interface DetectedIncident {
  key: string;
  severity: "low" | "medium" | "high";
  title: string;
  body: string;
  raw: unknown;
}

export interface DetectOpts {
  // Window label used in the aggregated WAF incident key. When omitted we fall
  // back to the current UTC hour so blocks cluster per hour by default.
  window?: string;
}

// Split NDJSON into records, JSON.parsing each non-empty line. Malformed lines
// are skipped (not fatal) so one bad line never drops a whole batch.
export function parseLogpush(ndjson: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of ndjson.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const v = JSON.parse(trimmed);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        out.push(v as Record<string, unknown>);
      }
    } catch {
      // malformed line — skip
    }
  }
  return out;
}

// Actions (case-insensitive) that count as a WAF/firewall block.
const BLOCK_ACTIONS = new Set(["block", "challenge", "jschallenge", "drop"]);
// Substrings (case-insensitive) that mark a sensitive audit action.
const SENSITIVE_AUDIT = ["delete", "token", "role"];

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

// Pull the "action" of a record across the common Cloudflare key variants.
function actionOf(r: Record<string, unknown>): string | undefined {
  return str(r["Action"]) ?? str(r["action"]);
}

// Pull the "audit action type" across the common variants.
function auditActionOf(r: Record<string, unknown>): string | undefined {
  return str(r["ActionType"]) ?? str(r["actionType"]) ?? str(r["action"]);
}

// Pull a per-record id for the deterministic audit incident key.
function recordId(r: Record<string, unknown>): string | undefined {
  return str(r["id"]) ?? str(r["ID"]) ?? str(r["RayID"]) ?? str(r["RayId"]) ?? str(r["EventID"]);
}

function defaultWindow(): string {
  // current UTC hour, e.g. "2026-06-04T17"
  return new Date().toISOString().slice(0, 13);
}

// Run detection rules over parsed records → incidents.
export function detectIncidents(
  records: Record<string, unknown>[],
  opts?: DetectOpts,
): DetectedIncident[] {
  const incidents: DetectedIncident[] = [];

  // Rule 1 — WAF/firewall blocks: aggregate into ONE incident when count >= threshold.
  const threshold = Math.max(1, Number(process.env.ACP_WAF_BLOCK_THRESHOLD ?? "1") || 1);
  const blocked = records.filter((r) => {
    const a = actionOf(r);
    return a !== undefined && BLOCK_ACTIONS.has(a.toLowerCase());
  });
  if (blocked.length >= threshold) {
    const window = opts?.window ?? defaultWindow();
    incidents.push({
      key: `cf-waf:${window}`,
      severity: "medium",
      title: `WAF blocked ${blocked.length} requests`,
      body: `Cloudflare WAF/firewall blocked ${blocked.length} request(s) in window ${window}.`,
      raw: { window, count: blocked.length, samples: blocked.slice(0, 10) },
    });
  }

  // Rule 2 — sensitive audit actions: one HIGH incident each.
  for (const r of records) {
    const a = auditActionOf(r);
    if (!a) continue;
    const lower = a.toLowerCase();
    if (!SENSITIVE_AUDIT.some((s) => lower.includes(s))) continue;
    const id = recordId(r) ?? a;
    incidents.push({
      key: `cf-audit:${id}`,
      severity: "high",
      title: `Sensitive audit action: ${a}`,
      body: `Cloudflare audit log recorded a sensitive action "${a}".`,
      raw: r,
    });
  }

  return incidents;
}
