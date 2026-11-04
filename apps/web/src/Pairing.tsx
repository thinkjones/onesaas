import { useEffect, useRef, useState } from 'react';
import { formatPingAge } from '@onesaas/shared';
import {
  getPairingStatus,
  pingPairing,
  revokePairing,
  startPairing,
  type PairingStatus,
} from './api.ts';
import AppButton from './design/AppButton.tsx';
import CardHeading from './design/CardHeading.tsx';
import CheckIcon from 'lucide-react/icons/check';
import PuzzleIcon from 'lucide-react/icons/puzzle';

// The extension's keepalives stamp the server every 20s: a connected claim
// with an older stamp is suspicious and gets re-verified with a live probe.
const STALE_PING_MS = 30_000;

function lastPingIsStale(lastPingAt: string | null | undefined): boolean {
  if (lastPingAt === null || lastPingAt === undefined) return true;
  const then = Date.parse(lastPingAt);
  if (Number.isNaN(then)) return true;
  return Date.now() - then > STALE_PING_MS;
}

export default function Pairing({ onStatus }: { onStatus?: (status: PairingStatus) => void }) {
  const [status, setStatus] = useState<PairingStatus | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tracks the last seen paired flag so the poll can spot a revoke (a poll
  // that reports unpaired while the user is still mid-pairing must NOT clear
  // their code — only a paired -> unpaired transition does).
  const wasPaired = useRef(false);
  // What the pending code was issued against: unpaired-start completes on the
  // paired flip, paired-start ("Pair a new Chrome") completes when the
  // generation moves (paired stays true — only the generation changes).
  const issued = useRef<{ generation: number | null; whilePaired: boolean } | null>(null);
  // Probes serialize: a sick extension must not stack 5s waits.
  const pinging = useRef(false);

  // Deep link target for the extension popup ("open the app" lands on the
  // card): scroll the section into view when the hash names it.
  useEffect(() => {
    if (window.location.hash === '#chrome-extension') {
      document.getElementById('chrome-extension')?.scrollIntoView();
    }
  }, []);

  // Round-trips a live probe and merges the (possibly self-healed) state over
  // the last status. Never rejects — failures surface inline.
  async function verifyConnection(): Promise<void> {
    if (pinging.current) return;
    pinging.current = true;
    try {
      const p = await pingPairing();
      setStatus((s) =>
        s === null ? s : { ...s, connected: p.connected, lastPingAt: p.lastPingAt, peer: p.peer },
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      pinging.current = false;
    }
  }

  // On mount, learn whether the extension is already paired: returning users
  // must see their state, not another Connect button. A paired mount also
  // probes the extension — socket state alone is not proof Chrome answers.
  // A failed check falls back to the unpaired view with the error shown;
  // Connect retries it.
  useEffect(() => {
    let cancelled = false;
    getPairingStatus().then(
      (s) => {
        if (cancelled) return;
        wasPaired.current = s.paired;
        setStatus(s);
        if (s.paired) void verifyConnection();
      },
      (e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus({ paired: false, connected: false, lastPingAt: null, peer: null, generation: 0 });
      },
    );
    return () => {
      cancelled = true;
    };
    // verifyConnection is ref-stable (refs + setState only); mount runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lets embedders (onboarding) mirror the paired flag off this same status
  // instead of polling the endpoint a second time. Rendering is untouched.
  useEffect(() => {
    if (status !== null) onStatus?.(status);
  }, [status, onStatus]);

  async function connect() {
    setError(null);
    issued.current = { generation: status?.generation ?? null, whilePaired: status?.paired ?? false };
    try {
      const { code } = await startPairing();
      setCode(code);
    } catch (e: unknown) {
      issued.current = null;
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
      issued.current = null;
      const s = await getPairingStatus();
      wasPaired.current = s.paired;
      setStatus(s);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Poll every 2s until the unpaired start state: after a code is issued until
  // it is redeemed, while paired-but-offline until Chrome connects, and while
  // connected (a server-side revoke must reflect here). A connected claim
  // with a stale last-ping stamp is re-verified with a live probe — cheap
  // when healthy (fresh polls skip it), honest when the socket is half-open.
  // Only the quiet unpaired start state skips polling; cleanup stops it on
  // unmount.
  const waiting = status !== null && (code !== null || status.paired);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      getPairingStatus()
        .then((s) => {
          // Revoke lands here: the server killed the token AND the pending
          // code, so drop the dead code and fall back to the start view.
          if (wasPaired.current && !s.paired) {
            setCode(null);
            issued.current = null;
          } else if (
            code !== null &&
            s.paired &&
            (issued.current === null ||
              !issued.current.whilePaired ||
              (issued.current.generation !== null && s.generation !== issued.current.generation))
          ) {
            // Code redeemed: unpaired-start completes on the paired flip,
            // paired-start completes when the generation moves. (issued null
            // covers a code the poll found without a recorded issue.)
            setCode(null);
            issued.current = null;
          }
          wasPaired.current = s.paired;
          setStatus(s);
          if (s.paired && s.connected && lastPingIsStale(s.lastPingAt)) void verifyConnection();
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, 2000);
    return () => clearInterval(timer);
    // verifyConnection is ref-stable (refs + setState only); code re-arms
    // the completion check for the pending code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, code]);

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
