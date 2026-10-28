import { useEffect, useState } from 'react';

interface Status {
  paired: boolean;
  connected: boolean;
}

interface PairReply {
  ok: boolean;
  error?: string;
}

// Pairing popup. Untested by design: a jsdom + React popup harness is
// disproportionate for M1 (all protocol logic it drives lives in the tested
// background core); Task 11 exercises it against the real server.
function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    browser.runtime
      .sendMessage({ action: 'status' })
      .then((s) => {
        const st = (s ?? {}) as Partial<Status>;
        setStatus({ paired: !!st.paired, connected: !!st.connected });
      })
      .catch(() => {
        setError("Can't reach the background script. Try reloading the extension.");
      });
  }, []);

  const pair = async () => {
    setBusy(true);
    setError('');
    try {
      const res = (await browser.runtime.sendMessage({ action: 'pair', code })) as PairReply;
      if (res?.ok) {
        const s = (await browser.runtime.sendMessage({ action: 'status' })) as Status;
        setStatus({ paired: !!s?.paired, connected: !!s?.connected });
      } else {
        setError(res?.error ?? 'Pairing failed.');
      }
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
        <button
          onClick={() => void pair()}
          disabled={!valid || busy}
          style={{ marginTop: 8, width: '100%', padding: 8, fontSize: 14, cursor: 'pointer' }}
        >
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
    </div>
  );
}

export default App;
