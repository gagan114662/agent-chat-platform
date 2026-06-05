# Convene desktop app (#90)

A native macOS shell (Tauri 2) that wraps the web app and adds a browser→desktop sign-in handoff. Scaffold lives in `services/desktop/src-tauri/`.

> **Status:** scaffold + config committed. The actual `.dmg`/`.app` build requires the Tauri CLI + the macOS build toolchain (Xcode CLT) and was **not built in CI** (no Tauri CLI here). The config files are valid; build it locally per below.

## What it is
- A Tauri window that loads the **built web app** (`services/web/dist`, via `frontendDist`) or a **deployed instance** (`ACP_DESKTOP_URL`, e.g. `https://acp-convene.fly.dev` once #103 deploys).
- A `convene://` deep-link scheme for the **sign-in handoff**: the web auth (or Google SSO #84) redirects to `convene://auth?token=<session>`; the shell captures it and the front-end stores the token (so logging in via the browser lands you signed-in in the desktop app — matching reload.chat's handoff).

## Build (local, macOS)
```bash
# one-time
xcode-select --install                 # macOS build tools
cargo install tauri-cli --version '^2'  # the Tauri CLI

# build the web app first (the shell bundles its dist)
cd services/web && pnpm build && cd -

# dev (loads the Vite dev server at :5173)
cd services/desktop && cargo tauri dev

# production .dmg/.app
cd services/desktop && cargo tauri build
# → services/desktop/src-tauri/target/release/bundle/{dmg,macos}/
```

Point the shell at a deployed instance instead of the bundled dist:
```bash
ACP_DESKTOP_URL=https://acp-convene.fly.dev cargo tauri build
```

## Remaining
- App icons (`services/desktop/src-tauri/icons/icon.icns`) — generate from the Convene logo.
- Code signing + notarization (Apple Developer cert) for distribution — required for the landing-page "Download for macOS" button to serve a real `.dmg` (today that button scrolls; wiring it to a release artifact is the last step).
- The deep-link auth handler front-end glue (read `convene://auth?token=` → `setToken`).

Related: #102 (web app it wraps), #103 (deployed URL), #84 (SSO for the handoff).
