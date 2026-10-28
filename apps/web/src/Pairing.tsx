import { useEffect, useState } from 'react';
import { getPairingStatus, startPairing } from './api.ts';

export default function Pairing() {
  const [code, setCode] = useState<string | null>(null);
  const [paired, setPaired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setError(null);
    try {
      const { code } = await startPairing();
      setCode(code);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Poll every 2s once a code exists; stop when paired, clean up on unmount.
  // Success reads `paired` (not `connected`): paired = the code was redeemed.
  useEffect(() => {
    if (code === null || paired) return;
    const timer = setInterval(() => {
      getPairingStatus()
        .then((s) => {
          if (s.paired) setPaired(true);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, 2000);
    return () => clearInterval(timer);
  }, [code, paired]);

  return (
    <section>
      <h2>Chrome extension</h2>
      {error && <p>{error}</p>}
      {paired ? (
        <p>Connected ✓</p>
      ) : code === null ? (
        <button type="button" onClick={() => void connect()}>
          Connect Chrome
        </button>
      ) : (
        <h2>{code}</h2>
      )}
    </section>
  );
}
