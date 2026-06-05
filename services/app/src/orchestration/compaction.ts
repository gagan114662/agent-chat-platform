// #116 intentional context compaction: when a run's context grows long, keep the
// most recent turns verbatim and fold the older ones into a single summary entry,
// so the agent keeps working without unbounded context growth. Deterministic about
// WHAT to keep/fold; the actual summarization text is injected (an LLM call, or a
// simple marker by default) so this stays pure + testable.

export interface Msg { role: string; content: string; }

export interface CompactResult {
  kept: Msg[];
  compactedCount: number;
  summary?: string;
}

export interface CompactOpts {
  keepRecent: number;
  summarize?: (older: Msg[]) => string;
}

export function compactContext(msgs: Msg[], opts: CompactOpts): CompactResult {
  const keepRecent = Math.max(0, opts.keepRecent);
  if (msgs.length <= keepRecent) return { kept: msgs, compactedCount: 0 };
  const cut = msgs.length - keepRecent;
  const older = msgs.slice(0, cut);
  const recent = msgs.slice(cut);
  const summary = opts.summarize ? opts.summarize(older) : `[${older.length} earlier messages compacted]`;
  return { kept: [{ role: "system", content: summary }, ...recent], compactedCount: older.length, summary };
}
