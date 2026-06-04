# Plan 10 — OTLP Trace Export → Honeycomb

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Checkbox steps.

**Design (author's call):** Register an OpenTelemetry NodeSDK in the app process with an OTLP/HTTP exporter to Honeycomb, env-gated on `HONEYCOMB_API_KEY`. Once registered, the existing `runFusionTraced` `fusion.run` spans (Plan 6) export automatically. Default (no key) → no SDK → no-op (unchanged; all existing tests green). The exporter config is testable without a key/network by separating build from start.

**Tech Stack:** TS + `@opentelemetry/sdk-node` + `@opentelemetry/exporter-trace-otlp-http` (+ resources, semantic-conventions). Branch `plan-10-honeycomb` (off `main`). Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`. **Never commit the API key** — env only.

---

## Task 0: `otel-init` (env-gated NodeSDK + Honeycomb exporter)

**Files:** Modify `services/app/package.json`; Create `services/app/src/telemetry/otel-init.ts`, `src/telemetry/otel-init.test.ts`

- [ ] **Step 1: deps** — add to `services/app/package.json` dependencies (versions compatible with `@opentelemetry/api@^1.9`; let pnpm resolve, report what it picks):
```json
    "@opentelemetry/sdk-node": "^0.57.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.57.0",
    "@opentelemetry/resources": "^1.30.0",
    "@opentelemetry/semantic-conventions": "^1.30.0"
```
`cd /Users/gaganarora/Desktop/my\ projects/agent-chat-platform && pnpm install`.

- [ ] **Step 2: failing test** `src/telemetry/otel-init.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { buildTelemetrySDK } from "./otel-init.js";

afterEach(() => { delete process.env.HONEYCOMB_API_KEY; });

describe("otel-init", () => {
  it("returns undefined when no Honeycomb key is set", () => {
    delete process.env.HONEYCOMB_API_KEY;
    expect(buildTelemetrySDK()).toBeUndefined();
  });
  it("builds an SDK when the key is set (no start, no network)", () => {
    process.env.HONEYCOMB_API_KEY = "dummy";
    const sdk = buildTelemetrySDK();
    expect(sdk).toBeDefined();
  });
});
```

- [ ] **Step 3:** run → FAIL. Then implement `src/telemetry/otel-init.ts`:
```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

// Build (don't start) a NodeSDK exporting traces to Honeycomb via OTLP/HTTP.
// Returns undefined when HONEYCOMB_API_KEY is unset (tracing stays a no-op).
export function buildTelemetrySDK(): NodeSDK | undefined {
  const key = process.env.HONEYCOMB_API_KEY;
  if (!key) return undefined;
  return new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "acp-app",
    }),
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? "https://api.honeycomb.io/v1/traces",
      headers: { "x-honeycomb-team": key },
    }),
  });
}

let sdk: NodeSDK | undefined;

// Build + start (registers the global tracer provider so runFusionTraced spans export).
export function startTelemetry(): NodeSDK | undefined {
  sdk = buildTelemetrySDK();
  sdk?.start();
  return sdk;
}

export async function stopTelemetry(): Promise<void> {
  await sdk?.shutdown();
  sdk = undefined;
}
```
> API-version note: if the installed `@opentelemetry/resources` lacks `resourceFromAttributes`, use `new Resource({ [ATTR_SERVICE_NAME]: ... })`; if `semantic-conventions` lacks `ATTR_SERVICE_NAME`, use `SemanticResourceAttributes.SERVICE_NAME`. Adapt to the installed API so it compiles + the test passes; report what you used.

- [ ] **Step 4:** `cd services/app && DATABASE_URL=postgres://acp:acp@localhost:5432/acp pnpm test -- telemetry/otel-init` → PASS; whole suite + tsc clean.
- [ ] **Step 5:** commit:
```bash
git add services/app/src/telemetry/otel-init.ts services/app/src/telemetry/otel-init.test.ts services/app/package.json ../../pnpm-lock.yaml
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(app): OTLP→Honeycomb telemetry init (env-gated)"
```
(Lockfile is at repo root.)

---

## Task 1: Start telemetry in the server entrypoint

**Files:** Modify `services/app/src/server.ts`

- [ ] **Step 1:** at the top of the CLI-entry block in `server.ts` (the `if (process.argv[1]...)` guard), start telemetry BEFORE building the server, and stop it on shutdown. Add the import and:
```ts
import { startTelemetry, stopTelemetry } from "./telemetry/otel-init.js";
// ...inside the CLI entry guard, FIRST line:
  startTelemetry(); // exports traces to Honeycomb when HONEYCOMB_API_KEY is set
  const app = await buildServer();
  const close = async () => { await stopTelemetry(); await app.close(); process.exit(0); };
  process.on("SIGTERM", close); process.on("SIGINT", close);
  await app.listen({ port: Number(process.env.PORT ?? 8080), host: "0.0.0.0" });
```
(Keep `buildServer`/listen behavior; just wrap with start/stop. `startTelemetry()` must run before any spans are created.)

- [ ] **Step 2:** `cd services/app && DATABASE_URL=postgres://acp:acp@localhost:5432/acp pnpm test && pnpm exec tsc --noEmit -p tsconfig.json` — all green (no key in tests → telemetry no-op; integration test unaffected).
- [ ] **Step 3:** commit:
```bash
git add services/app/src/server.ts
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(app): start Honeycomb telemetry in the server entrypoint"
```

---

## Self-Review
- Coverage: env-gated NodeSDK + Honeycomb OTLP exporter (T0), started in the entrypoint so `fusion.run` spans (Plan 6) export (T1).
- Backward-compat: no `HONEYCOMB_API_KEY` → `buildTelemetrySDK()` returns undefined → no provider → spans stay no-ops → every existing test unchanged. The exporter is built-but-not-started in the unit test (no network, no global-provider pollution).
- Security: the API key is read from env only; never logged, never committed.
- Deferred: metrics (a MeterProvider + Honeycomb metrics), trace context propagation across the Go sandbox-runner boundary, sampling config.

## Definition of Done (10)
App suite green (telemetry no-op without a key); tsc clean. With `HONEYCOMB_API_KEY` set, running the app (or the chat e2e) exports `fusion.run` traces to Honeycomb — confirmed by a live smoke (spans land in the `getfoolish/test` environment). Metrics + cross-service propagation remain follow-ups.
