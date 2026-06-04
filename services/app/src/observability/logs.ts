// #95 — generic log ingestion primitives. Pure functions (no DB, no I/O) so
// they're trivially testable; the HTTP route (log-ingest-routes.ts) persists
// the results. Generalizes the Cloudflare-specific parser (#55): logs arrive
// from ANY source in ANY format (NDJSON / JSON array / plain text) and each
// record normalizes to a { level, message, raw } shape. Error-level records
// derive incidents (reusing the #55 incidents table, idempotent).

import { createHash } from "node:crypto";

// A normalized log record: a coarse level, a human message, and the original
// payload (an object for structured logs, the raw line string for text).
export interface LogRecord {
  level: string;
  message: string;
  raw: unknown;
}

// An error-derived incident, pre-persistence. `key` is the deterministic dedup
// key: combined with the orgId it forms the incident id so re-ingesting the
// same logs collapses (idempotent).
export interface LogIncident {
  key: string;
  severity: "low" | "medium" | "high";
  title: string;
  body: string;
}

const LEVEL_FIELDS = ["level", "severity", "lvl"] as const;
const MESSAGE_FIELDS = ["message", "msg", "text"] as const;

// Known coarse levels, longest/most-specific first so "fatal" wins over a bare
// substring match and we don't misclassify e.g. "information" as "info".
const LEVEL_TOKENS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

function str(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

// Normalize a free-form level token (e.g. "ERROR", "warning", "err") to one of
// our coarse buckets. Unknown tokens pass through lower-cased.
function normalizeLevel(token: string): string {
  const t = token.trim().toLowerCase();
  if (t === "warning") return "warn";
  if (t === "err") return "error";
  if (t === "critical" || t === "crit" || t === "emerg" || t === "alert") return "fatal";
  return t;
}

// Infer a level from a free-text line by scanning for a known level keyword.
function inferLevel(text: string): string {
  const upper = text.toUpperCase();
  for (const lvl of LEVEL_TOKENS) {
    if (upper.includes(lvl.toUpperCase())) return lvl;
  }
  return "info";
}

// Normalize one already-parsed structured record (object) → LogRecord.
function fromObject(o: Record<string, unknown>): LogRecord {
  let level: string | undefined;
  for (const f of LEVEL_FIELDS) {
    const v = str(o[f]);
    if (v !== undefined && v !== "") { level = normalizeLevel(v); break; }
  }
  let message: string | undefined;
  for (const f of MESSAGE_FIELDS) {
    const v = str(o[f]);
    if (v !== undefined) { message = v; break; }
  }
  if (message === undefined) message = JSON.stringify(o);
  if (level === undefined) level = inferLevel(message);
  return { level, message, raw: o };
}

// Normalize one plain-text line → LogRecord (level inferred from the text).
function fromText(line: string): LogRecord {
  return { level: inferLevel(line), message: line, raw: line };
}

// parseLogs — accept NDJSON (one JSON object per line), a JSON array, or plain
// text lines, and normalize each record to { level, message, raw }. Blank lines
// and malformed-but-unparseable lines are skipped gracefully (one bad line never
// drops the whole batch). contentType is a hint only; we sniff the body too so a
// mislabeled payload still parses.
export function parseLogs(body: string, contentType?: string): LogRecord[] {
  const text = body ?? "";
  if (text.trim() === "") return [];

  const ct = (contentType ?? "").toLowerCase();
  const trimmed = text.trim();

  // 1) JSON array (whole body) — either content-type says JSON, or it sniffs as
  //    an array. A JSON object per-line is handled by the NDJSON path below.
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        const out: LogRecord[] = [];
        for (const item of arr) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            out.push(fromObject(item as Record<string, unknown>));
          } else {
            const s = str(item);
            if (s !== undefined && s.trim() !== "") out.push(fromText(s));
          }
        }
        return out;
      }
    } catch {
      // not a valid JSON array — fall through to line parsing
    }
  }

  // 2) A single JSON object as the whole body (e.g. content-type application/json
  //    but not an array). Only when it's not multi-line NDJSON.
  if (ct.includes("json") && trimmed.startsWith("{") && !trimmed.includes("\n")) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        return [fromObject(obj as Record<string, unknown>)];
      }
    } catch {
      // fall through
    }
  }

  // 3) Line-oriented: NDJSON or plain text, decided per-line. A line that parses
  //    as a JSON object is structured; otherwise it's treated as text.
  const out: LogRecord[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    if (line.startsWith("{") || line.startsWith("[")) {
      try {
        const v = JSON.parse(line);
        if (v && typeof v === "object" && !Array.isArray(v)) {
          out.push(fromObject(v as Record<string, unknown>));
          continue;
        }
      } catch {
        // malformed JSON-looking line — skip gracefully
        continue;
      }
    }
    out.push(fromText(line));
  }
  return out;
}

const ERROR_LEVELS = new Set(["error", "fatal"]);

// Short stable hash for dedup keys.
function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

// A message "prefix": the leading words up to a separator (`:` or first 6 words),
// so variant errors that share a root (e.g. "db down: refused at 1.1.1.1" vs
// "...2.2.2.2") collapse into a single incident.
function messagePrefix(message: string): string {
  const beforeColon = message.split(":")[0];
  const base = beforeColon.trim() || message.trim();
  return base.split(/\s+/).slice(0, 6).join(" ").toLowerCase();
}

// errorIncidents — group error/fatal records into incidents, one per distinct
// message prefix. `key = "log-err:" + hash(prefix)` is deterministic so the HTTP
// route can build a stable incident id (idempotent re-ingest). fatal → high,
// error → medium (an error group containing any fatal escalates to high).
export function errorIncidents(records: LogRecord[]): LogIncident[] {
  const groups = new Map<string, { prefix: string; count: number; hasFatal: boolean; sample: string }>();
  for (const r of records) {
    if (!ERROR_LEVELS.has(r.level)) continue;
    const prefix = messagePrefix(r.message);
    const g = groups.get(prefix);
    if (g) {
      g.count++;
      if (r.level === "fatal") g.hasFatal = true;
    } else {
      groups.set(prefix, { prefix, count: 1, hasFatal: r.level === "fatal", sample: r.message });
    }
  }

  const out: LogIncident[] = [];
  for (const g of groups.values()) {
    const severity: LogIncident["severity"] = g.hasFatal ? "high" : "medium";
    const suffix = g.count > 1 ? ` (${g.count} occurrences)` : "";
    out.push({
      key: `log-err:${hash(g.prefix)}`,
      severity,
      title: `Log error: ${g.sample.slice(0, 80)}`,
      body: `Detected ${g.count} ${g.hasFatal ? "fatal/error" : "error"}-level log line(s)${suffix}. Sample: ${g.sample}`,
    });
  }
  return out;
}
