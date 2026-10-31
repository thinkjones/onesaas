# My Dad's AI Agent

Your dad's small business runs on Gmail and memory. This project gives him an AI agent that watches his inbox, keeps his customer table up to date, and drafts replies for him to approve — every step visible in plain English, nothing ever sent automatically. A button inside Gmail triggers a workflow (extract the lead, save the customer, write and draft a reply), and a run log page shows exactly what the agent did and why.

Built during the Meta AI Developer Hackathon, Oct 27 – Nov 4 2026, with Muse Code. All code was written during the hackathon.

## Setup

```sh
pnpm i
export MODEL_API_KEY=…
pnpm dev
```

- Server: `http://127.0.0.1:8787` (`/health` for a quick check)
- Web: `http://localhost:5173`
- Extension: loaded into a dev Chrome via WXT

### Loading the extension unpacked

1. Build it: `pnpm --filter @dad/extension build` (outputs to `apps/extension/.output/chrome-mv3`).
2. Open `chrome://extensions` and enable Developer mode.
3. Click Load unpacked and select `apps/extension/.output/chrome-mv3`.

## Layout

- `apps/server` — Node + Hono API: model gateway, table store, workflow engine, WebSocket bridge
- `apps/web` — Vite + React: pairing and run log pages
- `apps/extension` — WXT (MV3): Gmail adapter injected into the inbox
- `packages/shared` — zod schemas shared by server, web, and extension

## Scripts

- `pnpm dev` — run server, web, and extension in parallel
- `pnpm test` — run all tests (Vitest)
- `pnpm typecheck` — typecheck every workspace package
