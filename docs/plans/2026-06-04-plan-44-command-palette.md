# Plan 44 — Command palette (⌘K) + slash commands (#60)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD. Web-only.

**Design (author's call):** conductor 0.14/0.39 — a ⌘K command palette + composer slash commands. A command **registry** (id/title/keywords/run) drives both: ⌘K opens a fuzzy-filter palette; typing `/` at the start of the composer opens it filtered to message-context actions. Commands map to existing app actions (switch channel/thread, new thread, new DM, open inbox/Activity, focus search). No backend — pure web wiring over existing api.ts functions.

**Branch** `plan-44-command-palette` (off `main`). Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: command registry + palette

**Files:** Create `services/web/src/lib/commands.ts`, `commands.test.ts`, `src/components/CommandPalette.tsx`, `CommandPalette.test.tsx`; Modify `src/App.tsx`
- [ ] **Step 1 — `commands.ts`:** `Command = { id: string; title: string; keywords?: string; run: () => void }`. `filterCommands(commands, query): Command[]` — case-insensitive match over `title`+`keywords`, ranked (prefix/word-start first). A `buildCommands(ctx)` factory that, given `{ channels, threads, actions }`, returns commands: one "Go to #<channel>" per channel, "Go to <thread>" per thread, "New thread", "New DM", "Open Activity (inbox)", "Search messages…" — each `run` calls the matching App action (`selectChannel`/`selectThread`/`openNewThread`/`openInbox`/`focusSearch`).
- [ ] **Step 2 — `CommandPalette.tsx`:** a modal (overlay + input + result list). Props `{ open, commands, onClose }`. Typing filters via `filterCommands`; ↑/↓ moves selection; Enter runs the selected command's `run()` then `onClose()`; Esc closes. Accessible (role="dialog", input autofocused).
- [ ] **Step 3 — `App.tsx`:** a global `keydown` listener: ⌘K / Ctrl+K toggles the palette `open`; build commands from current channels/threads + the App actions; render `<CommandPalette>`.
- [ ] **Step 4 — tests:** `commands.test.ts` — `filterCommands` matches title + keywords, ranks prefix matches first, empty query → all. `CommandPalette.test.tsx` — renders commands; typing filters; Enter on a result calls its `run`; Esc calls `onClose`. `cd services/web && pnpm test`. Commit `feat(web): command palette (⌘K) + command registry (#60)`.

## Task 1: composer slash commands

**Files:** `services/web/src/components/Composer.tsx`, `Composer.test.tsx`
- [ ] When the composer input starts with `/`, show a small inline hint listing matching slash commands from the same registry (filter by the text after `/`); pressing Enter on a slash command runs it (instead of sending the message) and clears the input; a normal (non-`/`) message sends as today. MVP commands surfaced: `/search <q>`, `/new`, `/dm`, `/inbox` (reuse the registry `run`s; `/search` passes its arg). Keep `@mention` send behavior unchanged for normal messages.
- [ ] Test: typing `/sea` shows the Search command; pressing Enter runs it (calls the injected handler) and does NOT post a message; a normal `hello @coder` still calls `send`. `cd services/web && pnpm test && pnpm build`. Commit `feat(web): composer slash commands (#60)`.

---

## Self-Review
- Delivers #60: a ⌘K palette + composer slash commands over a shared registry, mapping to existing nav/actions. Pure web; no backend change.
- Backward-compat: additive; normal message send unchanged; the palette is opt-in (⌘K). Existing web suites green.
- Note: run/PR-scoped slash commands (`/approve`, `/diff`, `/sync`) that act on a specific message are a follow-up (they need a target message context); this delivers the global palette + nav/search/new slash commands.

## Definition of Done (60)
web suite green + build. ⌘K opens a filterable command palette that runs nav/new/inbox/search actions; the composer surfaces slash commands when input starts with `/` and runs them instead of sending. Normal message send unchanged.
