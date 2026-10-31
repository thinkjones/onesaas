# Demo checklist (3-minute video)

Timed script from the demo plan, plus pre-flight. Check each box in order;
nothing here is optional — an unchecked box is a re-record.

## Recording order (read once)

`--keep-profile` restores `onboarded: true`, which skips `/welcome` — so the
onboarding shot cannot be filmed from a kept profile. Film in this order:

1. Blank reset (`pnpm demo:reset`, no flags) → film the 0:25–0:50 onboarding
   shot. Complete all four screens for real (this also generates Dad's mood
   set and pairs the extension).
2. Stop the server, run `pnpm demo:reset --save-profile` once.
3. `pnpm demo:reset --keep-profile` → film everything from 0:50 on. Every
   later take re-runs step 3 only (profile already saved).

## Pre-flight (before every take)

- [ ] Test Gmail account logged in, inbox open in a tab (dad's real inbox
  stays out of the recording).
- [ ] Google Calendar empty for next Tuesday (the booking flow lands there).
- [ ] Meta Business Suite logged in, in a tab.
- [ ] LM Studio running with the Glimmer model loaded and the server started
  on port 1234 (see [docs/glimmer.md](glimmer.md)); `GLIMMER_BASE_URL` and
  `GLIMMER_MODEL` exported in the server shell.
- [ ] Server stopped, then `pnpm demo:reset --keep-profile` (restores the
  business profile, theme and mood images; leaves zero workflows so every
  flow is built live). If the profile was never snapshotted:
  `pnpm demo:reset --save-profile` once, after onboarding + mood generation.
- [ ] Fresh boot: `pnpm dev`. Server log shows
  `[models] triage → Muse Glimmer (<model>)`; Settings → Thinking shows
  "Inbox sorting runs on this computer (Muse Glimmer) ✓".
- [ ] Extension loaded unpacked from `apps/extension/.output/chrome-mv3`,
  paired (popup shows connected), Gmail tab reloaded so the ✨ button injects.
- [ ] Sound on at 0.25 (Settings → Sound; design mode plays ambient + chimes).
- [ ] Browser zoom 100%, window 1440×900.
- [ ] Do Not Disturb on (macOS + Slack + phone).
- [ ] `MODEL_API_KEY` exported in the server shell (no key visible on screen).

## The 3 minutes

| Time | Shot | Script / action |
| ---- | ---- | --------------- |
| 0:00–0:25 | Dad's problem, in his own words if he will record a clip; else voiceover over the inbox. | "My dad runs a small business out of Gmail and memory. Every evening the same chores: answer customers, track bookings, post photos. This is the tool that builds him out of them." |
| 0:25–0:50 | Onboarding on a blank reset: welcome → business Q&A → reframe → connect (pair the extension live, show the ✓). His business illustrated by Muse Image behind the cards. | "It starts by learning his business — and draws it back to him." End on "What do you want to achieve today?" |
| 0:50–1:40 | Voice: "When a customer emails me, save them and draft a reply." Ghost plan → boxes build in with chimes → test run on the real open email → Turn on. | One continuous take, no cuts: this is the live builder. Keep the mic close; partial transcript shows live. |
| 1:40–2:15 | In Gmail, click the ✨ button. Runtime mode lights up step by step; approve the draft; the reply appears in Gmail. Then "Why did Sarah get this reply?" → run story. | "Nothing sends itself — he approves, and every step says why." |
| 2:15–2:45 | Montage (cuts allowed): booking flow lands on Calendar; photo → SAM cutout → Muse Image post → prepared in Meta Business Suite. | Faster cuts, captions name each model as it works. |
| 2:45–3:00 | Model map on screen + closing line. | "Every Meta model doing a real job — built with Muse Code during the hackathon." Freeze on the repo. |

## Cut line (do NOT promise these on camera)

Per the build plan, these were the first to go if time ran short — if any of
them is missing or rough on recording day, cut the shot, not corners:

- Glimmer triage (Spark covers it; Settings says which is live).
- Evening / Workshop themes.
- Flow 2's free/busy check.
- `code.transform`.
- Card and stat views.

Never cut: the Gmail button, the live builder animation, runtime mode with
why, onboarding.

## Fix before recording

Rough edges found in the headless dry run (Task 8, Oct 31 2026), worst first.
Each item is either FIXED (in this commit) or OPEN/UNVERIFIED (operator must
cover it on recording day — nothing here was claimed without evidence).

FIXED:

- [x] `--keep-profile` restores `onboarded: true`, which skips `/welcome` —
  the onboarding shot was unfilmable from a kept profile. Fixed with the
  "Recording order" section above (film onboarding on a blank reset first,
  then `--save-profile`, then `--keep-profile` for the rest).
- [x] Checklist quoted the Glimmer boot line and the Settings copy from
  memory; both were inexact. Fixed to the exact strings
  (`[models] triage → Muse Glimmer (<model>)`, "Inbox sorting runs on this
  computer (Muse Glimmer) ✓"), verified against `apps/server/src/main.ts`
  and `apps/web/src/pages/SettingsPage.tsx`.
- [x] Headless-verified and folded into the checklist: `pnpm demo:reset`
  (reset / `--with-flow1` / `--save-profile` / `--keep-profile` / loud
  missing-profile failure / live-server refusal, all via the real CLI),
  server boot on a reset DB (`/health`, `/api/settings` blank defaults with
  volume 0.25, `/api/models/status` Spark + Glimmer-fallback note),
  extension unpacked build at `apps/extension/.output/chrome-mv3`, web dev
  server serves, full `pnpm test` (930) + `pnpm typecheck` (5 projects) green,
  every doc link target exists, `#loading-the-extension-unpacked` anchor kept
  for the onboarding deep link.

OPEN / UNVERIFIED (need a browser, Gmail, LM Studio, or ears — do these live):

- [ ] NEEDS-VIDEO: the 3-minute video does not exist yet; README carries a
  placeholder line. Replace it with the real link before submission.
- [ ] UNVERIFIED: onboarding end to end in Chrome (all 4 screens, mood
  generation swapping the backdrop, pairing ✓).
- [ ] UNVERIFIED: voice builder take (push-to-talk → ghost plan → build →
  test run → Turn on) on a real mic.
- [ ] UNVERIFIED: Gmail ✨ button → runtime mode → approve → reply in Gmail →
  run story ("Why did Sarah get this reply?").
- [ ] UNVERIFIED: booking flow lands on a real Calendar; photo → SAM cutout →
  Muse Image post → prepared in Meta Business Suite.
- [ ] UNVERIFIED: LM Studio + Glimmer healthy path (boot line, triage on
  Glimmer, Settings ✓) and the Spark fallback with LM Studio stopped.
- [ ] UNVERIFIED: sound actually audible (ambient + chimes at 0.25) and the
  1440×900 / zoom-100% framing; `docs/architecture.md` mermaid rendering on
  GitHub (syntax hand-reviewed, not rendered).
- [ ] OPEN (accepted): `pnpm e2e` (Playwright) was not run — this change adds
  no UI/server behaviour (new files + docs + one npm script), so e2e is
  unaffected; run it on recording day if time allows.
