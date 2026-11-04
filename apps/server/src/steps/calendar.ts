import { z } from 'zod';
import { withVisionFallback } from '../bridge/vision.js';
import type { Executor } from './registry.js';

// Calendar reads run selector-first in a pinned worker tab (never moving
// The owner's view) with screenshot + vision fallback; event creation opens a
// pre-filled template in the ACTIVE tab (the owner sees it) and clicks Save,
// handing off to the owner when Save is missing.

/** Vision prompt for the day-view fallback (exact string, pinned by tests). */
export const FREEBUSY_VISION_PROMPT =
  'List every event visible on this calendar day with start and end times.';

// No screenshot sentence exists anywhere else in the codebase (checked); this
// is the M4 review-focus wording, appended to the free/busy why whenever the
// read came from vision instead of selectors.
const SCREENSHOT_SENTENCE =
  'I read your calendar from a screenshot because the page looked different.';

/** Handoff why when the template page shows no Save button (exact string). */
const HANDOFF_WHY = "I've filled in the event; press Save in Google Calendar.";

const FREE_WHY = "You're free then.";

// Settle waits after a worker/active-tab navigation: best-effort pauses, not
// correctness load-bearing. Reads self-heal through the vision fallback
// (which navigates + waits properly); creation retries are side-effect-free
// because nothing before the Save click persists anything.
const READDAY_SETTLE_MS = 1500;
const CREATE_SETTLE_MS = 2000;
const MAX_READDAY_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface CalEvent {
  title: string;
  start: string;
  end: string;
}

// The strict schema steers the model toward ISO datetimes; the prompt itself
// stays the exact pinned string, and parseEventTime tolerates time-only
// answers ("3:00 PM") when the model ignores the descriptions.
const visionEventSchema = z.object({
  title: z.string(),
  start: z
    .string()
    .describe(
      'Event start in ISO 8601 with timezone offset (e.g. 2026-11-03T15:00:00-08:00). If the day view shows only a time like "3:00 PM", return it as written.',
    ),
  end: z
    .string()
    .describe(
      'Event end in ISO 8601 with timezone offset (e.g. 2026-11-03T16:00:00-08:00). If the day view shows only a time like "4:00 PM", return it as written.',
    ),
});
const calendarVisionSchema = z.object({ events: z.array(visionEventSchema) });

/**
 * Day-view URL for the queried slot. Pre-Task-3 there is no business timezone
 * in StepContext, so the day comes from the input start's OWN offset (its
 * leading YYYY-MM-DD); non-ISO input falls back to server-local components.
 */
