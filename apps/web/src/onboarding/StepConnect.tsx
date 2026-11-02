import CheckIcon from 'lucide-react/icons/check';
import { useCallback, useState } from 'react';
import Pairing from '../Pairing.tsx';
import AppButton from '../design/AppButton.tsx';

/** GitHub-rendered root README section with the unpacked-loading steps. */
const EXTENSION_INSTALL_URL =
  'https://github.com/thinkjones/meta-ai-hackathon-my-dads-ai-agent#loading-the-extension-unpacked';

/**
 * M5 Task 5 screen 4: the install link and the reused M1 pairing card (code
 * card, unpacked-extension instructions), with a big check once the same paired
 * state Pairing reports flips true. Skipping is always available; both paths
 * finish onboarding.
 */
export default function StepConnect({ onFinish }: { onFinish(): void }) {
  const [paired, setPaired] = useState(false);
  const handleStatus = useCallback((s: { paired: boolean }) => setPaired(s.paired), []);
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12">
      <h1 className="font-display text-4xl font-semibold">Connect Chrome</h1>
      <p className="mt-4 text-xl text-muted-foreground">
        The app reaches Gmail through the Chrome extension. Pair it once and
        you&apos;re set.
      </p>
      <p className="mt-4 text-xl">
        <a
          href={EXTENSION_INSTALL_URL}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline-offset-4 hover:underline"
        >
          Install the extension
        </a>
      </p>
      {paired && (
        <p role="img" aria-label="Chrome extension paired" className="mt-6 text-center">
          <CheckIcon size={72} strokeWidth={2} aria-hidden className="inline text-success" />
        </p>
      )}
      <div className="mt-6">
        <Pairing onStatus={handleStatus} />
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <AppButton type="button" variant="outline" className="flex-1" onClick={onFinish}>
          Skip for now
        </AppButton>
        <AppButton type="button" className="flex-1" onClick={onFinish}>
          Finish
        </AppButton>
      </div>
    </div>
  );
}
