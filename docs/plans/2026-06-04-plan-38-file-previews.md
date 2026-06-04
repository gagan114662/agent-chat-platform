# Plan 38 — In-thread file previews + explorer (#59)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** conductor 0.16/0.45/0.55 — browse a run's changed files and preview contents in-thread (text/code, markdown, HTML, images). Backend: `GitHubService.getFileContent` (Octokit `repos.getContent`) + an org-scoped `GET /runs/:id/file?path=`. Web: a file explorer (reuses the diff's changed-file list #17) + a **safe** preview pane — **no `dangerouslySetInnerHTML`**: markdown rendered via React nodes, HTML in a scripts-disabled sandboxed `<iframe srcdoc>`, images via base64. The scan (#47) confirmed our XSS-safety rests on JSX auto-escaping; this preserves it.

**Branch** `plan-38-file-previews` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: orchestrator — `getFileContent`

**Files:** `services/orchestrator/src/github/{github-service,octokit-github-service,octokit-github-service.test}.ts`, fakes
- [ ] Add to `GitHubService`: `getFileContent(owner, repo, ref, path): Promise<{ content: string; encoding: "utf8" | "base64"; size: number }>`. Octokit impl: `repos.getContent({owner, repo, path, ref})`; if the response is a file with base64 content, return the raw base64 + `encoding:"base64"` for binary (detect by path ext: images/pdf/etc → base64; else decode to utf8). Cap size (e.g. reject > 1 MiB → throw "file too large"). Add a nock test (GET `/repos/o/r/contents/README.md?ref=sha` → 200 base64 → decoded utf8). Add `getFileContent: vi.fn()...` to every fake. `pnpm test` + tsc. Commit `feat(orchestrator): GitHubService.getFileContent (#59)`.

## Task 1: app — `GET /runs/:id/file`

**Files:** Create `services/app/src/http/file-routes.ts`, `file-routes.test.ts`; Modify `src/server.ts`
- [ ] `registerFileRoutes(app, d: { db, makeGitHub? })`: `GET /runs/:id/file?path=...` → `actor(req).orgId`; load run org-scoped (404); need `pr_number`/`commitSha` (use `run.commitSha` as ref, 404 if none); resolve run→task→thread→repo + token (400 if missing); validate `path` (reject `..`/absolute — no traversal, though GitHub contents API is repo-scoped anyway); `gh = (d.makeGitHub ?? ...)(token)`; return `await gh.getFileContent(owner, repo, run.commitSha, path)` (`{content, encoding, size}`). Register in `server.ts`. Test (`app.inject`, fake makeGitHub): org-A run → 200 with content; cross-org → 404; no path → 400; `path` with `..` → 400. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): GET /runs/:id/file (org-scoped file read) (#59)`.

## Task 2: web — explorer + safe preview

**Files:** `services/web/src/api.ts`, Create `src/components/FilePreview.tsx`, `src/lib/markdown.tsx`, `FilePreview.test.tsx`, `markdown.test.tsx`; Modify `src/components/DiffView.tsx` or `PrCard.tsx` (an explorer toggle)
- [ ] **Step 1 — `api.ts`:** `runFile(runId, path): Promise<{ content: string; encoding: "utf8"|"base64"; size: number }>` (GET, authHeaders, path query-encoded).
- [ ] **Step 2 — `markdown.tsx`:** a **safe** minimal markdown→React renderer `renderMarkdown(src: string): JSX.Element` — line-based: `#`/`##`/`###` → headings, ```` ``` ```` fences → `<pre>`, `- ` → list items, `**x**` → `<strong>`, `` `x` `` → `<code>`, `[t](url)` → `<a href>` ONLY if url starts `https://` (else render the text). All via React elements — NO `dangerouslySetInnerHTML`. (Auto-escaped by JSX.)
- [ ] **Step 3 — `FilePreview.tsx`:** props `{ filename, content, encoding }`. Pick by extension: `.md` → `renderMarkdown(content)`; `.html`/`.htm` → `<iframe sandbox="" srcDoc={content} />` (empty sandbox = scripts/forms/navigation all blocked → safe rendered HTML); image exts (`.png/.jpg/.jpeg/.gif/.svg/.webp`) → `<img src={\`data:...;base64,${content}\`} />` (encoding base64); else (code/text) → `<pre>` with the raw content. Loading/empty/too-large states.
- [ ] **Step 4 — explorer:** in `DiffView`/`PrCard`, list the changed files (already fetched for the diff #17) as a clickable file list; clicking a file calls an injected `onOpenFile(runId, path)` → loads via `runFile` → renders `<FilePreview>`. Keep the existing diff view.
- [ ] **Step 5 — tests:** `markdown.test.tsx` — a `# Heading`, a `` `code` ``, a `[x](https://e.com)` link renders an `<a href="https://e.com">`, and a `[x](javascript:alert(1))` renders as TEXT (no href). `FilePreview.test.tsx` — `.md` renders rendered markdown; `.html` renders a sandboxed iframe (assert the `sandbox` attr present + no script execution path); `.png` base64 → an `<img>`; `.ts` → a `<pre>` with the raw content (escaped). `cd services/web && pnpm test && pnpm build`. Commit `feat(web): in-thread file explorer + safe previews (md/html/img/text) (#59)`.

---

## Self-Review
- Delivers #59: browse a run's changed files + preview text/code/markdown/HTML/images in-thread, org-scoped, size-capped.
- **Security:** no `dangerouslySetInnerHTML` anywhere — markdown is React nodes (JSX-escaped), HTML is a `sandbox=""` iframe (scripts disabled), links are https-only, images are data-URIs. Preserves the XSS-safety the #47 scan verified. Path validated (no traversal). Repo content is attacker-influenced → all of this matters.
- Backward-compat: `getFileContent` interface addition → update fakes; new route/components additive; org-scoped (#14). Existing suites green.

## Definition of Done (59)
orchestrator + app + web suites green; tsc/build. A run's changed files are browsable and preview safely (md rendered, html sandboxed, images shown, code as text); org-scoped + path-validated; cross-org denied.
