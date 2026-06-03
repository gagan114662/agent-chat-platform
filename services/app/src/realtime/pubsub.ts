import type postgres from "postgres";
import { THREAD_CHANNEL } from "../fusion/events.js";

type Handler = (payload: { threadId: string; message: unknown }) => void;

export class ThreadPubSub {
  private subs = new Map<string, Set<Handler>>();
  constructor(private readonly sql: postgres.Sql) {}

  async start() {
    await this.sql.listen(THREAD_CHANNEL, (raw) => {
      const payload = JSON.parse(raw) as { threadId: string; message: unknown };
      for (const h of this.subs.get(payload.threadId) ?? []) h(payload);
    });
  }
  subscribe(threadId: string, h: Handler) {
    const set = this.subs.get(threadId) ?? new Set();
    set.add(h); this.subs.set(threadId, set);
    return () => set.delete(h);
  }
}
