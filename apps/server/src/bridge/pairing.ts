import { randomInt, randomUUID } from 'node:crypto';
import type { Database } from '../db/connection.js';

/** Minimal key-value surface the pairing logic needs. Backed by SQLite in prod. */
export interface PairingStore {
  get(k: string): string | undefined;
  set(k: string, v: string): void;
}

/** Storage key for the extension auth token. Lives outside M5's 'app' key. */
export const EXTENSION_TOKEN_KEY = 'extension.token';

const CODE_TTL_MS = 10 * 60 * 1000;

export interface Pairing {
  /** Generate a NEW 6-digit code, replacing any prior pending code. */
  start(): { code: string };
  /** Single-use redeem: exact match + unexpired -> fresh token, else null. */
  redeem(code: string): string | null;
  /** True when the token equals the stored token (false when none stored). */
  isValid(token: string): boolean;
  /** True when a token is present in the store (for GET /api/pairing/status). */
  paired(): boolean;
}

export function createPairing(store: PairingStore): Pairing {
  // Pending codes are in-memory only: a restart invalidates them (acceptable).
  const pending = new Map<string, number>();

  return {
    start() {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      // A new code replaces any prior one: only the latest code can be redeemed.
      pending.clear();
      pending.set(code, Date.now() + CODE_TTL_MS);
      return { code };
    },

    redeem(code: string) {
      const trimmed = code.trim();
      const expiry = pending.get(trimmed);
      // Single-use: delete first so a concurrent/duplicate redeem fails.
      pending.delete(trimmed);
      if (expiry === undefined || Date.now() > expiry) return null;
      const token = randomUUID();
      store.set(EXTENSION_TOKEN_KEY, token);
      return token;
    },

    isValid(token: string) {
      const stored = store.get(EXTENSION_TOKEN_KEY);
      return stored !== undefined && stored === token;
    },

    paired() {
      return store.get(EXTENSION_TOKEN_KEY) !== undefined;
    },
  };
}

/** PairingStore backed by a `settings` key-value table (created if missing). */
export function createSettingsStore(db: Database): PairingStore {
  db.exec('CREATE TABLE IF NOT EXISTS "settings" ("key" TEXT PRIMARY KEY, "value" TEXT)');
  const getStmt = db.prepare('SELECT "value" AS value FROM "settings" WHERE "key" = ?');
  const setStmt = db.prepare(
    'INSERT INTO "settings" ("key", "value") VALUES (?, ?) ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"',
  );
  return {
    get: (k: string) => (getStmt.get(k) as { value: string } | undefined)?.value,
    set: (k: string, v: string) => {
      setStmt.run(k, v);
    },
  };
}
