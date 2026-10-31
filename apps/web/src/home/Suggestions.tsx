// Home's four suggestion cards (M5 Task 6): fixed copy, pinned verbatim by
// HomePage.test.tsx. Clicking one fills the box; it never submits.
// Module-private: a component file may only export components
// (fast-refresh lint), and nothing else needs the list.

const SUGGESTIONS = [
  'Answer customer emails faster',
  'Keep track of bookings',
  'Turn a photo into a post',
  'Show me how my week went',
] as const;

export default function Suggestions({ onPick }: { onPick: (suggestion: string) => void }) {
  return (
    <section aria-label="Suggestions" className="grid grid-cols-2 gap-3">
      {SUGGESTIONS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className="min-h-16 rounded-[var(--radius)] border border-border bg-card p-4 text-left text-base shadow-sm hover:bg-accent"
        >
          {s}
        </button>
      ))}
    </section>
  );
}
