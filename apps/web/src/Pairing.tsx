import { useEffect, useState } from 'react';
import { getPairingStatus, startPairing } from './api.ts';
import AppButton from './design/AppButton.tsx';
import AppCard from './design/AppCard.tsx';

interface PairingStatus {
  paired: boolean;
  connected: boolean;
}

export default function Pairing() {
  const [status, setStatus] = useState<PairingStatus | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // On mount, learn whether the extension is already paired: returning users
  // must see their state, not another Connect button. A failed check falls
  // back to the unpaired view with the error shown; Connect retries it.
  useEffect(() => {
    let cancelled = false;
    getPairingStatus().then(
      (s) => {
        if (!cancelled) setStatus(s);
      },
      (e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus({ paired: false, connected: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function connect() {
    setError(null);
    try {
      const { code } = await startPairing();
      setCode(code);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Poll every 2s while waiting: after a code is issued until it is redeemed,
  // and while paired-but-offline until Chrome connects. Stop when settled.
  const waiting =
    status !== null && ((code !== null && !status.paired) || (status.paired && !status.connected));
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      getPairingStatus()
        .then((s) => setStatus(s))
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, 2000);
    return () => clearInterval(timer);
  }, [waiting]);

  return (
    <AppCard className="max-w-xl p-6">
      <h2 className="text-xl font-semibold">Chrome extension</h2>
      {error && <p role="alert">{error}</p>}
      {status === null ? (
        <p>Checking connection…</p>
      ) : status.paired ? (
        <>
          <p>Connected ✓</p>
          {status.connected ? (
            <p>
              Open a Gmail thread and click &apos;Save as lead &amp; reply&apos; to start a run.
              New runs appear under Chore reducers.
            </p>
          ) : (
            <p>
              Paired, but Chrome isn&apos;t connected. Open Chrome — or reload the
              extension — and this page will update on its own.
            </p>
          )}
        </>
      ) : code === null ? (
        <>
          <p>The app reaches Gmail through the Chrome extension. Pair it once:</p>
          <ol className="list-decimal pl-6">
            <li>
              Load the extension in Chrome: open chrome://extensions, enable Developer
              mode, and Load unpacked from apps/extension/.output/chrome-mv3.
            </li>
            <li>Click Connect Chrome below to get a 6-digit code.</li>
            <li>Click the extension icon in Chrome&apos;s toolbar, enter the code, and press Pair.</li>
            <li>Open any Gmail thread and click &apos;Save as lead &amp; reply&apos;.</li>
          </ol>
          <AppButton type="button" onClick={() => void connect()}>
            Connect Chrome
          </AppButton>
        </>
      ) : (
        <>
          <p>
            Enter this code in the extension popup — it expires in 10 minutes. This
            page updates on its own once paired.
          </p>
          <p className="text-3xl font-bold tracking-widest">{code}</p>
        </>
      )}
    </AppCard>
  );
}
