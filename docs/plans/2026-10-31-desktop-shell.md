# Desktop shell (Bug #6) — plan

Seed commit for `feat/desktop-shell`. Implementation paused by user after the vibe-fixes merge; this doc records the agreed direction so work can resume on this branch.

## Goal

Ship "My Dad's AI Agent" as a double-clickable macOS desktop app, copying the tech and localdev pattern of `/Users/thinkjones/dev/repos/__labs/me-personal-crm` (Tauri + Vite, `tauri dev` / `tauri build -- --bundles app`, 1440x900 window, Overlay title bar). Look'n'feel already ported from that repo under Bug #2.

## Agreed scope (user chose "Single app now", 2026-10-31)

- One Tauri window hosting the React web app.
- The Node API server (8787) ships with the app and is spawned/killed by it — no terminal, no separate `pnpm dev`.
- The Chrome extension keeps working unchanged (it pairs to 127.0.0.1:8787, which the bundled server still serves).
- `.app` bundle via `tauri build`, same as the reference.

## Approach sketch

1. `src-tauri/` scaffold (Rust): window config mirrored from the reference (title "My Dad's AI Agent", 1440x900, Overlay/hiddenTitle), `beforeDevCommand` running web+server concurrently, `frontendDist` pointing at the web build.
2. Server sidecar: compile/bundle `apps/server` (Hono + better-sqlite3 + sharp) to a resource the Tauri app spawns on boot (port 8787, data dir under the app's data folder) and kills on exit.
3. Dev parity: `pnpm tauri dev` (or repo-root script) opens the desktop window with hot reload; server logs visible.
4. Packaging: `tauri build` produces a working `.app`; smoke-test install, first run (server boot, pairing code, extension pair), and quit (no orphan server).

## Risks

- `better-sqlite3` and `sharp` are native modules — the sidecar must ship matching `.node` binaries (Tauri resources) or equivalent; this is the hardest part. Spike first.
- Unsigned sidecar binaries + Gatekeeper on other Macs (fine on the dev Mac; signing later).
- Extension host permission already covers 127.0.0.1:8787 — no manifest change needed.

## Verification

- `cargo test` for any Rust glue; existing `pnpm test` + `pnpm typecheck` stay green.
- Live: window opens, Inbox loads from the bundled server, design mode works, extension pairs, quit leaves no server behind.
