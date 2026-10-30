import { cn } from 'cn';

/**
 * The amber badge under a troubled box: one pill per problem, in the
 * StatusBadge pill language (warning tint, no status semantics of its own).
 * Renders nothing when the step has no problems.
 */
export default function ProblemsBadge({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {problems.map((problem, i) => (
        <span
          key={i}
          className={cn(
            'inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-medium',
            'border-warning/40 bg-warning/15 text-foreground',
          )}
        >
          {problem}
        </span>
      ))}
    </div>
  );
}
