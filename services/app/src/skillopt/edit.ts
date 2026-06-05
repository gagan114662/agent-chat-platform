// #134 bounded atomic skill edits. A skill document is optimized by SMALL, atomic
// operations (append/insert/replace/delete) within a learning-rate budget, and a
// PROTECTED CORE (a marked region) is slow-update — it can't be touched by an edit.
// This keeps optimization stable (no large blind rewrites, no clobbering the core).

export type EditOp = "append" | "insert" | "replace" | "delete";

export interface SkillEdit {
  op: EditOp;
  text?: string;   // append/insert/replace inserted text
  at?: number;     // insert position (char offset)
  find?: string;   // replace/delete target substring (first match)
}

export interface EditBudget { maxChars: number; }

// The protected core is the region between these markers (inclusive) — slow-update.
export interface ProtectedCore { open: string; close: string; }

export interface EditResult { ok: boolean; doc?: string; reason?: string; changedChars: number; }

function coreRange(doc: string, core?: ProtectedCore): [number, number] | null {
  if (!core) return null;
  const a = doc.indexOf(core.open);
  if (a < 0) return null;
  const b = doc.indexOf(core.close, a + core.open.length);
  if (b < 0) return null;
  return [a, b + core.close.length];
}

function touchesCore(start: number, end: number, range: [number, number] | null): boolean {
  if (!range) return false;
  return start < range[1] && end > range[0];
}

export function applyEdit(doc: string, edit: SkillEdit, budget: EditBudget, core?: ProtectedCore): EditResult {
  const range = coreRange(doc, core);
  let next: string;
  let changed = 0;
  let editStart = doc.length;
  let editEnd = doc.length;

  switch (edit.op) {
    case "append": {
      const t = edit.text ?? "";
      next = doc + t; changed = t.length; editStart = doc.length; editEnd = doc.length;
      break;
    }
    case "insert": {
      const at = Math.max(0, Math.min(edit.at ?? doc.length, doc.length));
      const t = edit.text ?? "";
      next = doc.slice(0, at) + t + doc.slice(at); changed = t.length; editStart = at; editEnd = at;
      break;
    }
    case "replace": {
      const idx = edit.find ? doc.indexOf(edit.find) : -1;
      if (idx < 0) return { ok: false, reason: "replace target not found", changedChars: 0 };
      const t = edit.text ?? "";
      next = doc.slice(0, idx) + t + doc.slice(idx + edit.find!.length);
      changed = Math.abs(t.length - edit.find!.length) + Math.min(t.length, edit.find!.length);
      editStart = idx; editEnd = idx + edit.find!.length;
      break;
    }
    case "delete": {
      const idx = edit.find ? doc.indexOf(edit.find) : -1;
      if (idx < 0) return { ok: false, reason: "delete target not found", changedChars: 0 };
      next = doc.slice(0, idx) + doc.slice(idx + edit.find!.length);
      changed = edit.find!.length; editStart = idx; editEnd = idx + edit.find!.length;
      break;
    }
  }

  if (touchesCore(editStart, editEnd, range)) {
    return { ok: false, reason: "edit touches the protected core", changedChars: changed };
  }
  if (changed > budget.maxChars) {
    return { ok: false, reason: `edit changes ${changed} chars > budget ${budget.maxChars}`, changedChars: changed };
  }
  return { ok: true, doc: next, changedChars: changed };
}

// A stable key for an edit, used by the rejected-edit buffer (#135).
export function editKey(edit: SkillEdit): string {
  return `${edit.op}|${edit.at ?? ""}|${edit.find ?? ""}|${edit.text ?? ""}`;
}
