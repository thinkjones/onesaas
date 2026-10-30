import type { z } from 'zod';
import type { Bridge, BridgeSite, BridgeTab } from './bridge.js';
import type { Gateway } from '../models/gateway.js';

export interface VisionFallbackOptions<T> {
  bridge: Pick<Bridge, 'call'>;
  gateway: Pick<Gateway, 'visionJson'>;
  site: BridgeSite;
  action: string;
  input: unknown;
  /** URL the worker tab navigates to before the fallback screenshot. */
  screenshotUrl?: string;
  /** Vision prompt describing the JSON to extract from the screenshot. */
  prompt: string;
  schema: z.ZodType<T>;
  /** Which tab the read runs in; unset keeps the bridge default (active). */
  tab?: BridgeTab;
}

export interface VisionFallbackResult<T> {
  data: T;
  viaScreenshot: boolean;
  model?: string;
  costUsd?: number;
}

/**
 * Reliability-ladder read: try the selector action first; ONLY on
 * `code === 'SELECTOR_MISSING'` fall back to screenshot + vision. Any other
 * error (NOT_OPEN/TIMEOUT/HANDOFF/plain) propagates UNCHANGED, and the
 * success path never touches the gateway.
 *
 * The vision schemaName is the action name: visionJson needs one and the
 * action is the stable per-read identifier later tasks share.
 */
export async function withVisionFallback<T>(
  o: VisionFallbackOptions<T>,
): Promise<VisionFallbackResult<T>> {
  // Tab unset: the exact 3-arg call shape as before, so existing callers and
  // fakes see byte-identical invocations.
  const callAction = (action: string, input: unknown): Promise<unknown> =>
    o.tab === undefined
      ? o.bridge.call(o.site, action, input)
      : o.bridge.call(o.site, action, input, undefined, { tab: o.tab });
  try {
    const output = await callAction(o.action, o.input);
    return { data: output as T, viaScreenshot: false };
  } catch (err) {
    if ((err as { code?: unknown } | null | undefined)?.code !== 'SELECTOR_MISSING') throw err;
  }
  const shot = (await callAction('screenshot', {
    site: o.site,
    ...(o.screenshotUrl === undefined ? {} : { url: o.screenshotUrl }),
  })) as { dataUrl?: unknown } | null | undefined;
  if (typeof shot?.dataUrl !== 'string') {
    throw new Error('Screenshot did not return a data URL.');
  }
  const vision = await o.gateway.visionJson({
    role: 'vision',
    prompt: o.prompt,
    imageDataUrl: shot.dataUrl,
    schema: o.schema,
    schemaName: o.action,
  });
  return { data: vision.data, viaScreenshot: true, model: vision.model, costUsd: vision.costUsd };
}
