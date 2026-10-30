import { TabError } from '../tabs.js';
import { SELECTORS } from './selectors.js';

export interface DayEvent {
  title: string;
  /** ISO 8601 (UTC): the wall-clock label read in the browser-local zone. */
  start: string;
  end: string;
}

// Assumed aria-label shape for a timed chip (kept consistent with
// test/fixtures/calendar-day.html until a real saved view replaces it):
//   "<title>, <Month D, YYYY>, <h:mm AM> – <h:mm AM>"
// The title is greedy (it may itself contain commas or dashes); the date
// anchor splits it from the range. Both en dash and hyphen-minus separate
// the range. All-day chips ("<title>, <Month D, YYYY>") never match and are
// skipped: free/busy only cares about timed events.
const LABEL_PATTERN =
  /^(.*), ([A-Z][a-z]+ \d{1,2}, \d{4}), (\d{1,2}:\d{2}\s?[AP]M)\s*[–-]\s*(\d{1,2}:\d{2}\s?[AP]M)$/;

// Known all-day chip shape: "<title>, <Month D, YYYY>" with no timed part.
// Anything matching neither pattern is an UNKNOWN shape (locale drift, new
// suffix) and must fail closed into the vision fallback, not skip silently.
const ALL_DAY_PATTERN = /^(.*), ([A-Z][a-z]+ \d{1,2}, \d{4})$/;

/**
 * Read the timed events on the open Calendar day view. Times are absolute
 * ISO strings so the server can compare them with the queried range without
 * re-interpreting wall clocks. Throws SELECTOR_MISSING when the grid is
 * absent (the server falls back to screenshot + vision), when a matched
 * label will not parse, or when a chip matches neither the timed nor the
 * all-day shape (the page looked different).
 */
export function readDayEvents(doc: Document): DayEvent[] {
  const grid = doc.querySelector(SELECTORS.dayGrid);
  if (!grid) throw new TabError('SELECTOR_MISSING', "I can't see the calendar day view.");
  const out: DayEvent[] = [];
  for (const el of grid.querySelectorAll(SELECTORS.event)) {
    const label = (el.getAttribute('aria-label') ?? '').trim();
    const m = LABEL_PATTERN.exec(label);
    if (!m) {
      if (ALL_DAY_PATTERN.test(label)) continue;
      throw new TabError('SELECTOR_MISSING', "I can't see the calendar day view.");
    }
    const [, title, date, start, end] = m;
    const startMs = Date.parse(`${date} ${start}`);
    const endMs = Date.parse(`${date} ${end}`);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      throw new TabError('SELECTOR_MISSING', "I can't see the calendar day view.");
    }
    out.push({
      title: title.trim(),
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
    });
  }
  return out;
}

/** Normalize a Calendar URL for day comparison: drop query/hash, the /u/N account segment, and trailing slashes. */
function normalizeDayHref(href: string): string {
  const bare = href.split(/[?#]/)[0] ?? href;
  return bare.replace(/\/u\/\d+(?=\/|$)/, '').replace(/\/+$/, '');
}

/** Whether `currentHref` is already the requested day view (no navigation needed). */
export function isOnDayPage(currentHref: string, targetUrl: string): boolean {
  return normalizeDayHref(currentHref) === normalizeDayHref(targetUrl);
}
