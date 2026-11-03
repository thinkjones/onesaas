import { describe, expect, test } from 'vitest';
import { SITE_CAPABILITIES, siteOfUrl } from '../lib/sites.ts';

describe('siteOfUrl', () => {
  test('matches the three supported sites', () => {
    expect(siteOfUrl('https://mail.google.com/mail/u/0/#inbox')).toBe('gmail');
    expect(siteOfUrl('https://calendar.google.com/calendar/u/0/r/day')).toBe('calendar');
    expect(siteOfUrl('https://business.facebook.com/latest/home')).toBe('meta');
  });

  test('anything else is unknown', () => {
    expect(siteOfUrl('https://example.com/')).toBeNull();
    expect(siteOfUrl('chrome://newtab/')).toBeNull();
    expect(siteOfUrl(undefined)).toBeNull();
  });
});

describe('SITE_CAPABILITIES', () => {
  test('every site has a label and at least one capability', () => {
    for (const site of ['gmail', 'calendar', 'meta'] as const) {
      expect(SITE_CAPABILITIES[site].label.length).toBeGreaterThan(0);
      expect(SITE_CAPABILITIES[site].items.length).toBeGreaterThan(0);
    }
  });

  test('capabilities match the real content-script commands', () => {
    expect(SITE_CAPABILITIES.gmail.items).toContain('Read the email you have open');
    expect(SITE_CAPABILITIES.calendar.items).toContain('Create events');
    expect(SITE_CAPABILITIES.meta.items).toContain('Draft posts');
  });
});
