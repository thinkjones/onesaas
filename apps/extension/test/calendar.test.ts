// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readDayEvents, isOnDayPage } from '../lib/calendar/freeBusy.js';
import { createEventUrl, saveTemplateEvent } from '../lib/calendar/createEvent.js';
import fixture from './fixtures/calendar-day.html?raw';

// Wall-clock labels in the fixture ("9:00 AM") are interpreted in the local
// zone, so pin it: November 3 2026 is PST (UTC-8).
process.env.TZ = 'America/Los_Angeles';

beforeEach(() => {
  document.body.innerHTML = fixture;
});

describe('readDayEvents', () => {
  it('returns the fixture events with ISO start/end', () => {
    expect(readDayEvents(document)).toEqual([
      {
        title: 'Dentist checkup',
        start: '2026-11-03T17:00:00.000Z',
        end: '2026-11-03T18:00:00.000Z',
      },
      {
        title: 'Lunch with Priya, Bob',
        start: '2026-11-03T20:00:00.000Z',
        end: '2026-11-03T21:00:00.000Z',
      },
      {
        title: 'Fence quote – Sarah',
        start: '2026-11-03T23:00:00.000Z',
        end: '2026-11-04T00:00:00.000Z',
      },
    ]);
  });

  it('skips all-day chips that carry no times', () => {
    const titles = readDayEvents(document).map((e) => e.title);
    expect(titles).not.toContain('Election Day');
  });

  it('throws SELECTOR_MISSING when the day grid is absent', () => {
    document.body.innerHTML = '<div role="main"></div>';
    let caught: unknown;
    try {
      readDayEvents(document);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code?: unknown }).code).toBe('SELECTOR_MISSING');
  });
});

describe('isOnDayPage', () => {
  const DAY = 'https://calendar.google.com/calendar/r/day/2026/11/3';

  it.each([
    ['exact match', DAY, true],
    ['trailing slash', `${DAY}/`, true],
    ['query string', `${DAY}?tab=mc`, true],
    ['account segment', 'https://calendar.google.com/calendar/u/0/r/day/2026/11/3', true],
    ['different day', 'https://calendar.google.com/calendar/r/day/2026/11/4', false],
    ['month view', 'https://calendar.google.com/calendar/r/month/2026/11/1', false],
  ])('%s', (_label, href, expected) => {
    expect(isOnDayPage(href, DAY)).toBe(expected);
  });
});

describe('createEventUrl', () => {
  it('builds a template URL with wall-clock dates and ctz', () => {
    const url = createEventUrl({
      title: 'Fence quote – Sarah',
      start: '2026-11-03T15:00:00-08:00',
      end: '2026-11-03T16:00:00-08:00',
      timezone: 'America/Los_Angeles',
    });
    expect(url).toContain('dates=20261103T150000/20261103T160000');
    expect(url).toContain('ctz=America%2FLos_Angeles');
  });

  it('URL-encodes the title (the en-dash survives) and omits missing details', () => {
    const url = createEventUrl({
      title: 'Fence quote – Sarah',
      start: '2026-11-03T15:00:00-08:00',
      end: '2026-11-03T16:00:00-08:00',
      timezone: 'America/Los_Angeles',
    });
    expect(url).toContain('text=Fence%20quote%20%E2%80%93%20Sarah');
    expect(url).not.toContain('details=');
  });

  it('appends encoded details when provided', () => {
    const url = createEventUrl({
      title: 'Call',
      start: '2026-11-03T15:00:00-08:00',
      end: '2026-11-03T15:30:00-08:00',
      details: 'Bring the 40-person quote & samples',
      timezone: 'America/Los_Angeles',
    });
    expect(url).toContain('details=Bring%20the%2040-person%20quote%20%26%20samples');
  });
});

describe('saveTemplateEvent', () => {
  it('clicks the aria-labelled Save control', async () => {
    document.body.innerHTML =
      '<div role="main"><div role="button" aria-label="Save">Save</div></div>';
    const save = document.querySelector('[aria-label="Save"]') as HTMLElement;
    const clickSpy = vi.spyOn(save, 'click');
    await saveTemplateEvent(document);
    expect(clickSpy).toHaveBeenCalled();
  });

  it('falls back to a button with Save text', async () => {
    document.body.innerHTML = '<div role="main"><button>Save</button></div>';
    const save = document.querySelector('button') as HTMLElement;
    const clickSpy = vi.spyOn(save, 'click');
    await saveTemplateEvent(document);
    expect(clickSpy).toHaveBeenCalled();
  });

  it('throws HANDOFF when no Save control appears', async () => {
    document.body.innerHTML = '<div role="main"><p>loading…</p></div>';
    const err = await saveTemplateEvent(document, { timeoutMs: 20 }).then(
      () => null,
      (e: unknown) => e,
    );
    expect((err as { code?: unknown }).code).toBe('HANDOFF');
  });
});
