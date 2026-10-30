// ALL Meta Business Suite DOM selectors live here. Nothing outside this
// file may hardcode a Meta selector, so a markup change is a one-file fix.
// Starting guesses (UNVERIFIED against live Business Suite — the composer is
// a contenteditable box with a photo-attachment control beside it); verified
// only against test/fixtures/meta-composer.html (SYNTHETIC — see its
// header). Step 5 of the M4 plan replaces guesses with live selectors.

export const SELECTORS = {
  /** The composer's message box; absent means the page looked different. */
  composer: 'div[contenteditable="true"]',
  /** The photo-attachment control the paste hint points at. */
  mediaArea: '[aria-label="Add photos or video"]',
} as const;
