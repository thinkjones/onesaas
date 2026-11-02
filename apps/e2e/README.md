# E2E suite (`@dad/e2e`)

Playwright end-to-end tests. The suite boots an **isolated stack** — API on `:8791` with a fresh `test-results/e2e.db`, web on `:5193` proxied to it — so it never touches your live dev servers (`:5173`/`:8787`) or your real database.

## Run

```bash
pnpm e2e          # headless Chromium, no video
pnpm e2e:video    # same suite, records one .webm per UI test under test-results/
```

First run only: `pnpm --filter @dad/e2e exec playwright install chromium`.

## Prerequisites

- `MODEL_API_KEY` must be set. Test runs execute `ai.*` steps for real and one test runs a live agent turn; without a key the suite fails fast with a clear message instead of confusing mid-run errors.
- Each full run costs on the order of ~$1 in model calls and takes ~40s.

## What's covered (12 tests)

- `app.spec.ts` — API health (direct + through the Vite proxy), home page, pairing-code issuance, seeded flow-1 in the reducers list.
- `design.spec.ts` — blank reducer → design mode; palette add → config form → problems gate Turn on; Backspace delete → Undo restores.
- `test-run.spec.ts` — flow-1 test run previews everything (`usedSample`, all `done`, pinned whys, sample notice survives refetch); Try-it button renders the story strip.
- `agent-panel.spec.ts` — panel renders/collapses; sending runs a live turn and shows the reply (content-agnostic assertions).

## What's deliberately NOT covered

- Chrome extension + real Gmail (needs a logged-in profile; see the manual checklist below).
- Multi-turn agent building (covered by `scripts/eval-builder.ts` instead).
- Failure paths that need fault injection (covered by unit tests).

## Manual E2E (human, with the extension)

1. `pnpm dev`, open Gmail with the unpacked extension loaded (`apps/extension/.output/chrome-mv3`). Fresh DBs start blank — boot the server once with `SEED_FLOW1=1` (or `pnpm demo:reset --with-flow1` while stopped) so the "Save as lead & reply" button exists.
2. Settings → Connect Chrome → enter the code in the extension popup.
3. Open an email → "Save as lead & reply" → approve/edit/skip → draft appears in Gmail.
4. Kill + restart the server mid-run → waiting runs resume.

## Notes for authors

- Specs share one server + DB (`workers: 1`). The config boots it with `SEED_FLOW1=1`, so the stable `flow-1` fixture is always present — use it or create your own workflows; never assume a blank slate beyond it. (Customer boots omit the flag and start blank.)
- Chromium's accessibility tree exposes no landmark for plain `<div aria-label>` (e.g. the conversation, the test strip): scope text assertions to a labelled ancestor instead of `getByRole('region', …)`.
- Suite viewport is 1600×900: at 1280px the canvas column squeezes step nodes under the side panels (unclickable).
