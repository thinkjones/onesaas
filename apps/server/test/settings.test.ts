import { expect, test } from 'vitest';
import { TIMEZONE_KEY } from '../src/bridge/pairing.js';
import { openDb } from '../src/db/connection.js';
import { createSettingsStore, defaultSettings } from '../src/settings/store.js';

test("update({ textSize: 'large' }) persists across a new store instance", () => {
  const db = openDb(':memory:');
  try {
    createSettingsStore(db).update({ textSize: 'large' });
    expect(createSettingsStore(db).get().textSize).toBe('large');
  } finally {
    db.close();
  }
});

test('a fresh store returns the defaults', () => {
  const db = openDb(':memory:');
  try {
    expect(createSettingsStore(db).get()).toEqual(defaultSettings());
  } finally {
    db.close();
  }
});

test('update merges a patch and returns the full settings', () => {
  const db = openDb(':memory:');
  try {
    const store = createSettingsStore(db);
    const next = store.update({ businessName: 'Corner Bakery', textSize: 'large' });
    expect(next.businessName).toBe('Corner Bakery');
    expect(next.textSize).toBe('large');
    expect(next.onboarded).toBe(false);
    expect(store.get()).toEqual(next);
  } finally {
    db.close();
  }
});

test('a pre-M5 stored timezone migrates into the new settings', () => {
  const db = openDb(':memory:');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS "settings" ("key" TEXT PRIMARY KEY, "value" TEXT)');
    db.prepare('INSERT INTO "settings" ("key", "value") VALUES (?, ?)').run(
      TIMEZONE_KEY,
      'Europe/Paris',
    );
    expect(createSettingsStore(db).get().timezone).toBe('Europe/Paris');
  } finally {
    db.close();
  }
});
