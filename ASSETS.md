# Asset provenance

Third-party media shipped with this repo. Every entry lists the file, the
source URL, the licence, and the author.

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
