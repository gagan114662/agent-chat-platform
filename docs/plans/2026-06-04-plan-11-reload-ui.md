# Plan 11 — Restyle the web UI to the reload.chat aesthetic

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Checkbox steps.

**Design (author's call):** reload.chat's public design language (captured via browser): **Inter** typeface, a soft **lavender-gray app background (`#f0f0f7`)**, white surfaces, **near-black text (`#2b2b2b`) and near-black primary actions/active states (`#15151f`)** — buttons are black, not colored — subtle hairline borders, **rounded cards (`rounded-xl`)**, and generous whitespace. This is a **styling-only** change: no component structure, text, roles, or behavior changes, so the component tests stay green (they query by text/role/placeholder, not class). Replace the current indigo/slate palette with these tokens across `services/web`.

**Tech Stack:** React + Tailwind v4. Branch `plan-11-reload-ui` (off `main`). Tests: `cd services/web && pnpm test`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

## Design tokens (apply consistently)
| token | value | replaces |
|---|---|---|
| App background | `#f0f0f7` (use `bg-[#f0f0f7]`) | white/slate-50 |
| Surface / cards | `bg-white` + `border border-[#e7e7f0]` + `rounded-xl` | existing borders |
| Primary text | `text-[#2b2b2b]` (or `text-neutral-800`) | slate-900 |
| Muted text | `text-neutral-500` | slate-400/500 |
| **Primary / active (was indigo)** | **`bg-[#15151f] text-white`** (buttons, active thread); hover `bg-black` | indigo-600 / indigo-100/indigo-700 |
| Agent avatar | `bg-[#15151f]` | indigo-500 |
| Focus ring | `focus:border-neutral-800` | indigo-400 |
| Font | **Inter** | default |
| Radius | `rounded-xl` for cards, `rounded-lg` for inputs/buttons | rounded-md/lg |

Keep semantic status colors on the PR card (merged=emerald, failed/error=rose, timeout=amber, held=amber/neutral) — reload is minimal but status needs to read; just soften to the `-50/-200/-700` scale already used.

---

## Task 0: Inter font + global background

**Files:** Modify `services/web/src/index.css`

- [ ] **Step 1:** replace `src/index.css` with:
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
@import "tailwindcss";

:root { font-synthesis-weight: none; }
html, body, #root { height: 100%; }
body {
  margin: 0;
  font-family: 'Inter', -apple-system, system-ui, 'Segoe UI', sans-serif;
  background: #f0f0f7;
  color: #2b2b2b;
  -webkit-font-smoothing: antialiased;
}
```
- [ ] **Step 2:** `cd services/web && pnpm build` (Tailwind picks up the CSS) — clean.
- [ ] **Step 3:** commit:
```bash
git add services/web/src/index.css
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(web): Inter font + reload.chat lavender-gray background"
```

---

## Task 1: Restyle the shell + sidebar (App, Sidebar, NewThreadForm, NewDmPicker, SearchBar)

**Files:** Modify `src/App.tsx`, `src/components/{Sidebar,NewThreadForm,NewDmPicker,SearchBar}.tsx`

- [ ] **Step 1:** Apply the tokens. Concrete changes (preserve ALL text/props/handlers/aria-labels/placeholders — change only `className` strings):
  - **App shell** (`App.tsx` `Workspace`): outer `bg-[#f0f0f7] text-[#2b2b2b]`; header `border-b border-[#e7e7f0] bg-white`; main content area keeps white surfaces. Sign-out button → `text-neutral-500 hover:text-neutral-800`.
  - **Sidebar**: `bg-white border-r border-[#e7e7f0]` (a clean white rail on the lavender app bg). Section labels `text-xs font-semibold uppercase tracking-wide text-neutral-400`. **Active thread**: `bg-[#15151f] text-white` (rounded-lg); inactive `text-neutral-600 hover:bg-neutral-100`. Workspace title `font-semibold text-neutral-800`. Footer dev-stub `text-neutral-400`.
  - **Channel-create input + "+"**, **NewThreadForm** inputs/select, **SearchBar** input: borders `border-[#e7e7f0] rounded-lg focus:border-neutral-800 focus:outline-none`; primary buttons (Create thread, Send-style, +) → `bg-[#15151f] text-white hover:bg-black rounded-lg`. SearchBar results dropdown: `rounded-xl border border-[#e7e7f0] bg-white shadow-lg`; result hover `hover:bg-neutral-50`; thread-title accent `text-neutral-800 font-medium` (drop indigo).
  - **NewDmPicker** select: same input styling.
- [ ] **Step 2:** `pnpm test` (Sidebar/SearchBar/NewThreadForm/NewDmPicker tests still green — they assert text/roles/aria, not classes) + `pnpm build`.
- [ ] **Step 3:** commit:
```bash
git add services/web/src/App.tsx services/web/src/components/Sidebar.tsx services/web/src/components/NewThreadForm.tsx services/web/src/components/NewDmPicker.tsx services/web/src/components/SearchBar.tsx
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(web): restyle shell + sidebar to reload.chat tokens"
```

---

## Task 2: Restyle messages + composer + login (MessageItem, PrCard, ThreadView, Composer, LoginScreen)

**Files:** Modify `src/components/{MessageItem,PrCard,ThreadView,Composer,LoginScreen}.tsx`

- [ ] **Step 1:** Apply tokens (className-only):
  - **MessageItem** (chat): agent avatar `bg-[#15151f]` (was indigo-500), human avatar `bg-neutral-400`; author label `text-neutral-500`; body `text-[#2b2b2b] whitespace-pre-wrap`. `system` line `text-xs text-neutral-400` centered (unchanged structure).
  - **PrCard**: keep the outcome badge semantic colors but on the softened scale; card `rounded-xl border`. PR link `underline underline-offset-2 font-medium` in `text-neutral-800` (drop indigo).
  - **ThreadView**: empty-state text `text-neutral-400`; container unchanged.
  - **Composer**: textarea `border-[#e7e7f0] rounded-lg focus:border-neutral-800`; Send button `bg-[#15151f] text-white hover:bg-black rounded-lg` (was indigo-600). Keep Enter-to-send + placeholder text.
  - **LoginScreen**: card `rounded-xl border border-[#e7e7f0] bg-white shadow-sm`; member buttons `border-[#e7e7f0] hover:bg-neutral-50`; password input `border-[#e7e7f0] focus:border-neutral-800`. Keep "Sign in" heading + "Sign in as <name>" + the password placeholder (tests assert these).
- [ ] **Step 2:** `pnpm test` (MessageItem/Composer/LoginScreen/SearchBar tests green — load-bearing assertions: `PR #7` link + href, `getByText("merged")`, placeholder `/message/i`, `Sign in`, `Sign in as You`) + `pnpm build`.
- [ ] **Step 3:** commit:
```bash
git add services/web/src/components/MessageItem.tsx services/web/src/components/PrCard.tsx services/web/src/components/ThreadView.tsx services/web/src/components/Composer.tsx services/web/src/components/LoginScreen.tsx
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(web): restyle messages + composer + login to reload.chat tokens"
```

---

## Self-Review
- Styling-only: no JSX structure, text, roles, aria-labels, placeholders, or handlers changed → all 30 web component tests stay green. Verify by running `pnpm test` after each task.
- Token consistency: indigo fully replaced by near-black `#15151f`; slate replaced by neutral + `#2b2b2b`/`#e7e7f0`; Inter everywhere; lavender-gray app bg; rounded-xl cards.
- This matches reload.chat's PUBLIC brand aesthetic (their gated app may differ); it is a faithful restyle, not a copy of proprietary UI.

## Definition of Done (11)
`pnpm test` green (30 tests) + `pnpm build` clean. The UI renders in Inter on the lavender-gray background with near-black accents, white rounded surfaces, and minimal styling — matching reload.chat's look. Validated by a screenshot (controller compares against the reload.chat reference).
