# Asset provenance

Every image, sound and fixture shipped with this repo. Every entry lists the
file, the source, the licence, and the author. Everything below was either
generated during the hackathon (Oct 27 – Nov 4 2026), taken or made by the
project author during the hackathon, or CC0-licensed.

## Sound (`apps/web/public/sound/`)

All four files are the freesound.org HQ preview MP3s of CC0-licensed sounds
(full download requires a freesound login; the previews carry the same CC0
work), loudness-normalised to −20 LUFS with ffmpeg (`loudnorm`, dual pass,
128 kbps MP3). No trimming was needed: both ambient loops already fall in the
60–120 s range, and both fade toward silence at the tail, so the 3 s
crossfade between loops stays smooth.

| File | Source | Licence | Author |
| ---- | ------ | ------- | ------ |
| `apps/web/public/sound/ambient-1.mp3` (107 s) | [ambient key swirl.wav](https://freesound.org/people/yammerhant/sounds/215751/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | yammerhant |
| `apps/web/public/sound/ambient-2.mp3` (78 s) | [Overlook (uplifting ambient loop)](https://freesound.org/people/SondreDrakensson/sounds/506495/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | SondreDrakensson |
| `apps/web/public/sound/chime-step.mp3` (2 s) | [Thin bell ding 3](https://freesound.org/people/Khrinx/sounds/333694/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Khrinx |
| `apps/web/public/sound/chime-done.mp3` (5 s) | [bell 6.wav](https://freesound.org/people/patchytherat/sounds/534263/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | patchytherat |

## Mood defaults (`apps/web/public/mood/`)

The four bundled design-mode backdrops, generated with Muse Image during
the hackathon (`muse-image-1.0`, prompts from `apps/server/src/mood/generate.ts`
with `businessWhat = 'small family business'`, resized to fit 1600 px and
saved as JPEG quality 82 with sharp).

| File | Source | Licence | Author |
| ---- | ------ | ------- | ------ |
| `apps/web/public/mood/default-1.jpg` (inside of a small family business) | Generated with Muse Image during the hackathon | Original work | Muse Image |
| `apps/web/public/mood/default-2.jpg` (front on a quiet street) | Generated with Muse Image during the hackathon | Original work | Muse Image |
| `apps/web/public/mood/default-3.jpg` (tools and materials on a workbench) | Generated with Muse Image during the hackathon | Original work | Muse Image |
| `apps/web/public/mood/default-4.jpg` (coffee on the counter) | Generated with Muse Image during the hackathon | Original work | Muse Image |

## Onboarding cards (`apps/web/public/onboarding/`)

The three illustrated example cards on the onboarding reframe screen,
generated with Muse Image during the hackathon (`muse-image-1.0`, calm
watercolor prompts in the same style as the mood defaults, resized to fit
1600 px and saved as JPEG quality 82 with sharp).

| File | Source | Licence | Author |
| ---- | ------ | ------- | ------ |
| `apps/web/public/onboarding/card-1.jpg` (Answer customer emails faster) | Generated with Muse Image during the hackathon | Original work | Muse Image |
| `apps/web/public/onboarding/card-2.jpg` (Keep track of bookings) | Generated with Muse Image during the hackathon | Original work | Muse Image |
| `apps/web/public/onboarding/card-3.jpg` (Turn a photo into a post) | Generated with Muse Image during the hackathon | Original work | Muse Image |

## Server sample photo (`apps/server/assets/`)

The bundled photo behind the `trigger.upload` catalog sample ("Try it" runs
reference it; `ensureSamplePhoto` in `apps/server/src/triggers/upload.ts`
seeds it into the file store on boot).

| File | Source | Licence | Author |
| ---- | ------ | ------- | ------ |
| `apps/server/assets/sample-mug.jpg` (flat illustration of a rust-coloured mug with a blank label) | Illustration made for the project during the hackathon | Original work | Project author |

## Script and test fixtures

| File | Source | Licence | Author |
| ---- | ------ | ------- | ------ |
| `scripts/fixtures/mug.jpg` (SAM smoke-test photo) | Photo taken by the project author during the hackathon | Original work | Project author |
| `scripts/fixtures/hello.wav` ("hello there", 24 kHz mono) | Synthesised with macOS `say` during the hackathon (`say -o … "hello there"`, converted with ffmpeg) | Original work | Project author |
| `apps/server/test/fixtures/photo.heic` (3 KB) | Minimal synthetic HEIC file crafted for the upload-rejection test during the hackathon | Original work | Project author |

## Extension icons and web chrome

Committed with the project scaffold during the hackathon (original work, drawn
for this repo).

| File | Source | Licence | Author |
| ---- | ------ | ------- | ------ |
| `apps/extension/public/icon/{16,32,48,96,128}.png` (toolbar icons) | Created with the project scaffold during the hackathon | Original work | Project author |
| `apps/web/public/favicon.svg` (sparkle mark) | Created with the project scaffold during the hackathon | Original work | Project author |
| `apps/web/public/icons.svg` (UI icon sprite) | Created with the project scaffold during the hackathon | Original work | Project author |

## Unreferenced scaffold leftovers

Shipped by the Vite/WXT templates at scaffold time, still committed, not
referenced by any page or component (verified by repo-wide search). Kept as
harmless template files; safe to delete.

| File | Source | Licence | Author |
| ---- | ------ | ------- | ------ |
| `apps/web/src/assets/hero.png` | Vite template scaffold during the hackathon | Original work | Project author |
| `apps/web/src/assets/react.svg`, `apps/web/src/assets/vite.svg` | Unmodified Vite React-template defaults (project and framework logos) | As licensed by their template (Vite MIT) | Vite / React |
| `apps/extension/public/wxt.svg` | Unmodified WXT template default (framework logo) | As licensed by its template (WXT MIT) | WXT |
