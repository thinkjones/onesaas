import type { Database } from '../db/connection.js';
import {
  TIMEZONE_KEY,
  createSettingsStore as createKvStore,
  type PairingStore,
} from '../bridge/pairing.js';

/** M5 Task 1: the app-wide settings document (business profile, look). */

export type TextSize = 'normal' | 'large' | 'xlarge';

export interface Settings {
  businessName?: string;
  businessWhat?: string;
  /** IANA zone; '' until the web app's first-load sync stores the browser zone. */
  timezone: string;
  textSize: TextSize;
  onboarded: boolean;
  moodFileIds: string[];
  /** The business type from onboarding, or null if none fits. */
  vertical: string | null;
  /** Playbook ids the owner highlighted in onboarding. Nothing is built from them. */
  interests: number[];
  interestsNote: string;
}

/** Key of the JSON settings document in the M1 `settings` key-value table. */
export const APP_SETTINGS_KEY = 'app';

export function defaultSettings(): Settings {
  return {
    timezone: '',
    textSize: 'normal',
    onboarded: false,
    moodFileIds: [],
    vertical: null,
    interests: [],
    interestsNote: '',
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
  pick('vertical', (v) => v === null || typeof v === 'string');
  pick('interests', (v) => Array.isArray(v) && v.every((id) => typeof id === 'number'));
  pick('interestsNote', (v) => typeof v === 'string');
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
    const next = coerce({ ...current, ...patch }, undefined);
    // A patch never resurrects the legacy key: once the document exists it
    // is the timezone's home (get() prefers it over the legacy key).
    store.set(APP_SETTINGS_KEY, JSON.stringify(next));
    store.del(TIMEZONE_KEY);
    return next;
  };
  return { get, update };
}
