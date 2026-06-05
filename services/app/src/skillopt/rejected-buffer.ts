import { editKey, type SkillEdit } from "./edit.js";

// #135 rejected-edit buffer: remember edits that failed validation (and the
// regression they caused) so the optimizer never proposes the same losing edit
// twice. Bounded memory of dead ends.

export interface RejectedEntry { key: string; regression: number; reason: string; }

export class RejectedBuffer {
  private entries = new Map<string, RejectedEntry>();

  has(edit: SkillEdit): boolean {
    return this.entries.has(editKey(edit));
  }

  add(edit: SkillEdit, regression: number, reason: string): void {
    this.entries.set(editKey(edit), { key: editKey(edit), regression, reason });
  }

  list(): RejectedEntry[] {
    return [...this.entries.values()];
  }

  get size(): number {
    return this.entries.size;
  }
}
