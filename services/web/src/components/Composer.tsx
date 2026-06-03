import { useState } from "react";

export function Composer({ onSend }: { onSend: (body: string) => void }) {
  const [text, setText] = useState("");
  const submit = () => {
    const body = text.trim();
    if (!body) return;
    onSend(body);
    setText("");
  };
  return (
    <div className="border-t border-slate-200 bg-white p-3">
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Message #general — try @coder <intent>"
          rows={1}
          className="min-h-[40px] flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
        />
        <button
          onClick={submit}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Send
        </button>
      </div>
    </div>
  );
}
