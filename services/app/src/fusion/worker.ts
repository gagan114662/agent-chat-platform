import { Worker, NativeConnection } from "@temporalio/worker";
import { fileURLToPath } from "node:url";

export const TASK_QUEUE = "chat-fusion";

export async function startWorker(address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233") {
  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue: TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
    activities: { runChatFusionActivity: (await import("./activities.js")).runChatFusionActivity },
  });
  void worker.run();
  return worker;
}
