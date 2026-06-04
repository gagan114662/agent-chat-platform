---
name: frontend-verify
description: Verify agent-chat-platform web UI (services/web) changes in a real browser. Run whenever a React/CSS/component change is made to services/web, in addition to the component tests.
---

# frontend-verify

Component tests (vitest + jsdom) cover rendering logic, but jsdom is not a browser. After a UI change,
run a real-browser pass with the gstack `/browse` harness. **Fix issues and re-verify before responding.**

## Step 0 — Component tests + build (always)
```bash
cd services/web && pnpm test && pnpm build
```

## Step 1 — Serve the UI
```bash
cd services/web && pnpm dev --port 5177 --strictPort   # Vite; proxies /threads + /ws → :8080
```
For a populated view, also bring up the backend (see `verify-acp` Step 2 + `services/app/README.md`)
and sign in. Without the backend you still get the shell + empty state (proves layout/styling).

## Step 2 — Browser checks via /browse
Use the gstack browse binary (resolve it: `$HOME/.claude/skills/gstack/browse/dist/browse`):
```bash
B=$HOME/.claude/skills/gstack/browse/dist/browse
$B goto http://localhost:5177/
$B screenshot /tmp/acp-ui.png        # then Read the PNG so it's visible
$B console --errors                  # JS/WS errors? (WS 500s are expected with no backend)
$B snapshot -i                       # interactive elements present (composer, sidebar, send)
```
Check: the shell renders (sidebar, header, composer), the change behaves as expected, no unexpected
console errors, no layout shift. For message kinds (chat/system/pr_card) the component tests assert
rendering; a live thread (backend up) confirms the streamed view.

## Step 3 — Clean up + report
Stop the dev server. Paste the test/build result and attach the screenshot path; note any console errors.
