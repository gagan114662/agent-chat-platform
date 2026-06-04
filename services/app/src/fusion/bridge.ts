import { Client, Connection } from "@temporalio/client";
import { chatFusionWorkflow } from "./workflows.js";
import { TASK_QUEUE } from "./worker.js";
import type { RunFusionActivityInput } from "./activities.js";

export async function makeTemporalClient(address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233") {
  const connection = await Connection.connect({ address });
  return new Client({ connection, namespace: "default" });
}

// lazyTemporalClient returns a Client-shaped object that does NOT connect at
// construction — it connects (and memoizes) on the first workflow start. This
// lets the app boot and serve chat/auth/memory/tasks/UI even when Temporal is
// unreachable; only dispatching a fusion run needs the connection (and fails
// just that request if Temporal is down). server.ts uses this instead of
// awaiting a connection at startup, which would otherwise block boot.
export function lazyTemporalClient(address?: string): Client {
  let real: Client | undefined;
  const get = async () => (real ??= await makeTemporalClient(address));
  return {
    workflow: {
      start: async (...args: unknown[]) => {
        const c = await get();
        return (c.workflow.start as (...a: unknown[]) => unknown)(...args);
      },
    },
  } as unknown as Client;
}

export async function startRun(client: Client, workflowId: string, input: RunFusionActivityInput) {
  await client.workflow.start(chatFusionWorkflow, {
    taskQueue: TASK_QUEUE, workflowId, args: [input],
  });
}
