import Pairing from '../Pairing.tsx';
import AppButton from '../design/AppButton.tsx';

/**
 * M5 Task 5 screen 4: Chrome pairing via the reused M1 pairing card (it
 * carries the unpacked-extension instructions, the code card, and the ✓ when
 * paired). Skipping is always available; both paths finish onboarding.
 */
export default function StepConnect({ onFinish }: { onFinish(): void }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12">
      <h1 className="font-display text-4xl font-semibold">Connect Chrome</h1>
      <p className="mt-4 text-xl text-muted-foreground">
        The app reaches Gmail through the Chrome extension. Pair it once and
        you&apos;re set.
      </p>
      <div className="mt-6">
        <Pairing />
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
