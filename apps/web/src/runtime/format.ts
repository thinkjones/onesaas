// Browser-timezone formatting for the runtime screen. All formatters use the
// browser's locale and timezone (no explicit timeZone), per the plan.

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Runs-list row stamp: "Today 10:42", "Yesterday 10:42", else "Oct 26 10:42".
 * Day boundaries are computed in the browser timezone.
 */
export function formatRunListTime(iso: string): string {
  const d = new Date(iso);
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  const daysAgo = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  const dayLabel = daysAgo <= 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : dateFmt.format(d);
  return `${dayLabel} ${timeFmt.format(d)}`;
}

/** Full stamp for the inspector meta block: "Oct 28, 10:42 AM"-style. */
export function formatDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}

/** Plan-exact money: costUsd 0.0012 renders "$0.0012". */
export function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(4)}`;
}

/**
 * Who/what a run is about, from the trigger payload. The gmailButton trigger
 * stores `{ email: { fromName, subject, … } }` and manual stores `{ payload }`
 * (see server triggers/gmailButton.ts + steps/trigger.ts). Chain: fromName →
 * subject → "Manual run". Top-level fromName/subject are read defensively for
 * payloads that skip the email wrapper.
 */
export function runDisplayName(triggerPayload: unknown): string {
  const root = (triggerPayload ?? {}) as Record<string, unknown>;
  const email = (root['email'] ?? {}) as Record<string, unknown>;
  const fromName = email['fromName'] ?? root['fromName'];
  if (typeof fromName === 'string' && fromName.trim() !== '') return fromName;
  const subject = email['subject'] ?? root['subject'];
  if (typeof subject === 'string' && subject.trim() !== '') return subject;
  return 'Manual run';
}

/** Plan-exact duration: durationMs 1200 renders "1.2 s". */
export function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)} s`;
}
