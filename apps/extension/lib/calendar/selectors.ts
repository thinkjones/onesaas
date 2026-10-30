// ALL Calendar DOM selectors live here. Nothing outside this file may
// hardcode a Calendar selector, so a Calendar markup change is a one-file
// fix. Starting points modeled on the Calendar day view and event editor
// (event chips carry data-eventid + descriptive aria-labels); verified
// against test/fixtures/calendar-day.html (SYNTHETIC — see its header).

export const SELECTORS = {
  /** Day-view grid; absent means the page looked different (vision fallback). */
  dayGrid: '[role="grid"]',
  /** Event chips, timed and all-day; timed ones parse from the aria-label. */
  event: '[data-eventid]',
  /** Event-editor Save control (primary; text-"Save" button is the fallback). */
  saveButton: '[aria-label="Save"]',
} as const;
