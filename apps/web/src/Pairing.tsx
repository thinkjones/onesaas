import { useEffect, useRef, useState } from 'react';
import { getPairingStatus, revokePairing, startPairing } from './api.ts';
import AppButton from './design/AppButton.tsx';
import AppCard from './design/AppCard.tsx';

interface PairingStatus {
  paired: boolean;
  connected: boolean;
}

export default function Pairing({ onStatus }: { onStatus?: (status: PairingStatus) => void }) {
  const [status, setStatus] = useState<PairingStatus | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tracks the last seen paired flag so the poll can spot a revoke (a poll
  // that reports unpaired while the user is still mid-pairing must NOT clear
  // their code — only a paired -> unpaired transition does).
  const wasPaired = useRef(false);

  // On mount, learn whether the extension is already paired: returning users
  // must see their state, not another Connect button. A failed check falls
  // back to the unpaired view with the error shown; Connect retries it.
  useEffect(() => {
    let cancelled = false;
    getPairingStatus().then(
      (s) => {
        if (cancelled) return;
        wasPaired.current = s.paired;
        setStatus(s);
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

  // Lets embedders (onboarding) mirror the paired flag off this same status
  // instead of polling the endpoint a second time. Rendering is untouched.
  useEffect(() => {
    if (status !== null) onStatus?.(status);
  }, [status, onStatus]);

  async function connect() {
    setError(null);
    try {
      const { code } = await startPairing();
      setCode(code);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Escape hatch for the stranded state (server paired, this Chrome holds no
  // token): revoke the server token and fall back to the start view so the
  // user can pair this Chrome fresh.
  async function unpair() {
    setError(null);
    try {
      await revokePairing();
      setCode(null);
      const s = await getPairingStatus();
      wasPaired.current = s.paired;
      setStatus(s);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Poll every 2s until the unpaired start state: after a code is issued until
  // it is redeemed, while paired-but-offline until Chrome connects, and while
  // connected (a server-side revoke must reflect here). Only the quiet
  // unpaired start state skips polling; cleanup stops it on unmount.
  const waiting = status !== null && (code !== null || status.paired);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      getPairingStatus()
        .then((s) => {
          // Revoke lands here: the server killed the token AND the pending
          // code, so drop the dead code and fall back to the start view.
          if (wasPaired.current && !s.paired) setCode(null);
          wasPaired.current = s.paired;
          setStatus(s);
        })
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
          <AppButton type="button" onClick={() => void unpair()}>
            Unpair
          </AppButton>
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
