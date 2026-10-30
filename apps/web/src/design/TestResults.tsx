/**
 * The "Try it" story strip above the design canvas: the test run's story
 * lines in the RunStory typographic language (first line prominent), under
 * its own label so tests and assistive tech can find it.
 */
export default function TestResults({ story }: { story: string[] }) {
  return (
    <div aria-label="Test results" className="flex flex-col gap-1">
      {story.map((line, i) => (
        <p key={i} className={i === 0 ? 'text-lg font-medium' : 'text-base text-muted-foreground'}>
          {line}
        </p>
      ))}
    </div>
  );
}
