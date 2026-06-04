import { trace, type Tracer } from "@opentelemetry/api";

export const TRACER_NAME = "acp-orchestrator";

// Returns the global tracer; a no-op unless a TracerProvider is registered
// (so production wires an exporter, tests register an in-memory provider, and
// plain unit tests pay nothing).
export function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}
