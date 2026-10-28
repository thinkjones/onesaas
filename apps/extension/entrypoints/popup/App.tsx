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

// Pairing popup. Untested by design: a jsdom + React popup harness is
// disproportionate for M1 (all protocol logic it drives lives in the tested
// background core); Task 11 exercises it against the real server.
function App() {
  const [status, setStatus] = useState<Status | null>(null);
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
    width: 240,
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

  if (status === null) {
    return <div style={box}>{error ? <p style={{ color: '#b00020' }}>{error}</p> : <p>Loading…</p>}</div>;
  }

  if (!status.paired) {
    const valid = /^\d{6}$/.test(code);
    return (
      <div style={box}>
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
          {busy ? 'Pairing…' : 'Pair'}
        </button>
        {error !== '' && <p style={{ color: '#b00020' }}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={box}>
      <p style={{ marginTop: 0 }}>{status.connected ? 'Connected ✓' : 'Not connected'}</p>
      <a href="http://localhost:5173" target="_blank" rel="noreferrer">
        Open the app
      </a>
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
