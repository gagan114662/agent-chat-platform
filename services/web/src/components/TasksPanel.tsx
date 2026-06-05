import { useCallback, useEffect, useState } from "react";
import {
  TASK_PRIORITIES, TASK_STATES,
  type TaskDetail, type Task, type TaskComment, type TaskPriority, type TaskState,
} from "../api.js";

// #106 Tasks board: a Linear-style status board of the org's tasks (grouped into
// columns), with inline state moves. Selecting a card opens its detail (#81):
// priority/state edit, comments, relations.
const COLUMNS: { key: string; label: string; states: TaskState[] }[] = [
  { key: "todo", label: "To do", states: ["open", "backlog", "todo"] },
  { key: "in_progress", label: "In progress", states: ["in_progress"] },
  { key: "in_review", label: "In review", states: ["in_review"] },
  // #145: "merged" = code landed, outcome not yet verified — a distinct column
  // with a Verify action, so a merged PR isn't mistaken for a finished outcome.
  { key: "merged", label: "Landed · verify", states: ["merged"] },
  { key: "blocked", label: "Blocked", states: ["blocked"] },
  { key: "done", label: "Verified", states: ["done", "cancelled"] },
];

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  none: "text-ink-3", low: "text-ink-3",
  medium: "text-accent", high: "text-warn", urgent: "text-danger",
};

