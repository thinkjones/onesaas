import { randomInt, randomUUID } from 'node:crypto';
import type { Database } from '../db/connection.js';

/** Minimal key-value surface the pairing logic needs. Backed by SQLite in prod. */
export interface PairingStore {
  get(k: string): string | undefined;
  set(k: string, v: string): void;
  del(k: string): void;
}

/** Storage key for the extension auth token. Lives outside M5's 'app' key. */
export const EXTENSION_TOKEN_KEY = 'extension.token';

/**
 * Storage key for the pairing generation: bumped on every redeem, never
 * reset, so a re-pair while paired is distinguishable from the old pairing.
 */
export const EXTENSION_GENERATION_KEY = 'extension.generation';

/** Storage key for the business timezone (IANA name, posted by the web app). */
export const TIMEZONE_KEY = 'app.timezone';

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
  /**
   * Which pairing the stored token belongs to: 0 when unpaired, else the
   * monotonic redeem count. The app's code screen completes when this moves.
   */
  generation(): number;
  /**
   * Forget the token AND kill pending codes: a code redeemed after revoke
   * must not resurrect a pairing. Idempotent.
   */
  revoke(): void;
}

/** The persisted redeem count; garbage reads 0 rather than poisoning the sequence. */
function readGeneration(store: PairingStore): number {
  const raw = store.get(EXTENSION_GENERATION_KEY);
  if (raw === undefined) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) || n < 0 ? 0 : n;
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
      store.set(EXTENSION_GENERATION_KEY, String(readGeneration(store) + 1));
      return token;
    },

    isValid(token: string) {
      const stored = store.get(EXTENSION_TOKEN_KEY);
      return stored !== undefined && stored === token;
    },

    paired() {
      return store.get(EXTENSION_TOKEN_KEY) !== undefined;
    },

    generation() {
      if (store.get(EXTENSION_TOKEN_KEY) === undefined) return 0;
      return readGeneration(store);
    },

    revoke() {
      pending.clear();
      store.del(EXTENSION_TOKEN_KEY);
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
  const delStmt = db.prepare('DELETE FROM "settings" WHERE "key" = ?');
  return {
    get: (k: string) => (getStmt.get(k) as { value: string } | undefined)?.value,
    set: (k: string, v: string) => {
      setStmt.run(k, v);
    },
    del: (k: string) => {
      delStmt.run(k);
    },
  };
}
