import AppButton from '../design/AppButton.tsx';

const CARDS = [
  { title: 'Answer customer emails faster', src: '/onboarding/card-1.jpg' },
  { title: 'Keep track of bookings', src: '/onboarding/card-2.jpg' },
  { title: 'Turn a photo into a post', src: '/onboarding/card-3.jpg' },
];

/**
 * M5 Task 5 screen 3: the reframe copy plus three illustrated example cards.
 * While `drawing` (the mood set hasn't landed and the 20 s fallback hasn't
 * fired) a soft shimmer says the business is being drawn; the cards show
 * either way — a slow or failed generation never blocks this screen.
 */
export default function StepReframe({
  drawing,
  onNext,
}: {
  drawing: boolean;
  onNext(): void;
}) {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-12">
      <h1 className="font-display text-4xl leading-tight font-semibold text-balance">
        You&apos;ve kept a business running through all of it. That&apos;s the hard part.
      </h1>
      <p className="mt-4 text-xl text-muted-foreground">
        Think about the chores that eat your evenings. We&apos;ll turn them into{' '}
        <strong className="text-foreground">automations</strong>.
      </p>
      {drawing && (
        <p
          aria-live="polite"
          className="mt-4 text-lg text-muted-foreground motion-safe:animate-pulse"
        >
          Drawing your business…
        </p>
      )}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {CARDS.map((card) => (
          <figure
            key={card.title}
            className="overflow-hidden rounded-[var(--radius)] border border-border bg-card"
          >
            <img src={card.src} alt="" className="aspect-[4/3] w-full object-cover" />
            <figcaption className="px-4 py-3 text-lg font-medium">{card.title}</figcaption>
          </figure>
        ))}
      </div>
      <AppButton type="button" className="mt-8 w-full" onClick={onNext}>
        Next
      </AppButton>
    </div>
  );
}
