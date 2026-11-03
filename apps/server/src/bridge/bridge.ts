import { randomUUID } from 'node:crypto';
import { ExtensionToServer, type ServerToExtension, type TriggerMsg } from '@dad/shared';
import type { Pairing } from './pairing.js';

export type BridgeSite = 'gmail' | 'calendar' | 'meta';

/** Which tab a cmd runs in: a pinned background worker tab, or a visible one. */
export type BridgeTab = 'worker' | 'active';

/**
 * Rejection from bridge.call. `message` is the human-readable string (every
 * pre-existing message is unchanged); `code` is the machine-readable reason
 * when the extension supplied one, or the bridge's own NOT_OPEN/TIMEOUT for
 * local failures (not connected, send failed, socket dropped, timed out).
 */
export class BridgeError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'BridgeError';
    if (code !== undefined) this.code = code;
  }
}

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
  onclose?: ((code?: number) => void) | null;
}

/** One timestamped bridge diagnostic line, exposed via GET /api/debug/events. */
export interface BridgeEvent {
  t: string;
  msg: string;
}

export interface Bridge {
  call(
    site: BridgeSite,
    action: string,
    input: unknown,
    timeoutMs?: number,
    opts?: { tab?: BridgeTab },
  ): Promise<unknown>;
  connected(): boolean;
  /** Push a message (runStatus, buttons, ...) to the active socket; no-op when none. */
  send(msg: ServerToExtension): void;
  onTrigger(fn: (t: TriggerMsg) => void): void;
  /** Fires after every successful hello (including re-hello on the same socket). */
  onReady(fn: () => void): void;
  /**
   * Drop the active socket (4401) and fail in-flight calls. Idempotent.
   * Revoke needs this: clearing the token alone would leave the old socket
   * authorized until its next hello.
   */
  dropActive(reason?: string): void;
  /**
   * Round-trip a correlated ping through the active socket. Resolves true on
   * the matching pong; false when no socket is attached, the send fails, or
   * the timeout elapses (a timed-out socket is half-open, so it is dropped —
   * self-heal into an honest disconnected state). Concurrent calls share one
   * flight: a single wire message, every caller gets the same answer.
   */
  ping(timeoutMs?: number): Promise<boolean>;
  /**
   * Last ping-protocol contact (server clock, ISO; null until first contact)
   * plus the hello client identity (null when the client sent none). A
   * last-contact record: survives disconnects, overwritten by each hello.
   */
  connectionInfo(): { lastPingAt: string | null; peer: string | null };
  /**
   * Recent diagnostic lines (socket open/close, pair, hello, drops), oldest
   * first, capped at 200. Powers Settings Diagnostics via /api/debug/events.
   */
  recentEvents(): BridgeEvent[];
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

  // --- Event ring ----------------------------------------------------------
  const eventLog: BridgeEvent[] = [];
  const MAX_EVENTS = 200;

  function logEvent(msg: string): void {
    eventLog.push({ t: new Date().toISOString(), msg });
    if (eventLog.length > MAX_EVENTS) {
      eventLog.splice(0, eventLog.length - MAX_EVENTS);
    }
  }

