import type { FileRef } from '@onesaas/shared';
import type { Executor } from './registry.js';

// Task 7's steps file. It holds meta.draftPost plus notify (the plan's one
// new steps module; notify is engine-level, not Meta, but gets no file of
// its own until steps split further).

// Settle wait after the worker navigates to the composer: best-effort pause,
// not correctness load-bearing (a short settle degrades to one more attempt,
// never to filling the wrong page — the content script only fills on the
// composer URL).
const COMPOSER_SETTLE_MS = 2000;
const MAX_DRAFT_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const draftPostExecutor: Executor = async (_config, input, ctx) => {
  const { text, image } = input as { text: string; image?: FileRef };
  let imageDataUrl: string | undefined;
  if (image !== undefined) {
    if (!ctx.files) throw new Error("Photos aren't available on this server.");
    imageDataUrl = await ctx.files.dataUrl(image.fileId);
  }
  const payload = { text, ...(imageDataUrl !== undefined ? { imageDataUrl } : {}) };
  // The content script navigates to the composer when the tab is elsewhere
  // and reports { navigated: true }; re-call once it settles (same shape as
  // the calendar readDay retry).
  let last: { navigated?: unknown; textFilled?: unknown; imageCopied?: unknown } | null | undefined;
  for (let attempt = 0; attempt < MAX_DRAFT_ATTEMPTS; attempt += 1) {
    last = (await ctx.bridge.call('meta', 'draftPost', payload, undefined, {
      tab: 'active',
    })) as typeof last;
    if (last?.navigated !== true) break;
    if (attempt === MAX_DRAFT_ATTEMPTS - 1) {
      throw new Error("The Business Suite page didn't finish loading.");
    }
    await sleep(COMPOSER_SETTLE_MS);
  }
  // Fail closed: only a confirmed fill counts as prepared. A missing send
  // key is protocol-valid (and version skew can send garbage), so anything
  // but textFilled === true — and imageCopied === true when a photo went
  // along — is a loud step failure, never a false "prepared".
  if (last?.textFilled !== true) {
    throw new Error("The post text wasn't filled in Business Suite.");
  }
  if (image !== undefined && last?.imageCopied !== true) {
    throw new Error("The photo wasn't copied to the clipboard.");
  }
  return {
    output: { prepared: true },
    why:
      image !== undefined
        ? 'Prepared the post in Meta Business Suite; paste the photo and press Publish.'
        : 'Prepared the post in Meta Business Suite; check the text and press Publish.',
  };
};

// Test-mode preview: describes the post without touching Business Suite.
draftPostExecutor.preview = async (_config, input) => {
  const { image } = input as { image?: FileRef };
  return {
    output: { prepared: true },
    why:
      image !== undefined
        ? 'In a real run I would open a new post in Meta Business Suite with this text and photo.'
        : 'In a real run I would open a new post in Meta Business Suite with this text.',
  };
};

export const notifyExecutor: Executor = async (_config, input, ctx) => {
  const { text } = input as { text: string };
  // The engine injects its emitter into every step ctx, so a missing one is
  // a programming error (hand-rolled ctx), never a production state.
  if (!ctx.events) throw new Error('Notifications are not available on this server.');
  // The SSE route forwards engine events verbatim, so this lands in the app
  // as an in-app toast; the run itself stays done. Guarded like the
  // engine's own emit: listener errors are not run errors.
  try {
    ctx.events.emit('event', { type: 'notify', text });
  } catch {
    // Deliberately swallowed.
  }
  return { output: { notified: true }, why: `Told you: ${text}` };
};

// Test-mode preview: describes the message without toasting (a "Try it"
// must stay silent — same contract as every other act/store preview).
notifyExecutor.preview = async (_config, input, _ctx) => {
  const { text } = input as { text: string };
  return {
    output: { notified: true },
    why: `In a real run I would tell you: ${text}`,
  };
};
