import { useEffect } from 'react';
import { formatPingAge } from '@onesaas/shared';
import type { PairingStatus } from './api.ts';
import AppButton from './design/AppButton.tsx';
import CardHeading from './design/CardHeading.tsx';
import CheckIcon from 'lucide-react/icons/check';
import PuzzleIcon from 'lucide-react/icons/puzzle';
import { usePairing } from './usePairing.ts';

export default function Pairing({ onStatus }: { onStatus?: (status: PairingStatus) => void }) {
  const { status, code, error, connect, unpair } = usePairing(onStatus);

  // Deep link target for the extension popup ("open the app" lands on the
  // card): scroll the section into view when the hash names it.
  useEffect(() => {
    if (window.location.hash === '#chrome-extension') {
      document.getElementById('chrome-extension')?.scrollIntoView();
    }
  }, []);

  return (
    <section id="chrome-extension" className="panel max-w-xl" aria-label="Chrome extension">
      <CardHeading icon={PuzzleIcon} title="Chrome extension" />
      {error && <p role="alert">{error}</p>}
      {status === null ? (
        <p>Checking connection…</p>
      ) : code !== null ? (
        <>
          <p>
            Enter this code in the extension popup — it expires in 10 minutes. This
            page updates on its own once paired.
          </p>
          {status.paired && <p>Pairing a new Chrome replaces the current pairing.</p>}
          <p className="text-3xl font-bold tracking-widest">{code}</p>
        </>
      ) : status.paired ? (
        <>
          {status.connected ? (
            <p className="flex items-center gap-1.5">
              Connected <CheckIcon size={13} strokeWidth={2} aria-hidden className="text-success" />
            </p>
          ) : (
            <p>Not connected</p>
          )}
          <p>Talking to: {status.peer ?? 'Chrome (profile unknown)'}</p>
          <p>Last ping: {formatPingAge(status.lastPingAt)}</p>
          {status.connected ? (
            <p>
              Open a Gmail thread and click &apos;Save as lead &amp; reply&apos; to start a run.
              New runs appear in Activity.
            </p>
          ) : (
            <p>
              Paired, but Chrome isn&apos;t connected. Open Chrome — or reload the
              extension — and this page will update on its own. If the extension
              asks for a code instead, pair it again with the button below.
            </p>
          )}
          <AppButton type="button" onClick={() => void unpair()}>
            Unpair
          </AppButton>
          <AppButton type="button" variant="outline" onClick={() => void connect()}>
            Pair a new Chrome
          </AppButton>
        </>
      ) : (
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
      )}
    </section>
  );
}
