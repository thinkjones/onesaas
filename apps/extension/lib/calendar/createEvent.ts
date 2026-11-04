import { TabError } from '../tabs.js';
import { SELECTORS } from './selectors.js';

export interface TemplateEvent {
  title: string;
  /** ISO datetimes; the wall clock as written pairs with `timezone` below. */
  start: string;
  end: string;
  details?: string;
  timezone: string;
}

// The wall clock as written (the offset is dropped: the template URL pairs
// these digits with ctz instead). Accepts an optional :ss and a space or T.
const ISO_WALL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

function wallTime(iso: string): string {
  const m = ISO_WALL.exec(iso);
  if (!m) throw new Error(`I couldn't read that date: "${iso}".`);
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6] ?? '00'}`;
}

/**
 * Google Calendar "create from template" URL: opening it shows the event
 * editor pre-filled, which saveTemplateEvent then saves (or the owner does).
 */
export function createEventUrl(o: TemplateEvent): string {
  const dates = `${wallTime(o.start)}/${wallTime(o.end)}`;
  let url =
    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent(o.title)}` +
    `&dates=${dates}` +
    `&ctz=${encodeURIComponent(o.timezone)}`;
  if (o.details !== undefined && o.details !== '') {
    url += `&details=${encodeURIComponent(o.details)}`;
  }
  return url;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Click Save on the template event page: [aria-label="Save"] first, else a
 * button whose text is exactly "Save". Polls briefly (the editor renders
 * async after navigation); when no Save control ever appears it throws
 * HANDOFF so the server tells the owner to press Save themselves.
 */
export async function saveTemplateEvent(
  doc: Document,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const deadline = Date.now() + (opts?.timeoutMs ?? 5000);
  for (;;) {
    const aria = doc.querySelector(SELECTORS.saveButton) as HTMLElement | null;
    const text =
      aria ??
      ((
        [...doc.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save') as
          | HTMLElement
          | undefined
      ) ?? null);
    if (text) {
      text.click();
      return;
    }
    if (Date.now() >= deadline) {
      throw new TabError('HANDOFF', "I couldn't find the Save button.");
    }
    await sleep(100);
  }
}
