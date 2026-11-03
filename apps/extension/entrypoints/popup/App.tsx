import { useEffect, useRef, useState } from 'react';
import { formatPingAge } from '@dad/shared';
import type { BgDebugEvent } from '../../lib/background.js';

interface Status {
  paired: boolean;
  connected: boolean;
  lastPingAt: string | null;
}

interface PairReply {
  ok: boolean;
  error?: string;
}

// One popup-side journal line (debug mode for the Pair button).
interface PopupLogEntry {
  t: string;
  msg: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Same origin the background socket uses; covered by host_permissions.
const REVOKE_URL = 'http://127.0.0.1:8787/api/pairing/revoke';
// SAME string as the background's WS_URL (lib/background.ts) and the app's
// Services card: the bridge socket is what the extension is really talking to.
const BRIDGE_URL = 'ws://127.0.0.1:8787/ext';
// Desktop focus first (works in dev and production: the Tauri webview holds
// a tagged SSE stream); the settings page in a browser tab is the fallback.
const FOCUS_URL = 'http://127.0.0.1:8787/api/app/focus';
const APP_SETTINGS_URL = 'http://localhost:5173/settings#chrome-extension';

// The signed-in address of the Chrome profile this popup runs in — which is
// the profile the pairing belongs to. Null when Chrome isn't signed in (or
// the lookup fails); needs the `identity` manifest permission.
async function profileEmail(): Promise<string | null> {
  try {
    const identity = (
      browser as unknown as {
        identity?: { getProfileUserInfo?: () => Promise<{ email?: string }> };
      }
    ).identity;
    const info = await identity?.getProfileUserInfo?.();
    return info?.email && info.email !== '' ? info.email : null;
  } catch {
    return null;
  }
}

// Pairing popup (Bug #5): status, Chrome profile, what/why info, a link to
// manage the app, and unpair/re-pair. Covered by test/popup.test.ts.
function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [live, setLive] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Probes serialize: a sick app must not stack a new 2s wait on every tick.
  const probing = useRef(false);
  // Pairs serialize on a ref, not `busy`: state lags a tick, so two same-tick
  // clicks would both pass and double-submit the single-use code.
  const pairing = useRef(false);
  // Debug mode: the popup's own journal plus the background worker's log.
  const [popLog, setPopLog] = useState<PopupLogEntry[]>([]);
  const [bgLog, setBgLog] = useState<BgDebugEvent[]>([]);

  const logPop = (msg: string) => {
    setPopLog((l) => [...l.slice(-29), { t: new Date().toISOString(), msg }]);
  };

  // Active liveness check: socket-open is not proof the app answers, so ask
  // the background to round-trip a real ping. Never rejects.
  const probe = async () => {
    if (probing.current) return;
    probing.current = true;
    try {
      const r = (await browser.runtime.sendMessage({ action: 'ping' })) as
        | { ok?: boolean }
        | undefined;
      setLive(!!r?.ok);
    } catch {
      setLive(false);
    } finally {
      probing.current = false;
    }
  };

  const refresh = async () => {
    const s = (await browser.runtime.sendMessage({ action: 'status' })) as Partial<Status>;
    const paired = !!s?.paired;
    setStatus({
      paired,
      connected: !!s?.connected,
      lastPingAt: typeof s?.lastPingAt === 'string' ? s.lastPingAt : null,
    });
    try {
      const log = (await browser.runtime.sendMessage({ action: 'getDebugLog' })) as
        | { events?: BgDebugEvent[] }
        | undefined;
      if (Array.isArray(log?.events)) setBgLog(log.events.slice(-30));
    } catch {
      // The log is a bonus view; a dead worker already surfaces via status.
    }
    if (paired) await probe();
  };