  function sendTo(ws: WSContext, msg: ServerToExtension): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // A dead socket must not stay active; a failed send to a non-active
      // socket (e.g. pair reply) leaves the active socket untouched.
      if (active === ws) active = null;
    }
  }

  // --- Mutual-ping liveness ------------------------------------------------
  // Only correlated traffic counts: hello, the extension's bare keepalive
  // pings, and pongs answering this server's own ping id. Stale or
  // unsolicited pongs are ignored, never stamped.
  let lastPingAtMs: number | null = null;
  let peer: string | null = null;

  function notePing() {
    lastPingAtMs = Date.now();
  }

  function connectionInfo(): { lastPingAt: string | null; peer: string | null } {
    return {
      lastPingAt: lastPingAtMs === null ? null : new Date(lastPingAtMs).toISOString(),
      peer,
    };
  }

  let pingFlight: {
    id: string;
    timer: ReturnType<typeof setTimeout>;
    resolve: (ok: boolean) => void;
  } | null = null;
  let inflightPing: Promise<boolean> | null = null;

  function settlePingFlight(ok: boolean): void {
    const flight = pingFlight;
    pingFlight = null;
    inflightPing = null;
    if (flight) {
      clearTimeout(flight.timer);
      flight.resolve(ok);
    }
  }

  function ping(timeoutMs = 5000): Promise<boolean> {
    if (inflightPing) return inflightPing;
    const socket = active;
    if (socket === null) return Promise.resolve(false);
    inflightPing = new Promise<boolean>((resolve) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        if (pingFlight?.id !== id) return; // Superseded.
        dropActive('Ping timeout');
      }, timeoutMs);
      timer.unref?.();
      pingFlight = { id, timer, resolve };
      try {
        socket.send(JSON.stringify({ type: 'ping', id }));
      } catch {
        if (active === socket) active = null;
        settlePingFlight(false);
      }
    });
    return inflightPing;
  }

  function failAllPending(): void {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new BridgeError(SITE_MESSAGES[p.site], 'NOT_OPEN'));
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
        logEvent(`pair code=${msg.code} redeemed=${token !== null}`);
        if (token !== null) sendTo(ws, { type: 'paired', token });
        break;
      }
      case 'hello': {
        logEvent(`hello valid=${pairing.isValid(msg.token)} client=${msg.client?.profileEmail ?? '(bare)'}`);
        if (!pairing.isValid(msg.token)) {
          ws.close(4401, 'Invalid token');
          break;
        }
        // Replacement only: same-socket re-hello must NOT fail pending.
        if (active !== null && active !== ws) {
          logEvent('socket replaced (old closed 4400)');
          active.close(4400, 'Replaced');
          // The cmd went to a now-dead socket, so its result can never
          // legitimately arrive: fail fast instead of hanging to the timeout.
          // This clears the map, so the old socket's late async onclose
          // no-ops (active is already the new socket) and cannot re-reject.
          failAllPending();
          // The ping went to the now-dead socket: settle it instead of
          // letting its timeout drop the replacement.
          settlePingFlight(false);
        }
        active = ws;
        peer = msg.client?.profileEmail ?? null;
        notePing();
        // Buttons start empty; Task 9 sends the real set via onReady.
        sendTo(ws, { type: 'ready', buttons: [] });
        // Each subscriber is isolated: one throwing handler must not starve
        // the rest (Task 9's onTrigger starts runs — a handler bug must not
        // silently drop triggers). No logger in M1, so swallow silently.
        for (const fn of readyFns) {
          try {
            fn();
          } catch {
            // Isolated above: a bad subscriber must not break the rest.
          }
        }
        break;
      }
      case 'ping': {
        // Harmless keep-alive: answered pre-auth, but only the ACTIVE
        // socket's pings count as contact — a tokenless socket's keepalives
        // (the stranded state) must not fake a fresh "last ping".
        if (isActive) notePing();
        sendTo(ws, { type: 'pong' });
        break;
      }
      case 'pong': {
        // Only the matching pong proves liveness; stale or unsolicited
        // pongs are ignored, never stamped.
        if ('id' in msg && typeof msg.id === 'string' && pingFlight?.id === msg.id) {
          notePing();
          settlePingFlight(true);
        }
        break;
      }
      case 'trigger': {
        // Auth required: pre-auth triggers are dropped.
        if (!isActive) break;
        // Per-subscriber isolation (see hello branch): a throwing handler
        // must not starve later subscribers or break the socket.
        for (const fn of triggerFns) {
          try {
            fn(msg);
          } catch {
            // Isolated above: a bad subscriber must not break the rest.
          }
        }
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
        else p.reject(new BridgeError(msg.error, msg.code));
        break;
      }
    }
  }

  function attach(ws: WSContext): void {
    logEvent('socket open');
    ws.onmessage = (data: string) => handleMessage(ws, data);
    ws.onclose = (code?: number) => {
      logEvent(`socket close code=${code ?? '?'} wasActive=${active === ws}`);
      // Only the active socket's close tears down the session: a replaced
      // socket's late close must not clear its replacement.
      if (active === ws) {
        active = null;
        failAllPending();
        settlePingFlight(false);
      }
    };
  }

  function call(
    site: BridgeSite,
    action: string,
    input: unknown,
    timeoutMs: number = defaultTimeoutMs,
    opts?: { tab?: BridgeTab },
  ): Promise<unknown> {
    const socket = active;
    // Not connected: reject immediately (no timer) with the site message.
    if (socket === null) return Promise.reject(new BridgeError(SITE_MESSAGES[site], 'NOT_OPEN'));
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new BridgeError(SITE_MESSAGES[site], 'TIMEOUT'));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer, site });
      try {
        socket.send(
          JSON.stringify({ type: 'cmd', id, site, action, input, tab: opts?.tab ?? 'active' }),
        );
      } catch {
        pending.delete(id);
        clearTimeout(timer);
        if (active === socket) active = null;
        reject(new BridgeError(SITE_MESSAGES[site], 'NOT_OPEN'));
      }
    });
  }

  function send(msg: ServerToExtension): void {
    const socket = active;
    if (socket === null) return; // No-op when no extension is connected.
    sendTo(socket, msg);
  }

  function dropActive(reason = 'Revoked'): void {
    logEvent(`drop: ${reason}`);
    const socket = active;
    // Null + fail FIRST so the socket's late async onclose no-ops instead of
    // double-tearing-down; the close itself is best-effort.
    active = null;
    failAllPending();
    settlePingFlight(false);
    if (socket === null) return;
    try {
      socket.close(4401, reason);
    } catch {
      // Already dead; session state is already cleared above.
    }
  }

  return {
    call,
    connected: () => active !== null,
    send,
    dropActive,
    ping,
    connectionInfo,
    recentEvents: () => [...eventLog],
    onTrigger: (fn: (t: TriggerMsg) => void) => {
      triggerFns.push(fn);
    },
    onReady: (fn: () => void) => {
      readyFns.push(fn);
    },
    attach,
  };
}