function dayViewUrl(startIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startIso);
  if (m) {
    return `https://calendar.google.com/calendar/r/day/${Number(m[1])}/${Number(m[2])}/${Number(m[3])}`;
  }
  const d = new Date(startIso);
  return `https://calendar.google.com/calendar/r/day/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// Anything carrying date information (ISO prefix, year, month name, slash
// date) parses as an absolute instant; anything else is a time-only vision
// answer read on the queried day, server-local — the same contract as the
// engine's approvalTime until the timezone setting lands.
function hasDateInfo(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}|\d{4}|[A-Za-z]{3,}|\d{1,2}\/\d{1,2}/.test(value);
}

function parseEventTime(value: string, queryStartIso: string): number {
  if (hasDateInfo(value)) return Date.parse(value);
  return Date.parse(`${queryStartIso.slice(0, 10)} ${value}`);
}

// Server-local rendering, mirroring the engine's approvalTime idiom.
function formatTime(ms: number): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(
    new Date(ms),
  );
}

function formatDay(ms: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(new Date(ms));
}

// Config templates only know {{title}} (configs never see workflow bindings,
// so the jexl {{expr}} idiom does not apply). No placeholder: verbatim.
function applyTitleTemplate(template: string | undefined, title: string): string {
  if (template === undefined) return title;
  return template.includes('{{title}}') ? template.replaceAll('{{title}}', title) : template;
}

function errCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

export const freeBusyExecutor: Executor = async (_config, input, ctx) => {
  const { start, end } = input as { start: string; end: string };
  const queryStartMs = Date.parse(start);
  const queryEndMs = Date.parse(end);
  // Fail-safe: NaN comparisons would silently report free.
  if (Number.isNaN(queryStartMs)) throw new Error(`I couldn't read that time: "${start}".`);
  if (Number.isNaN(queryEndMs)) throw new Error(`I couldn't read that time: "${end}".`);
  const dayUrl = dayViewUrl(start);

  // Navigate-aware read: the content script reports { navigated: true } when
  // the worker tab was off-page, and we re-read once it settles. Each attempt
  // keeps its own vision fallback (whose screenshot self-navigates), so a
  // short settle degrades to one vision read, never to a wrong read.
  let events: CalEvent[] | undefined;
  let viaScreenshot = false;
  let model: string | undefined;
  let costUsd: number | undefined;
  for (let attempt = 0; attempt < MAX_READDAY_ATTEMPTS; attempt += 1) {
    const read = await withVisionFallback({
      bridge: ctx.bridge,
      gateway: ctx.gateway,
      site: 'calendar',
      action: 'readDay',
      input: { url: dayUrl },
      screenshotUrl: dayUrl,
      prompt: FREEBUSY_VISION_PROMPT,
      schema: calendarVisionSchema,
      tab: 'worker',
    });
    if (read.viaScreenshot) {
      events = read.data.events;
      viaScreenshot = true;
      model = read.model;
      costUsd = read.costUsd;
      break;
    }
    const data = read.data as { navigated?: unknown; events?: unknown };
    if (data.navigated === true) {
      if (attempt === MAX_READDAY_ATTEMPTS - 1) {
        throw new Error("The calendar page didn't finish loading.");
      }
      await sleep(READDAY_SETTLE_MS);
      continue;
    }
    if (!Array.isArray(data.events)) throw new Error("I couldn't read your calendar.");
    events = data.events as CalEvent[];
    break;
  }

  // Event overlaps [start, end) iff event.start < end && event.end > start.
  const timed = (events ?? []).map((e) => {
    const startMs = parseEventTime(e.start, start);
    const endMs = parseEventTime(e.end, start);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      throw new Error(`I couldn't read one of your calendar events ("${e.title}").`);
    }
    return { event: e, startMs, endMs };
  });
  const clashes = timed
    .filter((t) => t.startMs < queryEndMs && t.endMs > queryStartMs)
    .sort((a, b) => a.startMs - b.startMs)
    .map((t) => ({ title: t.event.title, start: t.event.start, end: t.event.end }));

  const free = clashes.length === 0;
  const first: CalEvent | undefined = clashes[0];
  let why =
    free || first === undefined
      ? FREE_WHY
      : `That clashes with "${first.title}" at ${formatTime(parseEventTime(first.start, start))}.`;
  if (viaScreenshot) why += ` ${SCREENSHOT_SENTENCE}`;
  return {
    output: { free, clashes },
    why,
    ...(model === undefined ? {} : { model, costUsd }),
  };
};

export const createEventExecutor: Executor = async (config, input, ctx) => {
  const { title, start, end, details } = input as {
    title: string;
    start: string;
    end: string;
    details?: string;
  };
  const finalTitle = applyTitleTemplate(
    (config as { titleTemplate?: string }).titleTemplate,
    title,
  );
  const payload = {
    title: finalTitle,
    start,
    end,
    ...(details === undefined ? {} : { details }),
  };
  // The HANDOFF code is bridge-level (content script found no Save button);
  // StepResult/StepRun have no code field, so the executor consumes it here
  // into output + why. Anything else propagates and fails the step.
  try {
    const first = (await ctx.bridge.call(
      'calendar',
      'createEvent',
      { ...payload, navigate: true },
      undefined,
      { tab: 'active' },
    )) as { navigated?: unknown } | null | undefined;
    if (first?.navigated !== true) throw new Error("I couldn't open the new event page.");
    await sleep(CREATE_SETTLE_MS);
    await ctx.bridge.call('calendar', 'createEvent', { ...payload, navigate: false }, undefined, {
      tab: 'active',
    });
  } catch (err) {
    if (errCode(err) === 'HANDOFF') return { output: { created: false }, why: HANDOFF_WHY };
    throw err;
  }
  return { output: { created: true }, why: `Added "${finalTitle}" to your calendar.` };
};

// Test-mode preview: describes the event without touching Calendar.
createEventExecutor.preview = async (config, input, _ctx) => {
  const { title, start } = input as { title: string; start: string };
  const finalTitle = applyTitleTemplate(
    (config as { titleTemplate?: string }).titleTemplate,
    title,
  );
  const ms = Date.parse(start);
  if (Number.isNaN(ms)) throw new Error(`I couldn't read that date: "${start}".`);
  return {
    output: { created: true },
    why: `In a real run I would add "${finalTitle}" to your calendar on ${formatDay(ms)} at ${formatTime(ms)}.`,
  };
};
