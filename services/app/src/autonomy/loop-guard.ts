import { createHash } from "node:crypto";

// #149.1 Loop-Guard. Autonomous agents at machine speed can silently burn money in
// an infinite loop. LoopGuard tracks each loop's trajectory INDEPENDENTLY of the
// agent's own memory and trips on two signals:
//   - iteration cap: more than `maxIterations` steps for one key → halt for a human;
//   - semantic repetition: the last `repeatWindow` actions are identical (same
//     action + params) → halt immediately (a stuck "call the same tool again" loop).
// On a trip the caller suspends + snapshots and requires a human resume.

export interface GuardVerdict { trip: boolean; reason: string; iterations: number }

export function fingerprint(action: string, params?: unknown): string {
  const raw = `${action}::${params == null ? "" : JSON.stringify(params)}`;
  return createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

export class LoopGuard {
  private trail = new Map<string, string[]>();
  constructor(private readonly maxIterations = 15, private readonly repeatWindow = 3) {}

  // record one loop step for `key` and decide whether to trip.
  check(key: string, fp: string): GuardVerdict {
    const fps = this.trail.get(key) ?? [];
    fps.push(fp);
    this.trail.set(key, fps);
    const iterations = fps.length;
    if (iterations > this.maxIterations) {
      return { trip: true, reason: `iteration cap exceeded (${iterations} > ${this.maxIterations}) — needs human`, iterations };
    }
    const last = fps.slice(-this.repeatWindow);
    if (last.length === this.repeatWindow && last.every((f) => f === last[0])) {
      return { trip: true, reason: `repeated the same action ${this.repeatWindow}× — stuck loop, needs human`, iterations };
    }
    return { trip: false, reason: "ok", iterations };
  }

  // convenience: fingerprint + check in one call.
  step(key: string, action: string, params?: unknown): GuardVerdict {
    return this.check(key, fingerprint(action, params));
  }

  iterations(key: string): number { return this.trail.get(key)?.length ?? 0; }
  reset(key?: string): void { if (key) this.trail.delete(key); else this.trail.clear(); }
}
