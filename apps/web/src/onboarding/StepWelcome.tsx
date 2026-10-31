import { sound } from '../sound/sound.ts';
import AppButton from '../design/AppButton.tsx';

/** M5 Task 5 screen 1: the exact screen 1 copy over a full-screen default mood image. */
export default function StepWelcome({ onNext }: { onNext(): void }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden">
      <img
        src="/mood/default-1.jpg"
        alt=""
        aria-hidden
        draggable={false}
        className="absolute inset-0 h-full w-full animate-in object-cover opacity-35 fade-in-0 duration-1000"
      />
      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <h1 className="font-display text-[40px] leading-tight font-semibold text-balance">
          Technology has made running a business harder, not easier. That&apos;s not your fault.
        </h1>
        <AppButton
          type="button"
          className="mt-8 px-8 py-6 text-xl"
          onClick={() => {
            sound.unlock();
            sound.ambient(true);
            onNext();
          }}
        >
          Let&apos;s fix that.
        </AppButton>
      </div>
    </div>
  );
}
