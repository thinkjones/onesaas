import { useEffect, useState } from 'react';

interface Status {
  paired: boolean;
  connected: boolean;
}

interface PairReply {
  ok: boolean;
  error?: string;
}

// Same origin the background socket uses; covered by host_permissions.
const REVOKE_URL = 'http://127.0.0.1:8787/api/pairing/revoke';
const APP_URL = 'http://localhost:5173';

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
  const [email, setEmail] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    const s = (await browser.runtime.sendMessage({ action: 'status' })) as Partial<Status>;
    setStatus({ paired: !!s?.paired, connected: !!s?.connected });
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

  const pair = async () => {
    setBusy(true);
    setError('');
    try {
      const res = (await browser.runtime.sendMessage({ action: 'pair', code })) as PairReply;
      if (res?.ok) {
        await refresh();
      } else {
        setError(res?.error ?? 'Pairing failed.');
      }
    } catch {
      setError('No answer from the app. Is it running?');
    } finally {
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

  const manageLink = (
    <p>
      <a href={APP_URL} target="_blank" rel="noreferrer">
        Open the app to manage →
      </a>
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
      </div>
    );
  }

  return (
    <div style={box}>
      <h1 style={{ fontSize: 16, margin: '0 0 8px' }}>My Dad&apos;s AI Agent</h1>
      <p style={{ margin: '0 0 4px' }}>Paired ✓</p>
      <p style={{ margin: '0 0 4px' }}>
        {status.connected ? 'Connected ✓' : 'Not connected — is the app running?'}
      </p>
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
    </div>
  );
}

export default App;
