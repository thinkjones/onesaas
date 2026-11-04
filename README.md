# OneSaaS: One SaaS to rule them all

The tool that builds small-business apps.

My dad runs his small business out of Gmail and memory, and every evening the same chores eat him: answer customers, track bookings, turn phone photos into posts. This app doesn't do one of those chores — it's the tool that *builds* automations. He says what he wants to achieve, out loud, and watches the workflow get built in front of him: ghost plan, boxes snapping in with a chime, a test run on a real email, then Turn on. Every step says why in plain English, nothing ever sends itself, and the whole thing runs on his own computer.

[Demo video — link to be added before submission]

## What was built during the hackathon

Everything in this repo. It was built for the Meta AI Developer Hackathon (Indie Developer track, "Build for Your World"), all commits dated Oct 27 – Nov 4 2026, written with Muse Code. There is no pre-existing code: the monorepo, the engine, the builder agent, the extension, the themes, the sounds, the docs — all of it is new work from the event.

## How it uses Meta's models

Every model does a real job in the demo. (Role defaults live in [`apps/server/src/models/gateway.ts`](apps/server/src/models/gateway.ts).)

| Model | Where it's used | File |
| ----- | --------------- | ---- |
| Muse Spark 1.3 (`muse-spark-1.3`) | Builder agent tool loop | [`apps/server/src/agent/loop.ts`](apps/server/src/agent/loop.ts) |
| Muse Spark 1.3 | `ai.extract` / `ai.write` workflow steps | [`apps/server/src/steps/ai.ts`](apps/server/src/steps/ai.ts) |
| Muse Spark 1.3 | `ai.classify` workflow step | [`apps/server/src/steps/classify.ts`](apps/server/src/steps/classify.ts) |
| Muse Spark 1.3 | "Explain anything" answers | [`apps/server/src/explain/explain.ts`](apps/server/src/explain/explain.ts) |
| Muse Spark 1.3 | Screenshot vision fallback for unmapped pages | [`apps/server/src/bridge/vision.ts`](apps/server/src/bridge/vision.ts) |
| Muse Spark 1.3 | Inbox triage fallback when Glimmer isn't running | [`apps/server/src/triggers/email.ts`](apps/server/src/triggers/email.ts) |
| Muse Wonder 1.0 (`muse-wonder-1.0`) | `propose_plan` for complex requests (> ~6 steps or branching) | [`apps/server/src/agent/tools.ts`](apps/server/src/agent/tools.ts) |
| Muse Voice Transcribe (`muse-voice-transcribe-1.0`) | Push-to-talk, realtime with end-of-speech detection (proxied so the key stays server-side) | [`apps/server/src/voice/proxy.ts`](apps/server/src/voice/proxy.ts), [`apps/web/src/voice/`](apps/web/src/voice/) |
| Muse Image (`muse-image-1.0`) | Onboarding + design-mode mood backgrounds | [`apps/server/src/mood/generate.ts`](apps/server/src/mood/generate.ts) |
| Muse Image | `image.generate` / `image.edit` workflow steps | [`apps/server/src/steps/image.ts`](apps/server/src/steps/image.ts), [`apps/server/src/models/image.ts`](apps/server/src/models/image.ts) |
| SAM 3.1 (`sam-3.1`) | `image.cutout` (product cut out of a phone photo) | [`apps/server/src/steps/image.ts`](apps/server/src/steps/image.ts), [`apps/server/src/models/image.ts`](apps/server/src/models/image.ts) |
| Muse Glimmer (local, optional) | Inbox triage on the user's own machine via LM Studio; falls back to Spark | [`apps/server/src/models/gateway.ts`](apps/server/src/models/gateway.ts), [`docs/glimmer.md`](docs/glimmer.md) |
| Muse Code | The coding agent the project was built with | — |

## Architecture

Three processes on localhost — React web app, Node/Hono server, MV3 Chrome extension — with the server never touching Google or Meta directly. Diagram, request paths and the full model map: [`docs/architecture.md`](docs/architecture.md).

## Quick start

```sh
pnpm i
export MODEL_API_KEY=…   # Meta Model API key (api.meta.ai)
pnpm dev
```

- Server: `http://127.0.0.1:8787` (`/health` for a quick check)
- Web: `http://localhost:5173` (desktop only, 1280px+)
- Then load the extension (below) and pair it: the app shows a 6-digit code,
  enter it in the extension's side panel.

### Loading the extension unpacked

1. Build it: `pnpm --filter @onesaas/extension build` (outputs to `apps/extension/.output/chrome-mv3`).
2. Open `chrome://extensions` and enable Developer mode.
3. Click Load unpacked and select `apps/extension/.output/chrome-mv3`.
4. Open Gmail, then pair from the app's Chrome settings card (or onboarding step 4).

### Useful scripts

- `pnpm test` — run all tests (Vitest)
- `pnpm typecheck` — typecheck every workspace package
- `pnpm demo:reset [--keep-profile] [--with-flow1]` — wipe the database and uploads back to a clean demo start (server stopped). `--save-profile` snapshots the demo profile first. See [`docs/demo-checklist.md`](docs/demo-checklist.md).

## Optional: inbox triage on Muse Glimmer

With LM Studio running Glimmer locally, routine inbox filtering stays on the machine at zero API cost — and falls back to Spark automatically when Glimmer isn't there. Setup: [`docs/glimmer.md`](docs/glimmer.md).

## Data stays on your computer

- One local SQLite file (`data/app.db`); nothing leaves the machine except Meta model calls.
- The server binds to localhost only; the extension only connects to localhost and must present a pairing token.
- Model calls send only the fields each step needs.
- Glimmer triage keeps routine inbox filtering on the machine.
- Nothing sends or posts automatically — Gmail replies and Meta posts are always drafts (plus an approval step) that you send yourself.

## Licence and assets

MIT — see [LICENSE](LICENSE). Every image, sound and fixture shipped with the repo is listed with source, licence and author in [ASSETS.md](ASSETS.md).
