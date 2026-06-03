export function Sidebar() {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      <div className="px-4 py-4 text-sm font-semibold text-slate-700">Demo Workspace</div>
      <nav className="px-2 text-sm text-slate-600">
        <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Channels</div>
        <div className="rounded-md px-2 py-1.5 text-slate-500"># general</div>
        <div className="mt-1 rounded-md bg-indigo-100 px-2 py-1.5 font-medium text-indigo-700">Demo thread</div>
      </nav>
      <div className="mt-auto px-4 py-3 text-xs text-slate-400">signed in as m1 · org o1 (dev stub)</div>
    </aside>
  );
}
