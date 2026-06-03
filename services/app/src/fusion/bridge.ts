import { Client, Connection } from "@temporalio/client";
import { chatFusionWorkflow } from "./workflows.js";
import { TASK_QUEUE } from "./worker.js";
import type { RunFusionActivityInput } from "./activities.js";

export async function makeTemporalClient(address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233") {
  const connection = await Connection.connect({ address });
  return new Client({ connection, namespace: "default" });
}

export async function startRun(client: Client, workflowId: string, input: RunFusionActivityInput) {
  await client.workflow.start(chatFusionWorkflow, {
    taskQueue: TASK_QUEUE, workflowId, args: [input],
  });
}
