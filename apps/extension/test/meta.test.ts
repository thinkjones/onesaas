// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPOSER_URL,
  PASTE_HINT,
  isOnComposerPage,
  prepareDraftPost,
} from '../lib/meta/draftPost.js';
import { SELECTORS } from '../lib/meta/selectors.js';
import fixture from './fixtures/meta-composer.html?raw';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// The server's dataUrl() returns the STORED mime (image/jpeg for every
// non-PNG upload), so the clipboard payload must carry the data URL's own
// mime — never a hardcoded image/png.
const JPEG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP////////////////////////////////////////////2wBDAf////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AH//Z';

// Minimal ClipboardItem stand-in: captures what would be written so the test
// can assert the mime type and blob without a real clipboard.
class FakeClipboardItem {
  readonly types: string[];
  readonly data: Record<string, unknown>;
  constructor(data: Record<string, unknown>) {
    this.types = Object.keys(data);
    this.data = data;
  }
}

beforeEach(() => {
  document.body.innerHTML = fixture;
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  Object.defineProperty(navigator, 'clipboard', {
    value: { write: vi.fn(async () => {}) },
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('prepareDraftPost', () => {
  it('fills the composer text, copies the photo, and shows the paste hint', async () => {
    const result = await prepareDraftPost(document, {
      text: 'Fresh sourdough this Saturday!',
      imageDataUrl: PNG_1PX,
    });
    expect(result).toEqual({ textFilled: true, imageCopied: true });
    expect(document.querySelector(SELECTORS.composer)?.textContent).toBe(
      'Fresh sourdough this Saturday!',
    );
    const write = navigator.clipboard.write as unknown as ReturnType<typeof vi.fn>;
    expect(write).toHaveBeenCalledTimes(1);
    const items = write.mock.calls[0]![0] as FakeClipboardItem[];
    expect(items).toHaveLength(1);
    expect(items[0]).toBeInstanceOf(FakeClipboardItem);
    expect(items[0]!.types).toEqual(['image/png']);
    expect(items[0]!.data['image/png']).toBeInstanceOf(Blob);
    const hint = document.querySelector('[data-dad-meta-hint]');
    expect(hint?.textContent).toBe(PASTE_HINT);
    expect(PASTE_HINT).toBe(
      "Your photo is copied. Click here and press ⌘V, then Publish when you're happy.",
    );
  });

  it('copies a JPEG photo under image/jpeg, not image/png', async () => {
    const result = await prepareDraftPost(document, {
      text: 'Fresh sourdough this Saturday!',
      imageDataUrl: JPEG_1PX,
    });
    expect(result).toEqual({ textFilled: true, imageCopied: true });
    const write = navigator.clipboard.write as unknown as ReturnType<typeof vi.fn>;
    expect(write).toHaveBeenCalledTimes(1);
    const items = write.mock.calls[0]![0] as FakeClipboardItem[];
    expect(items).toHaveLength(1);
    expect(items[0]!.types).toEqual(['image/jpeg']);
    const blob = items[0]!.data['image/jpeg'] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/jpeg');
  });

  it('shows no hint and copies nothing when no photo is given', async () => {
    const result = await prepareDraftPost(document, { text: 'Just words.' });
    expect(result).toEqual({ textFilled: true, imageCopied: false });
    expect(document.querySelector(SELECTORS.composer)?.textContent).toBe('Just words.');
    expect(navigator.clipboard.write as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(document.querySelector('[data-dad-meta-hint]')).toBeNull();
  });

  it('throws SELECTOR_MISSING when the composer is absent', async () => {
    document.body.innerHTML = '<div role="main"><p>Something else entirely</p></div>';
    let caught: unknown;
    try {
      await prepareDraftPost(document, { text: 'Hello', imageDataUrl: PNG_1PX });
    } catch (e) {
      caught = e;
    }
    expect((caught as { code?: unknown }).code).toBe('SELECTOR_MISSING');
  });

  it('keeps a single hint when called twice', async () => {
    await prepareDraftPost(document, { text: 'One', imageDataUrl: PNG_1PX });
    await prepareDraftPost(document, { text: 'Two', imageDataUrl: PNG_1PX });
    expect(document.querySelectorAll('[data-dad-meta-hint]')).toHaveLength(1);
    expect(document.querySelector(SELECTORS.composer)?.textContent).toBe('Two');
  });
});

describe('isOnComposerPage', () => {
  it('matches the composer URL with or without query params', () => {
    expect(COMPOSER_URL).toBe('https://business.facebook.com/latest/composer');
    expect(isOnComposerPage(COMPOSER_URL)).toBe(true);
    expect(isOnComposerPage(`${COMPOSER_URL}?ref=cala`)).toBe(true);
    expect(isOnComposerPage('https://business.facebook.com/latest/home')).toBe(false);
  });
});
