// #116 agent heartbeats: long-running agent runs emit periodic beats; the
// orchestrator detects ones that have gone silent past a timeout so they can be
// surfaced (Activity) / retried / failed instead of hanging forever. Pure +
// testable — the caller supplies the beat table + clock (no Date.now() here).

export interface Beat { id: string; lastBeatMs: number; }

// stalledRuns returns the ids whose last beat is older than `timeoutMs` before now.
export function stalledRuns(beats: Beat[], nowMs: number, timeoutMs: number): string[] {
  return beats.filter((b) => nowMs - b.lastBeatMs > timeoutMs).map((b) => b.id);
}

// isAlive: a run is alive if it beat within the timeout window.
export function isAlive(beat: Beat | undefined, nowMs: number, timeoutMs: number): boolean {
  if (!beat) return false;
  return nowMs - beat.lastBeatMs <= timeoutMs;
}
