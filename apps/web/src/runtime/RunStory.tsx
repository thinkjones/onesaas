/**
 * The run story header above the canvas. The server guarantees a NON-EMPTY
 * story (≥1 line, trigger summary first — see engine/story.ts), so this
 * renders unconditionally; callers pass the story straight through.
 */
export default function RunStory({ story }: { story: string[] }) {
  return (
    <div aria-label="Run story" className="flex flex-col gap-1">
      {story.map((line, i) => (
        <p key={i} className={i === 0 ? 'text-lg font-medium' : 'text-base text-muted-foreground'}>
          {line}
        </p>
      ))}
    </div>
  );
}