export function TasksPanel({
  initialTaskId,
  listTasks,
  getTask,
  updateTask,
  addTaskComment,
  getTaskDelegation,
}: {
  initialTaskId?: string;
  listTasks: () => Promise<Task[]>;
  getTask: (id: string) => Promise<TaskDetail>;
  updateTask: (id: string, patch: { priority?: TaskPriority; dueDate?: string | null; state?: TaskState }) => Promise<Task>;
  addTaskComment: (id: string, body: string) => Promise<TaskComment>;
  // #130: trace a task's delegation chain to the accountable human.
  getTaskDelegation?: (id: string) => Promise<{ chain: { byKind: string; byId: string; toKind: string; toId: string; at: string }[]; accountableHuman: string | null }>;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [deleg, setDeleg] = useState<{ chain: { byKind: string; byId: string; toKind: string; toId: string }[]; accountableHuman: string | null } | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listTasks().then(setTasks).catch((e) => setError((e as Error).message));
  }, [listTasks]);
  useEffect(() => { refresh(); }, [refresh]);

  const open = (id: string) => {
    setError(null); setDeleg(null);
    getTask(id).then(setDetail).catch((e) => { setDetail(null); setError((e as Error).message); });
    getTaskDelegation?.(id).then(setDeleg).catch(() => {});
  };
  useEffect(() => { if (initialTaskId) open(initialTaskId); /* eslint-disable-next-line */ }, [initialTaskId]);

  // Move a card to a new state (the column's representative state).
  const move = async (id: string, state: TaskState) => {
    setError(null);
    try {
      await updateTask(id, { state });
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, state } : t)));
      setDetail((d) => (d && d.task.id === id ? { ...d, task: { ...d.task, state } } : d));
    } catch (e) { setError((e as Error).message); }
  };

  const onChangePriority = async (priority: TaskPriority) => {
    if (!detail) return;
    try {
      const task = await updateTask(detail.task.id, { priority });
      setDetail((d) => (d ? { ...d, task } : d));
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
    } catch (e) { setError((e as Error).message); }
  };

  const onAddComment = async () => {
    if (!detail) return;
    const body = comment.trim();
    if (!body) return;
    try {
      const c = await addTaskComment(detail.task.id, body);
      setDetail((d) => (d ? { ...d, comments: [...d.comments, c] } : d));
      setComment("");
    } catch (e) { setError((e as Error).message); }
  };

  const colFor = (t: Task) => COLUMNS.find((c) => c.states.includes(t.state)) ?? COLUMNS[0];

  const card = (t: Task) => (
    <div key={t.id} className="rounded-lg border border-line bg-surface p-2.5 transition-colors hover:border-accent/50">
      <button onClick={() => open(t.id)} className="block w-full text-left">
        <div className="text-[13px] font-medium leading-snug text-ink">{t.title}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
          {t.priority !== "none" && <span className={`font-semibold uppercase ${PRIORITY_STYLE[t.priority]}`}>{t.priority}</span>}
          {t.assigneeId && <span>@{t.assigneeId}</span>}
          {t.dueDate && <span>· due {t.dueDate.slice(0, 10)}</span>}
        </div>
      </button>
      {t.state === "merged" && (
        <button onClick={() => move(t.id, "done")} title="The code landed — confirm the real outcome is achieved" className="mt-2 w-full rounded-md bg-positive/15 px-1.5 py-1 text-[11px] font-semibold text-positive hover:bg-positive/25">✓ Mark verified</button>
      )}
      <select
        aria-label={`move ${t.title}`}
        value={t.state}
        onChange={(e) => move(t.id, e.target.value as TaskState)}
        className="mt-2 w-full rounded-md border border-line bg-elevated px-1.5 py-1 text-[11px] text-ink-2 focus:border-accent focus:outline-none"
      >
        {TASK_STATES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
      </select>
    </div>
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {error && <p className="px-4 pt-3 text-xs text-danger">{error}</p>}
      {tasks.length === 0 ? (
        <p className="p-6 text-sm text-ink-3">No tasks yet. Tasks open automatically when an agent is mentioned, or via Goals → decompose.</p>
      ) : (
        <div className="flex flex-1 gap-3 overflow-x-auto p-4">
          {COLUMNS.map((col) => {
            const items = tasks.filter((t) => colFor(t).key === col.key);
            return (
              <div key={col.key} className="flex w-64 shrink-0 flex-col">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{col.label}</span>
                  <span className="rounded-full bg-elevated px-1.5 text-[10px] text-ink-3">{items.length}</span>
                </div>
                <div className="space-y-2">{items.map(card)}</div>
              </div>
            );
          })}
        </div>
      )}

      {detail && (
        <div className="max-h-[45%] overflow-y-auto border-t border-line bg-surface-2 p-4">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <div className="text-sm font-semibold text-ink">{detail.task.title}</div>
              <div className="mt-0.5 text-xs text-ink-3">{detail.task.id}</div>
            </div>
            <button onClick={() => setDetail(null)} className="rounded-lg px-2 py-1 text-xs text-ink-3 hover:bg-elevated hover:text-ink">Close</button>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1 text-xs text-ink-3">State
              <select aria-label="state" value={detail.task.state} onChange={(e) => move(detail.task.id, e.target.value as TaskState)} className="rounded-lg border border-line bg-elevated px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none">
                {TASK_STATES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1 text-xs text-ink-3">Priority
              <select aria-label="priority" value={detail.task.priority} onChange={(e) => onChangePriority(e.target.value as TaskPriority)} className="rounded-lg border border-line bg-elevated px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none">
                {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            {detail.task.dueDate && <span className="text-xs text-ink-3">due {detail.task.dueDate.slice(0, 10)}</span>}
          </div>
          {detail.relations.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Relations</div>
              <ul className="space-y-1">
                {detail.relations.map((r) => (
                  <li key={r.id} className="text-xs text-ink-2"><span className="font-medium">{r.relation}</span> → {r.toTaskId}</li>
                ))}
              </ul>
            </div>
          )}
          {deleg && deleg.chain.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Delegation chain</div>
              <div className="flex flex-wrap items-center gap-1 text-xs text-ink-2">
                {deleg.chain.map((l, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i === 0 && <span className={l.byKind === "human" ? "rounded bg-accent-soft px-1.5 py-0.5 text-accent" : "text-ink-3"}>{l.byKind === "human" ? "👤 " : "🤖 "}{l.byId}</span>}
                    <span className="text-ink-3">→</span>
                    <span className={l.toKind === "human" ? "rounded bg-accent-soft px-1.5 py-0.5 text-accent" : "rounded bg-elevated-2 px-1.5 py-0.5"}>{l.toKind === "human" ? "👤 " : "🤖 "}@{l.toId}</span>
                  </span>
                ))}
              </div>
              {deleg.accountableHuman && <div className="mt-1 text-[11px] text-ink-3">Accountable human: <span className="text-ink-2">{deleg.accountableHuman}</span></div>}
            </div>
          )}
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Comments</div>
          <ul className="space-y-2">
            {detail.comments.map((c) => (
              <li key={c.id} className="rounded-lg bg-elevated px-2 py-1.5">
                <div className="text-xs text-ink-3">{c.authorId}</div>
                <div className="text-sm text-ink">{c.body}</div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAddComment(); }} placeholder="Add a comment…" className="min-w-0 flex-1 rounded-lg border border-line bg-elevated px-2 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none" />
            <button onClick={onAddComment} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover">Comment</button>
          </div>
        </div>
      )}
    </div>
  );
}
