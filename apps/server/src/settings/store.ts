import type { Database } from '../db/connection.js';
import {
  TIMEZONE_KEY,
  createSettingsStore as createKvStore,
  type PairingStore,
} from '../bridge/pairing.js';

/** M5 Task 1: the app-wide settings document (business profile, look, sound). */

export type TextSize = 'normal' | 'large' | 'xlarge';

export interface Settings {
  businessName?: string;
  businessWhat?: string;
  /** IANA zone; '' until the web app's first-load sync stores the browser zone. */
  timezone: string;
  textSize: TextSize;
  sound: { on: boolean; volume: number };
  onboarded: boolean;
  moodFileIds: string[];
}

/** Key of the JSON settings document in the M1 `settings` key-value table. */
export const APP_SETTINGS_KEY = 'app';

/** Sound stays silent until Dad's first interaction unlocks it (Task 2); the
 * stored default is on at 0.25 — the unlock gate lives in the web app, not here. */
export function defaultSettings(): Settings {
  return {
    timezone: '',
    textSize: 'normal',
    sound: { on: true, volume: 0.25 },
    onboarded: false,
    moodFileIds: [],
  };
}

export interface SettingsStore {
  get(): Settings;
  update(patch: Partial<Settings>): Settings;
}

function coerce(stored: unknown, legacyTimezone: string | undefined): Settings {
  const base = defaultSettings();
  if (legacyTimezone !== undefined && legacyTimezone !== '') base.timezone = legacyTimezone;
  if (typeof stored !== 'object' || stored === null) return base;
  const doc = stored as Record<string, unknown>;
  const out = base as unknown as Record<string, unknown>;
  const pick = <K extends keyof Settings>(key: K, valid: (v: unknown) => boolean): void => {
    if (valid(doc[key])) out[key] = doc[key];
  };
  pick('businessName', (v) => typeof v === 'string');
  pick('businessWhat', (v) => typeof v === 'string');
  pick('timezone', (v) => typeof v === 'string');
  pick('textSize', (v) => v === 'normal' || v === 'large' || v === 'xlarge');
  pick('onboarded', (v) => typeof v === 'boolean');
  pick(
    'moodFileIds',
    (v) => Array.isArray(v) && v.every((id) => typeof id === 'string'),
  );
  if (typeof doc['sound'] === 'object' && doc['sound'] !== null) {
    const sound = doc['sound'] as Record<string, unknown>;
    if (typeof sound['on'] === 'boolean') base.sound.on = sound['on'];
    if (typeof sound['volume'] === 'number' && sound['volume'] >= 0 && sound['volume'] <= 1) {
      base.sound.volume = sound['volume'];
    }
  }
  return base;
}

/**
 * The settings document backed by the M1 `settings` key-value table (key
 * 'app'). Unknown/corrupt fields fall back to defaults rather than throwing,
 * and a pre-M5 `app.timezone` value migrates in as the timezone until the
 * document is first written.
 */
export function createSettingsStore(db: Database, kv?: PairingStore): SettingsStore {
  const store = kv ?? createKvStore(db);
  const get = (): Settings => {
    const raw = store.get(APP_SETTINGS_KEY);
    let parsed: unknown;
    if (raw !== undefined) {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        parsed = undefined;
      }
    }
    return coerce(parsed, store.get(TIMEZONE_KEY));
  };
  const update = (patch: Partial<Settings>): Settings => {
    const current = get();
    // Sound patches merge field-wise: { on } must not reset the volume.
    const sound =
      patch.sound === undefined ? current.sound : { ...current.sound, ...patch.sound };
    const next = coerce({ ...current, ...patch, sound }, undefined);
    // A patch never resurrects the legacy key: once the document exists it
    // is the timezone's home (get() prefers it over the legacy key).
    store.set(APP_SETTINGS_KEY, JSON.stringify(next));
    store.del(TIMEZONE_KEY);
    return next;
  };
  return { get, update };
}
