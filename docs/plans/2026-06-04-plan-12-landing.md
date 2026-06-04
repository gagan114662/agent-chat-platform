# Plan 12 — reload.chat-style Landing Site

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Checkbox steps.

**Design (author's call):** A new `services/landing` marketing site that faithfully recreates the reload.chat landing *experience* (a long pinned-scroll tour dressed up as the product), branded for **our** product. Same brand tokens as the app (Inter, lavender-gray `#f0f0f7`, near-black `#15151f` accents, white rounded-xl surfaces, blue `#2563eb`-ish highlight). It is a faithful recreation of the public layout/animations/copy — not a copy of proprietary assets; the funding banner uses a tasteful placeholder (no fabricated claim).

**Tech Stack:** Vite + React + TS + Tailwind v4 + **framer-motion** (scroll-driven animation) + Vitest/jsdom + @testing-library/react. Branch `plan-12-landing` (off `main`). Tests: `cd services/landing && pnpm test`; build `pnpm build`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

## Sections to build (top → bottom; the reload.chat walkthrough)
0. **IntroLoader** — fullscreen splash: dark circular logo "●" with a thin blue progress ring sweeping around it, brand wordmark beneath, hero headline faintly ghosted behind; after ~1.8s it fades + zooms out to reveal the page. (framer-motion; show once.)
1. **FundingBanner** — slim blue top bar, dismissible (X): a short product announcement + arrow. (Placeholder copy — NOT a fabricated funding figure.)
2. **Hero** — big rounded app icon, headline **"Team Chat For AI Agents."** (heavy black), subhead "Everyone on your team has their own AI agents. This is where they all work together," black **"Download for macOS"** button.
3. **ScrollAppReveal** (signature) — a dark macOS app window below the hero that **scales up + rises on scroll** (sticky section + `useScroll`/`useTransform`) until it fills the viewport, hero text fading behind it. Inside: left sidebar (Pinned / Channels: engineering, design, marketing / DMs), center **#product-dev** channel, right **Team** panel "6 humans · 7 agents · 247 decisions captured". A scripted thread plays (agents `hermes`, `claude-code`, `cursor`, `atlas`, `openclaw`, `Devin` posting status; task cards flipping TODO / IN PROGRESS / ASSIGNED; ends with human "John Doe": "go for it 🚀 ship it").
4. **FeatureCards** — 4 numbered cards (01–04) on the left; each **dims→brightens + expands** as it scrolls into focus, while a right panel swaps to a matching app view:
   - 01 "Bring your whole team's agents into one channel" → **Agent pools** (3 teams + "+ ADD") then a **Tasks board** (T-12…T-21, status pills, assignees, due dates).
   - 02 "Agents keep working, even when you're not" → **Context Explorer · 258 memories · 463 edges** graph with Personal/Project/Team/Org filters.
   - 03 "You're only pulled in when it matters" → an approval/mention view.
   - 04 "Every decision is captured automatically" → a captured-decision view.
5. **BlackInterstitial** — fullscreen black slide, huge type "Every agent your team uses. One workspace." + "Always working." (the second line in blue).
6. **FAQ** — styled as the app's "Settings / Help & FAQs": "Frequently asked questions" accordion (What is this?, Is it like Slack for AI agents?, How is it different from a memory store?, Does it replace agent frameworks?, …), first item expanded, rest toggle.
7. **Contact + Footer** — "TALK TO US / Got a team of agents to put to work?" + form (Name, Work email, Website, How can we help) + "Send message →"; footer with logo, tagline, X/LinkedIn/Instagram icons, Product/Resources/Company link columns, "© 2026".
8. **Dock** (persistent) — fixed macOS-style dock floating at the bottom (brand icon + section icons, the download tile highlighted).

---

## Task 0: Scaffold `services/landing`

**Files:** `services/landing/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,index.html}`, `src/{main.tsx,index.css,test-setup.ts}`; modify `pnpm-workspace.yaml`.

- [ ] **Step 1:** add `"services/landing"` to `pnpm-workspace.yaml`.
- [ ] **Step 2:** `package.json` (`@acp/landing`): same shape as `services/web` (type module; scripts dev/build/preview/test), deps `react`,`react-dom`,`framer-motion@^11`; devDeps mirror `services/web` (vite, @vitejs/plugin-react, tailwindcss + @tailwindcss/vite, vitest, jsdom, @testing-library/react + jest-dom, typescript, @types/react*). Copy the versions from `services/web/package.json` so resolution is consistent.
- [ ] **Step 3:** copy `services/web`'s `tsconfig.json`, `vite.config.ts` (drop the proxy — landing needs no backend), `vitest.config.ts` (jsdom + setupFiles), `test-setup.ts` (jest-dom + the `scrollIntoView` polyfill from web), `index.html`.
- [ ] **Step 4:** `src/index.css` = the app's reload tokens (`@import` Inter + `@import "tailwindcss"` + body bg `#f0f0f7`, color `#2b2b2b`, Inter). `src/main.tsx` renders `<App/>`.
- [ ] **Step 5:** `pnpm install` (root); `cd services/landing && pnpm build` clean (with a placeholder `App` returning a div for now). Commit `chore(landing): scaffold marketing site package`.

## Task 1: Tokens + shared primitives + Dock + FundingBanner + IntroLoader

**Files:** `src/theme.ts` (token constants), `src/components/{Dock,FundingBanner,IntroLoader}.tsx` + tests.

- [ ] Build the three; **IntroLoader** uses framer-motion (ring sweep via animated `strokeDashoffset`/rotate, then `AnimatePresence` fade-out after a timeout; accept an `onDone`/auto-hide). **FundingBanner** dismissible (useState). **Dock** fixed bottom, rounded, blurred. Smoke tests: IntroLoader renders the wordmark; FundingBanner hides on X click (`getByRole("button", {name:/dismiss/i})`); Dock renders. `pnpm test` + build. Commit.

## Task 2: Hero + ScrollAppReveal (the signature animation)

**Files:** `src/components/{Hero,AppWindow,ScrollAppReveal,ChatThreadMock}.tsx` + a test.

- [ ] **Hero**: icon + headline + subhead + black download button.
- [ ] **AppWindow**: the dark macOS window chrome (traffic lights) wrapping a `children` app view; used by ScrollAppReveal AND FeatureCards.
- [ ] **ChatThreadMock**: the scripted #product-dev thread (sidebar + center + Team panel + the agent messages + task cards + the human reply). Static markup is fine (scripted, not animated message-by-message — a convincing still is acceptable; optional: a simple staggered fade-in).
- [ ] **ScrollAppReveal**: a tall sticky section; `const {scrollYProgress}=useScroll({target})`; `scale`/`y`/`borderRadius` via `useTransform` so the AppWindow grows from a card to ~full-bleed as you scroll; hero text opacity fades. Smoke test: renders the #product-dev channel + "decisions captured" text. `pnpm test` + build. Commit.

## Task 3: FeatureCards (numbered, scroll-synced panel swap)

**Files:** `src/components/{FeatureCards,FeaturePanels}.tsx` + a test.

- [ ] 4 numbered cards; track the in-focus index with `useScroll` progress or IntersectionObserver; the focused card is bright/expanded (others dimmed `opacity-40`), and the right panel renders the matching mock view (AgentPools+TasksBoard, ContextGraph "258 memories · 463 edges", ApprovalView, DecisionCapture). Build the mock views as static AppWindow children. Smoke test: all 4 titles render; the tasks board shows a `T-` id; the context view shows "memories". `pnpm test` + build. Commit.

## Task 4: BlackInterstitial + FAQ + Contact + Footer

**Files:** `src/components/{BlackInterstitial,FAQ,Contact,Footer}.tsx` + tests.

- [ ] **BlackInterstitial**: full-screen black, huge type, second line blue.
- [ ] **FAQ**: accordion (array of {q,a}); first open by default; clicking a question toggles it. Test: clicking a collapsed question reveals its answer.
- [ ] **Contact**: the form (controlled inputs; submit is a no-op/console for now) + "Send message →". **Footer**: logo + tagline + social + 3 link columns + copyright. `pnpm test` + build. Commit.

## Task 5: Assemble `App` + full build + screenshot-ready

**Files:** `src/App.tsx` (compose all sections in order, with `<IntroLoader/>` overlay + `<FundingBanner/>` + `<Dock/>` persistent), `src/App.test.tsx`.

- [ ] Compose: IntroLoader (overlay) → FundingBanner (top) → Hero → ScrollAppReveal → FeatureCards → BlackInterstitial → FAQ → Contact → Footer, with Dock fixed. `App.test.tsx`: renders the hero headline "Team Chat For AI Agents." and the FAQ heading (fetch/animation safe under jsdom; mock framer-motion if needed via `vi.mock` or rely on it rendering children). `pnpm test` (all green) + `pnpm build` (clean). Commit `feat(landing): assemble reload.chat-style landing page`.

---

## Self-Review
- All 9 sections present + the signature scroll-driven app reveal + the 4 scroll-synced feature panels + persistent dock.
- Brand: our product; reload.chat layout/copy/animation faithfully recreated; funding banner is a placeholder (no fabricated claim); not a copy of proprietary assets.
- Tests are smoke-level (render + the few interactive bits: banner dismiss, FAQ toggle) — the real validation is the controller's screenshot pass across sections.

## Definition of Done (12)
`cd services/landing && pnpm test` green + `pnpm build` clean. `pnpm dev` serves a single long pinned-scroll page that opens with the intro loader, shows the hero + funding banner, scrolls the app window up to full-bleed with the scripted agent thread, plays the 4 numbered feature cards with swapping app views, hits the black interstitial, the FAQ accordion, and the contact/footer, with a floating dock throughout — matching the reload.chat experience. Validated by section screenshots.
