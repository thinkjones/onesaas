import OpenAI from 'openai';
import type { PairingStore } from '../bridge/pairing.js';
import { META_BASE_URL } from './image.js';

const BASE_URL_KEY = 'model.baseUrl';
const API_KEY_KEY = 'model.apiKey';
const MODEL_KEY = 'model.model';

// OpenAI-compatible local servers often ignore the key, but the SDK requires one.
const NO_KEY = 'unconfigured';

export interface ModelConnection {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

/** What Settings may see: the key itself never leaves the server. */
export interface PublicModelConnection {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}

export interface ModelConnectionPatch {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export class ModelConnectionRejected extends Error {}

export type ModelKeyStatus = 'ok' | 'missing' | 'rejected' | 'unknown';

const KEY_CHECK_TIMEOUT_MS = 8000;

/**
 * The saved endpoint lives in its own settings rows, not the settings document,
 * so GET /api/settings can never return the key. An empty patch value clears a
 * field, and moving to another endpoint forgets the old key rather than sending
 * it to a new host.
 */
export function createModelConnectionStore(kv: PairingStore) {
  const get = (): ModelConnection => ({
    baseUrl: kv.get(BASE_URL_KEY),
    apiKey: kv.get(API_KEY_KEY),
    model: kv.get(MODEL_KEY),
  });

  const write = (key: string, value: string | undefined): void => {
    if (value === undefined || value === '') kv.del(key);
    else kv.set(key, value);
  };

  return {
    get,
    getPublic(): PublicModelConnection {
      const c = get();
      return { baseUrl: c.baseUrl ?? '', model: c.model ?? '', hasApiKey: c.apiKey !== undefined };
    },
    update(patch: ModelConnectionPatch): PublicModelConnection {
      const current = get();
      const baseUrl =
        patch.baseUrl === undefined ? current.baseUrl : normaliseBaseUrl(patch.baseUrl);
      const model = patch.model === undefined ? current.model : patch.model.trim() || undefined;
      if (baseUrl && !model) {
        throw new ModelConnectionRejected('Name the model to use on this endpoint.');
      }
      const movedEndpoint = (baseUrl ?? '') !== (current.baseUrl ?? '');
      const apiKey = patch.apiKey?.trim() ?? (movedEndpoint ? undefined : current.apiKey);
      write(BASE_URL_KEY, baseUrl);
      write(MODEL_KEY, baseUrl ? model : undefined);
      write(API_KEY_KEY, apiKey);
      return this.getPublic();
    },
  };
}

export type ModelConnectionStore = ReturnType<typeof createModelConnectionStore>;

function normaliseBaseUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ModelConnectionRejected('That endpoint is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ModelConnectionRejected('The endpoint must start with http:// or https://.');
  }
  return trimmed.replace(/\/+$/, '');
}

/**
 * The model clients, read from the store on every call so saving in Settings
 * (or a data reset) takes effect without a restart.
 *
 * Chat, agent and vision calls follow a custom endpoint when one is saved.
 * Image, SAM and voice are Meta-only APIs, so they stay on Meta and use the
 * Meta key. The two keys never cross: a custom endpoint never receives
 * MODEL_API_KEY, and a custom endpoint's key is never sent to Meta.
 */
export function createModelClients(d: { store: ModelConnectionStore; envApiKey?: string }) {
  const cache = new Map<string, OpenAI>();
  const clientFor = (baseURL: string, apiKey: string): OpenAI => {
    const id = JSON.stringify([baseURL, apiKey]);
    let client = cache.get(id);
    if (!client) {
      client = new OpenAI({ baseURL, apiKey });
      cache.clear(); // Only the current connection is worth keeping.
      cache.set(id, client);
    }
    return client;
  };
  let metaCached: { apiKey: string; client: OpenAI } | undefined;

  const metaApiKey = (): string | undefined => {
    const c = d.store.get();
    return c.baseUrl ? d.envApiKey : (c.apiKey ?? d.envApiKey);
  };
  const metaClient = (): OpenAI => {
    const apiKey = metaApiKey() ?? NO_KEY;
    if (metaCached?.apiKey !== apiKey) {
      metaCached = { apiKey, client: new OpenAI({ baseURL: META_BASE_URL, apiKey }) };
    }
    return metaCached.client;
  };

  return {
    /** Chat completions: the custom endpoint when saved, else Meta. */
    chat: {
      get chat() {
        const c = d.store.get();
        return (c.baseUrl ? clientFor(c.baseUrl, c.apiKey ?? NO_KEY) : metaClient()).chat;
      },
    } as Pick<OpenAI, 'chat'>,
    /** Meta's API, for its image endpoints. */
    meta: {
      get images() {
        return metaClient().images;
      },
    } as Pick<OpenAI, 'images'>,
    metaApiKey,
    /**
     * Can the current key sign in? Listing models is free and needs a valid key.
     * Only a clear no counts as rejected: a server without that route, or one
     * that's offline, says nothing about the key.
     */
    async checkKey(): Promise<ModelKeyStatus> {
      const c = d.store.get();
      if (!c.baseUrl && metaApiKey() === undefined) return 'missing';
      const client = c.baseUrl ? clientFor(c.baseUrl, c.apiKey ?? NO_KEY) : metaClient();
      try {
        await client.models.list({ timeout: KEY_CHECK_TIMEOUT_MS, maxRetries: 0 });
        return 'ok';
      } catch (err) {
        const status = (err as { status?: unknown }).status;
        return status === 401 || status === 403 ? 'rejected' : 'unknown';
      }
    },
    /** The model every chat role uses while a custom endpoint is saved. */
    customModel(): string | undefined {
      const c = d.store.get();
      return c.baseUrl ? c.model : undefined;
    },
  };
}