  useEffect(() => {
    // Status is live, not a snapshot: refresh on open and every 2s so a
    // rejected hello or a server-side revoke shows up without reopening.
    refresh().catch(() => {
      setError("Can't reach the background script. Try reloading the extension.");
    });
    const timer = setInterval(() => {
      refresh().catch(() => {
        // Later failures are transient (worker hibernation); the next tick
        // retries, so don't clobber the view with an error.
      });
    }, 2000);
    // The profile can't change while the popup is open; fetch once.
    void profileEmail().then((e) => setEmail(e));
    return () => clearInterval(timer);
  }, []);

  // The first send after worker hibernation can die while Chrome wakes the
  // worker — the classic "first Pair click fails fast, second works". One
  // retry after a beat fixes the cold start without masking real failures.
  const sendPair = async (c: string): Promise<PairReply> => {
    try {
      return (await browser.runtime.sendMessage({ action: 'pair', code: c })) as PairReply;
    } catch {
      logPop('pair send failed (worker waking?) — retrying…');
      await sleep(500);
      return (await browser.runtime.sendMessage({ action: 'pair', code: c })) as PairReply;
    }
  };

  const pair = async () => {
    if (pairing.current) return;
    pairing.current = true;
    setBusy(true);
    setError('');
    const started = Date.now();
    logPop('pair attempt');
    try {
      const res = await sendPair(code);
      if (res?.ok) {
        logPop(`pair ok (${Date.now() - started}ms)`);
        await refresh();
      } else {
        logPop(`pair failed: ${res?.error ?? 'unknown'} (${Date.now() - started}ms)`);
        setError(res?.error ?? 'Pairing failed.');
      }
    } catch {
      logPop(`pair failed: background unreachable (${Date.now() - started}ms)`);
      setError('No answer from the app. Is it running?');
    } finally {
      pairing.current = false;
      setBusy(false);
    }
  };

  // Forget the local token so the code box comes back. The server token is
  // untouched: completing a new pair overwrites it; abandoning leaves the
  // previous pairing (possibly another Chrome) working.
  const pairAgain = async () => {
    setBusy(true);
    setError('');
    try {
      await browser.runtime.sendMessage({ action: 'unpair' });
      setCode('');
      await refresh();
    } catch {
      setError('No answer from the app. Is it running?');
    } finally {
      setBusy(false);
    }
  };

  // Full reset: revoke the server token, then forget the local one. Best
  // effort on the server half — a down server must not trap the popup.
  const unpair = async () => {
    setBusy(true);
    setError('');
    try {
      try {
        await fetch(REVOKE_URL, { method: 'POST' });
      } catch {
        // Server unreachable: local unpair still lets the user re-pair later.
      }
      await browser.runtime.sendMessage({ action: 'unpair' });
      setCode('');
      await refresh();
    } catch {
      setError('No answer from the app. Is it running?');
    } finally {
      setBusy(false);
    }
  };

  const box: React.CSSProperties = {
    width: 280,
    padding: 16,
    fontFamily: 'system-ui, sans-serif',
    fontSize: 14,
  };

  const buttonStyle: React.CSSProperties = {
    marginTop: 8,
    width: '100%',
    padding: 8,
    fontSize: 14,
    cursor: 'pointer',
  };

  const info = (
    <p style={{ color: '#555' }}>
      This extension connects the app to Gmail in this Chrome profile. It reads the email you
      have open, watches for new mail, and adds the “Save as lead &amp; reply” button. It only
      works while Gmail is open here.
    </p>
  );

