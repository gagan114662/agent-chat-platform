import type { Message } from "../types.js";
import { PrCard } from "./PrCard.js";

export function MessageItem({ message }: { message: Message }) {
  if (message.kind === "pr_card") {
    return <div className="px-4 py-1.5"><PrCard message={message} /></div>;
  }
  if (message.kind === "system") {
    return (
      <div className="px-4 py-1 text-center">
        <span className="text-xs text-slate-400">{message.body}</span>
      </div>
    );
  }
  // chat
  const isAgent = message.authorKind === "agent";
  return (
    <div className="flex gap-3 px-4 py-2">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${isAgent ? "bg-indigo-500" : "bg-slate-500"}`}>
        {isAgent ? "🤖" : message.authorId.slice(0, 2).toUpperCase()}
      </div>
      <div>
        <div className="text-xs font-medium text-slate-500">{isAgent ? "agent" : message.authorId}</div>
        <div className="text-sm whitespace-pre-wrap text-slate-800">{message.body}</div>
      </div>
    </div>
  );
}
