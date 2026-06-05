import { and, asc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { messages } from "../db/schema.js";

// A loaded message row, narrowed to what a summarizer needs. The full row is
// passed through so an LLM summarizer can read metadata/kind too.
export type SummarizableMessage = typeof messages.$inferSelect;

// A summarizer turns a thread's messages into a recap string. Injectable so an
// LLM-backed summarizer can replace the deterministic default later without any
// route/DB changes (#77).
export type Summarizer = (msgs: SummarizableMessage[]) => string;

function snippet(s: string, max = 120): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

// The deterministic, rule-based default summarizer. Counts messages + distinct
// participants (split into humans/agents), surfaces the key event lines
// (pr_card / plan_card / system outcome messages), and quotes the latest
// message. Pure + deterministic so it's trivially testable and LLM-pluggable.
export const defaultSummarizer: Summarizer = (msgs) => {
  if (msgs.length === 0) return "No messages yet — nothing to summarize.";

  const humans = new Set<string>();
  const agents = new Set<string>();
  for (const m of msgs) {
    if (m.authorKind === "agent") agents.add(m.authorId);
    else humans.add(m.authorId);
  }
  const participants = humans.size + agents.size;

  const events: string[] = [];
  for (const m of msgs) {
    if (m.kind === "pr_card" || m.kind === "plan_card" || m.kind === "system") {
      events.push(snippet(m.body, 80));
    }
  }

  const last = msgs[msgs.length - 1];

  const parts = [
    `${msgs.length} message${msgs.length === 1 ? "" : "s"} from ${participants} participant${participants === 1 ? "" : "s"} (${humans.size} human${humans.size === 1 ? "" : "s"}/${agents.size} agent${agents.size === 1 ? "" : "s"}).`,
    events.length ? `Key events: ${events.join("; ")}.` : "Key events: none.",
    `Latest: ${snippet(last.body)}`,
  ];
  return parts.join(" ");
};

export interface SummarizeThreadInput {
  orgId: string;
  threadId: string;
  // Injectable summarizer (an LLM later); defaults to the deterministic rule-based one.
  summarize?: Summarizer;
}

// Loads a thread's messages (org-scoped, oldest→newest) and builds a recap via
// the injected summarizer (or the deterministic default). Org-scoping is applied
// at the query level so a cross-org thread id yields no messages (the caller still
// 404s before calling this when the thread itself is foreign).
export async function summarizeThread(db: DB, i: SummarizeThreadInput): Promise<{ summary: string }> {
  const msgs = await db.select().from(messages)
    .where(and(eq(messages.threadId, i.threadId), eq(messages.orgId, i.orgId)))
    .orderBy(asc(messages.createdAt), asc(messages.id));

  const summarize = i.summarize ?? defaultSummarizer;
  return { summary: summarize(msgs) };
}
