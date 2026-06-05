import { useEffect, useState } from "react";
import {
  TASK_PRIORITIES, TASK_STATES,
  type TaskDetail, type Task, type TaskComment, type TaskPriority, type TaskState,
} from "../api.js";

// #81 task detail panel: load a task by id, show priority/state with inline edit
// (dropdowns from the known values), the comments list + an add-comment box, and
// the relations. Lets the user load a different task id by lookup.
export function TasksPanel({
  initialTaskId,
  getTask,
  updateTask,
  addTaskComment,
}: {
  initialTaskId?: string;
  getTask: (id: string) => Promise<TaskDetail>;
  updateTask: (id: string, patch: { priority?: TaskPriority; dueDate?: string | null; state?: TaskState }) => Promise<Task>;
  addTaskComment: (id: string, body: string) => Promise<TaskComment>;
}) {
  const [lookup, setLookup] = useState(initialTaskId ?? "");
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = (id: string) => {
    if (!id.trim()) return;
    setError(null);
    getTask(id.trim())
      .then((d) => setDetail(d))
      .catch((e) => { setDetail(null); setError((e as Error).message); });
  };

  useEffect(() => {
    if (initialTaskId) load(initialTaskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTaskId]);

  const onChangeState = async (state: TaskState) => {
    if (!detail) return;
    setError(null);
    try {
      const task = await updateTask(detail.task.id, { state });
      setDetail((d) => (d ? { ...d, task } : d));
    } catch (e) { setError((e as Error).message); }
  };

  const onChangePriority = async (priority: TaskPriority) => {
    if (!detail) return;
    setError(null);
    try {
      const task = await updateTask(detail.task.id, { priority });
      setDetail((d) => (d ? { ...d, task } : d));
    } catch (e) { setError((e as Error).message); }
  };

  const onAddComment = async () => {
    if (!detail) return;
    const body = comment.trim();
    if (!body) return;
    setError(null);
    try {
      const c = await addTaskComment(detail.task.id, body);
      setDetail((d) => (d ? { ...d, comments: [...d.comments, c] } : d));
      setComment("");
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mb-4 flex gap-2">
        <input
          value={lookup}
          onChange={(e) => setLookup(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") load(lookup); }}
          placeholder="Task id"
          className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
        <button onClick={() => load(lookup)} className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover">Load</button>
      </div>

      {error && <p className="mb-3 text-xs text-danger">{error}</p>}

      {detail && (
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-surface p-3">
            <div className="text-sm font-semibold text-ink">{detail.task.title}</div>
            <div className="mt-1 text-xs text-ink-3">{detail.task.id}</div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1 text-xs text-ink-3">
                State
                <select
                  aria-label="state"
                  value={detail.task.state}
                  onChange={(e) => onChangeState(e.target.value as TaskState)}
                  className="rounded-lg border border-line px-2 py-1 text-xs focus:border-accent focus:outline-none"
                >
                  {TASK_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1 text-xs text-ink-3">
                Priority
                <select
                  aria-label="priority"
                  value={detail.task.priority}
                  onChange={(e) => onChangePriority(e.target.value as TaskPriority)}
                  className="rounded-lg border border-line px-2 py-1 text-xs focus:border-accent focus:outline-none"
                >
                  {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              {detail.task.dueDate && <span className="text-xs text-ink-3">due {detail.task.dueDate.slice(0, 10)}</span>}
            </div>
          </div>

          {detail.relations.length > 0 && (
            <div className="rounded-lg border border-line bg-surface p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Relations</div>
              <ul className="space-y-1">
                {detail.relations.map((r) => (
                  <li key={r.id} className="text-xs text-ink-2">
                    <span className="font-medium">{r.relation}</span> → {r.toTaskId}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-lg border border-line bg-surface p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Comments</div>
            <ul className="space-y-2">
              {detail.comments.map((c) => (
                <li key={c.id} className="rounded-lg bg-elevated px-2 py-1.5">
                  <div className="text-xs text-ink-3">{c.authorId}</div>
                  <div className="text-sm text-ink">{c.body}</div>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") onAddComment(); }}
                placeholder="Add a comment…"
                className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
              <button onClick={onAddComment} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-[#4a4ac4]">Comment</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
