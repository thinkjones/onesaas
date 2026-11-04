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
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const today = startOfDay(new Date());
    const day = startOfDay(d);
    const daysAgo = Math.round((today.getTime() - day.getTime()) / 86_400_000);
    const dayLabel = daysAgo <= 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : dateFmt.format(d);
    return `${dayLabel} ${timeFmt.format(d)}`;
  } catch {
    // One corrupt stamp must not kill the whole list (this runs inside
    // RunsList's map) — fall back to the raw string.
    return iso;
  }
}

/**
 * Full stamp for the inspector meta block and relative-date title attributes:
 * "Oct 28, 10:42 AM"-style. Falls back to the raw string on garbage input
 * (like formatRunListTime — one corrupt stamp must not kill the list).
 */
export function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return dateTimeFmt.format(d);
  } catch {
    return iso;
  }
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

/** "Started today at 07:44 PM from Gmail", from the run's start and trigger. */
export function formatRunStart(iso: string, triggerType: string | undefined): string {
  const when = formatRunListTime(iso).replace(/^Today /, 'today at ').replace(/^Yesterday /, 'yesterday at ');
  const from: Record<string, string> = {
    'trigger.gmailButton': ' from Gmail',
    'trigger.email': ' from a new email',
    'trigger.upload': ' from a photo',
  };
  return `Started ${when}${(triggerType && from[triggerType]) ?? ''}`;
}

const MACHINE_TEXT = /(^|:\s*)[[{].*$/s;
const PLAIN_FAILURE = "Something in this step didn't look right to me.";

/** A failure in plain words: a raw machine error never reaches the owner. */
export function plainError(error: string): string {
  return /^\s*[[{]/.test(error) ? PLAIN_FAILURE : error;
}

/** A story line in plain words: no joining arrows and no raw machine errors. */
export function plainLine(line: string): string {
  return line
    .replace(MACHINE_TEXT, (_, lead: string) => `${lead}${PLAIN_FAILURE}`)
    .replace(/\s*→\s*/g, ' ')
    .trim();
}
