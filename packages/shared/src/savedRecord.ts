/**
 * Where to see the row a save step made, or null if it didn't make one. A "Try it"
 * run reports id 0, because it never writes anything.
 */
export function savedRecordPath(
  step: { type: string; config: Record<string, unknown> },
  output: unknown,
): string | null {
  if (step.type !== 'table.insert' && step.type !== 'table.upsert') return null;
  const table = step.config['table'];
  const id = (output as { id?: unknown } | null | undefined)?.id;
  if (typeof table !== 'string' || typeof id !== 'number' || id <= 0) return null;
  return `/lists?table=${encodeURIComponent(table)}&row=${id}`;
}
