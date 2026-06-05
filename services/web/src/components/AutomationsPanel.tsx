import { useEffect, useState } from "react";
import type { Automation, AutomationTrigger, AutomationAction } from "../api.js";

type TriggerType = "schedule" | "event";
type ActionType = "message" | "run" | "slack";

// Compact human summary of a trigger ("every 60m" / "on event X").
function triggerSummary(t: AutomationTrigger): string {
  return t.type === "schedule" ? `every ${t.everyMinutes}m` : `on ${t.event}`;
}

// Compact human summary of an action.
function actionSummary(a: AutomationAction): string {
  if (a.type === "message") return `message → ${a.threadId}`;
  if (a.type === "run") return `run ${a.agentId} → ${a.threadId}`;
  return `slack → ${a.channel}`;
}

// #98 automations panel: list automations (trigger/action summary + enabled
// toggle + delete) and a create form (name, trigger type schedule/event + its
// param, action type message/run/slack + its params). Mutations are admin-gated
// on the backend; the panel surfaces the resulting error if a member tries.
export function AutomationsPanel({
  listAutomations,
  createAutomation,
  setAutomationEnabled,
  deleteAutomation,
}: {
  listAutomations: () => Promise<Automation[]>;
  createAutomation: (name: string, trigger: AutomationTrigger, action: AutomationAction) => Promise<Automation>;
  setAutomationEnabled: (id: string, enabled: boolean) => Promise<void>;
  deleteAutomation: (id: string) => Promise<void>;
}) {
  const [rows, setRows] = useState<Automation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // create-form state
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<TriggerType>("schedule");
  const [everyMinutes, setEveryMinutes] = useState("60");
  const [event, setEvent] = useState("");
  const [actionType, setActionType] = useState<ActionType>("message");
  const [threadId, setThreadId] = useState("");
  const [body, setBody] = useState("");
  const [agentId, setAgentId] = useState("");
  const [intent, setIntent] = useState("");
  const [channel, setChannel] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    listAutomations().then(setRows).catch((e) => setError((e as Error).message));
  }, [listAutomations]);

  const toggle = async (a: Automation) => {
    setError(null);
    try {
      await setAutomationEnabled(a.id, !a.enabled);
      setRows((prev) => prev.map((x) => (x.id === a.id ? { ...x, enabled: !x.enabled } : x)));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (a: Automation) => {
    setError(null);
    try {
      await deleteAutomation(a.id);
      setRows((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const buildTrigger = (): AutomationTrigger =>
    triggerType === "schedule"
      ? { type: "schedule", everyMinutes: Number(everyMinutes) }
      : { type: "event", event: event.trim() };

  const buildAction = (): AutomationAction => {
    if (actionType === "message") return { type: "message", threadId: threadId.trim(), body: body.trim() };
    if (actionType === "run") return { type: "run", threadId: threadId.trim(), agentId: agentId.trim(), intent: intent.trim() };
    return { type: "slack", channel: channel.trim(), text: text.trim() };
  };

  const submit = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true); setError(null);
    try {
      const created = await createAutomation(n, buildTrigger(), buildAction());
      setRows((prev) => [created, ...prev]);
      setName(""); setEvent(""); setThreadId(""); setBody(""); setAgentId(""); setIntent(""); setChannel(""); setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const inputCls = "w-full rounded-lg border border-line px-2 py-1.5 text-sm focus:border-accent focus:outline-none";

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h2 className="mb-4 text-sm font-semibold text-ink">Automations</h2>
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}

      <div className="mb-4 space-y-2 rounded-lg border border-line bg-surface p-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Automation name" className={inputCls} />

        <div className="flex gap-2">
          <select aria-label="trigger type" value={triggerType} onChange={(e) => setTriggerType(e.target.value as TriggerType)} className={inputCls}>
            <option value="schedule">schedule</option>
            <option value="event">event</option>
          </select>
          {triggerType === "schedule" ? (
            <input aria-label="every minutes" type="number" value={everyMinutes} onChange={(e) => setEveryMinutes(e.target.value)} placeholder="every minutes" className={inputCls} />
          ) : (
            <input aria-label="event name" value={event} onChange={(e) => setEvent(e.target.value)} placeholder="event (e.g. outcome:checks_failed)" className={inputCls} />
          )}
        </div>

        <div className="space-y-2">
          <select aria-label="action type" value={actionType} onChange={(e) => setActionType(e.target.value as ActionType)} className={inputCls}>
            <option value="message">message</option>
            <option value="run">run</option>
            <option value="slack">slack</option>
          </select>
          {actionType === "message" && (
            <>
              <input aria-label="message thread id" value={threadId} onChange={(e) => setThreadId(e.target.value)} placeholder="thread id" className={inputCls} />
              <input aria-label="message body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="body" className={inputCls} />
            </>
          )}
          {actionType === "run" && (
            <>
              <input aria-label="run thread id" value={threadId} onChange={(e) => setThreadId(e.target.value)} placeholder="thread id" className={inputCls} />
              <input aria-label="run agent id" value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="agent id" className={inputCls} />
              <input aria-label="run intent" value={intent} onChange={(e) => setIntent(e.target.value)} placeholder="intent" className={inputCls} />
            </>
          )}
          {actionType === "slack" && (
            <>
              <input aria-label="slack channel" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="channel" className={inputCls} />
              <input aria-label="slack text" value={text} onChange={(e) => setText(e.target.value)} placeholder="text" className={inputCls} />
            </>
          )}
        </div>

        <button
          onClick={submit}
          disabled={busy || !name.trim()}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Create automation
        </button>
      </div>

      <ul className="space-y-2">
        {rows.map((a) => (
          <li key={a.id} className="rounded-lg border border-line bg-surface px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">{a.name}</div>
                <div className="text-xs text-ink-3">{triggerSummary(a.trigger)} · {actionSummary(a.action)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => toggle(a)}
                  aria-label={`${a.enabled ? "disable" : "enable"} ${a.name}`}
                  className={`rounded-lg px-2 py-1 text-xs font-medium ${a.enabled ? "bg-positive/10 text-positive hover:bg-positive/20" : "bg-elevated-2 text-ink-3 hover:bg-elevated"}`}
                >
                  {a.enabled ? "Enabled" : "Disabled"}
                </button>
                <button
                  onClick={() => remove(a)}
                  aria-label={`delete ${a.name}`}
                  className="rounded-lg border border-line px-2 py-1 text-xs text-ink-3 hover:bg-elevated-2"
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
