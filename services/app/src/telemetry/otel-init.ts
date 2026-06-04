import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

// Build (don't start) a NodeSDK exporting traces to Honeycomb via OTLP/HTTP.
// Returns undefined when HONEYCOMB_API_KEY is unset (tracing stays a no-op).
//
// API-version note: @opentelemetry/resources@1.30.x does not export
// `resourceFromAttributes`, so we use `new Resource({...})`. `ATTR_SERVICE_NAME`
// is available in @opentelemetry/semantic-conventions@1.41.x and is used directly.
export function buildTelemetrySDK(): NodeSDK | undefined {
  const key = process.env.HONEYCOMB_API_KEY;
  if (!key) return undefined;
  return new NodeSDK({
    resource: new Resource({
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
