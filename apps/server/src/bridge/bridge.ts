import { randomUUID } from 'node:crypto';
import { ExtensionToServer, type ServerToExtension, type TriggerMsg } from '@dad/shared';
import type { Pairing } from './pairing.js';

export type BridgeSite = 'gmail' | 'calendar' | 'meta';

/** User-facing message per site when the extension cannot run the call. */
const SITE_MESSAGES: Record<BridgeSite, string> = {
  gmail: 'I need Gmail open in Chrome to do this.',
  calendar: 'I need Google Calendar open in Chrome to do this.',
  meta: 'I need Meta Business Suite open in Chrome to do this.',
};

/**
 * Transport-neutral socket surface the bridge drives. app.ts adapts hono's
 * WSContext to this; tests drive attach() directly with fakes.
 */
export interface WSContext {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onmessage?: ((data: string) => void) | null;
  onclose?: (() => void) | null;
}

export interface Bridge {
  call(site: BridgeSite, action: string, input: unknown, timeoutMs?: number): Promise<unknown>;
  connected(): boolean;
  /** Push a message (runStatus, buttons, ...) to the active socket; no-op when none. */
  send(msg: ServerToExtension): void;
  onTrigger(fn: (t: TriggerMsg) => void): void;
  /** Fires after every successful hello (including re-hello on the same socket). */
  onReady(fn: () => void): void;
}

interface PendingCall {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  site: BridgeSite;
}

export function createBridge(o: {
  pairing: Pairing;
  defaultTimeoutMs?: number;
}): Bridge & { attach(ws: WSContext): void } {
  const pairing = o.pairing;
  const defaultTimeoutMs = o.defaultTimeoutMs ?? 30_000;

  // The single authed socket; set only by a valid hello, never by attach().
  let active: WSContext | null = null;
  const pending = new Map<string, PendingCall>();
  const triggerFns: Array<(t: TriggerMsg) => void> = [];
  const readyFns: Array<() => void> = [];

  function sendTo(ws: WSContext, msg: ServerToExtension): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // A dead socket must not stay active; a failed send to a non-active
      // socket (e.g. pair reply) leaves the active socket untouched.
      if (active === ws) active = null;
    }
  }

  function failAllPending(): void {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(SITE_MESSAGES[p.site]));
    }
    pending.clear();
  }

  function handleMessage(ws: WSContext, raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return; // Malformed JSON: ignore silently (forward-compatible).
    }
    const parsed = ExtensionToServer.safeParse(json);
    if (!parsed.success) return; // Wrong-direction/unknown messages: ignore silently.
    const msg = parsed.data;
    const isActive = ws === active;

    switch (msg.type) {
      case 'pair': {
        // Allowed pre-auth. Failure is ignored: the popup implements its own timeout.
        const token = pairing.redeem(msg.code);
        if (token !== null) sendTo(ws, { type: 'paired', token });
        break;
      }
      case 'hello': {
        if (!pairing.isValid(msg.token)) {
          ws.close(4401, 'Invalid token');
          break;
        }
        if (active !== null && active !== ws) active.close(4400, 'Replaced');
        active = ws;
        // Buttons start empty; Task 9 sends the real set via onReady.
        sendTo(ws, { type: 'ready', buttons: [] });
        for (const fn of readyFns) fn();
        break;
      }
      case 'ping': {
        // Harmless keep-alive: allowed pre-auth.
        sendTo(ws, { type: 'pong' });
        break;
      }
      case 'trigger': {
        // Auth required: pre-auth triggers are dropped.
        if (!isActive) break;
        for (const fn of triggerFns) fn(msg);
        break;
      }
      case 'result': {
        // Auth required; unknown ids (late/duplicate replies) are ignored.
        if (!isActive) break;
        const p = pending.get(msg.id);
        if (!p) break;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.output);
        else p.reject(new Error(msg.error));
        break;
      }
    }
  }

  function attach(ws: WSContext): void {
    ws.onmessage = (data: string) => handleMessage(ws, data);
    ws.onclose = () => {
      // Only the active socket's close tears down the session: a replaced
      // socket's late close must not clear its replacement.
      if (active === ws) {
        active = null;
        failAllPending();
      }
    };
  }

  function call(
    site: BridgeSite,
    action: string,
    input: unknown,
    timeoutMs: number = defaultTimeoutMs,
  ): Promise<unknown> {
    const socket = active;
    // Not connected: reject immediately (no timer) with the site message.
    if (socket === null) return Promise.reject(new Error(SITE_MESSAGES[site]));
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(SITE_MESSAGES[site]));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer, site });
      try {
        socket.send(JSON.stringify({ type: 'cmd', id, site, action, input }));
      } catch {
        pending.delete(id);
        clearTimeout(timer);
        if (active === socket) active = null;
        reject(new Error(SITE_MESSAGES[site]));
      }
    });
  }

  function send(msg: ServerToExtension): void {
    const socket = active;
    if (socket === null) return; // No-op when no extension is connected.
    sendTo(socket, msg);
  }

  return {
    call,
    connected: () => active !== null,
    send,
    onTrigger: (fn: (t: TriggerMsg) => void) => {
      triggerFns.push(fn);
    },
    onReady: (fn: () => void) => {
      readyFns.push(fn);
    },
    attach,
  };
}