  // Opens the DESKTOP app (dev and production): the server focuses a
  // listening Tauri window and navigates it to this card. With no desktop
  // listening — or no server at all — a browser tab is the fallback.
  const openApp = async () => {
    try {
      const res = await fetch(FOCUS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/settings', hash: 'chrome-extension' }),
      });
      const data = (await res.json().catch(() => null)) as { focused?: boolean } | null;
      if (res.ok && data?.focused) {
        window.close();
        return;
      }
    } catch {
      // Unreachable server: fall through to the browser tab.
    }
    window.open(APP_SETTINGS_URL, '_blank');
  };

  const manageLink = (
    <p>
      <button
        type="button"
        onClick={() => void openApp()}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          color: '#1a73e8',
          textDecoration: 'underline',
          cursor: 'pointer',
          fontSize: 14,
        }}
      >
        Open the app to manage →
      </button>
    </p>
  );

  // Border spinner for the in-flight Pair click (the popup has no stylesheet,
  // so the keyframes ride along in a style tag).
  const spinner = (
    <>
      <style>{'@keyframes dad-spin { to { transform: rotate(360deg); } }'}</style>
      <span
        role="status"
        aria-label="Pairing"
        style={{
          display: 'inline-block',
          width: 12,
          height: 12,
          marginRight: 6,
          verticalAlign: '-1px',
          border: '2px solid #ccc',
          borderTopColor: '#333',
          borderRadius: '50%',
          animation: 'dad-spin 0.8s linear infinite',
        }}
      />
    </>
  );

  if (status === null) {
    return <div style={box}>{error ? <p style={{ color: '#b00020' }}>{error}</p> : <p>Loading…</p>}</div>;
  }

  // Who we're talking to + when they last answered, in BOTH views: someone
  // stuck unpaired (the exact failure mode) needs this more than anyone.
  const connectionInfo = (
    <>
      <p style={{ margin: '0 0 4px' }}>Talking to: the extension bridge ({BRIDGE_URL})</p>
      <p style={{ margin: '0 0 4px' }}>Last ping: {formatPingAge(status.lastPingAt)}</p>
    </>
  );

  // Debug mode, in BOTH views: everything the Pair button did plus the
  // background worker's own journal, newest last, popup lines first.
  const debugLog = (
    <details style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer' }}>Connection log</summary>
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, maxHeight: 160, overflowY: 'auto' }}>
        {[
          ...popLog.map((e) => `[popup ${e.t.slice(11, 19)}] ${e.msg}`),
          ...bgLog.map((e) => `[bg ${e.t.slice(11, 19)}] ${e.msg}`),
        ].join('\n') || 'No events yet.'}
      </pre>
    </details>
  );

  if (!status.paired) {
    const valid = /^\d{6}$/.test(code);
    return (
      <div style={box}>
        <h1 style={{ fontSize: 16, margin: '0 0 8px' }}>My Dad&apos;s AI Agent</h1>
        {info}
        {manageLink}
        <p style={{ marginTop: 0 }}>Enter the 6-digit code from the app:</p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          maxLength={6}
          placeholder="123456"
          style={{ width: '100%', fontSize: 18, padding: 6, boxSizing: 'border-box' }}
        />
        <button onClick={() => void pair()} disabled={!valid || busy} style={buttonStyle}>
          {busy ? (
            <>
              {spinner}Pairing…
            </>
          ) : (
            'Pair'
          )}
        </button>
        {error !== '' && <p style={{ color: '#b00020' }}>{error}</p>}
        {connectionInfo}
        {debugLog}
      </div>
    );
  }

  return (
    <div style={box}>
      <h1 style={{ fontSize: 16, margin: '0 0 8px' }}>My Dad&apos;s AI Agent</h1>
      <p style={{ margin: '0 0 4px' }}>Paired ✓</p>
      <p style={{ margin: '0 0 4px' }}>
        {status.connected && live !== false ? 'Connected ✓' : 'Not connected — is the app running?'}
      </p>
      {connectionInfo}
      <p style={{ margin: '0 0 8px' }}>Chrome profile: {email ?? 'not signed in'}</p>
      {info}
      {manageLink}
      <button onClick={() => void pairAgain()} disabled={busy} style={buttonStyle}>
        Pair again
      </button>
      <button onClick={() => void unpair()} disabled={busy} style={buttonStyle}>
        Unpair
      </button>
      {error !== '' && <p style={{ color: '#b00020' }}>{error}</p>}
      {debugLog}
    </div>
  );
}

export default App;
