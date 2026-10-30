import type { ColumnType } from '@dad/shared';

/** One list cell: photos as thumbnails, datetimes in the business timezone. */
export function CellValue({
  type,
  value,
  timezone,
}: {
  type: ColumnType;
  value: unknown;
  timezone: string | null;
}) {
  const thumb = imageUrlOf(value);
  if (thumb !== null) {
    return (
      <img
        src={thumb}
        alt="Photo thumbnail"
        style={{ maxWidth: 96, maxHeight: 96 }}
        className="rounded-[var(--radius)] object-cover"
      />
    );
  }
  if (value === null || value === undefined || value === '') return <span>—</span>;
  if (type === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if ((type === 'datetime' || type === 'date') && typeof value === 'string') {
    return <span>{formatZoned(value, timezone)}</span>;
  }
  if (typeof value === 'object') return <span>{JSON.stringify(value)}</span>;
  return <span>{String(value)}</span>;
}

/** FileRef-shaped values (object or JSON string) serve from /api/files. Bare
 * file-id strings are indistinguishable from plain text, so only these shapes
 * become thumbnails. */
function imageUrlOf(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  const fileId = record['fileId'];
  if (typeof fileId !== 'string' || fileId === '') return null;
  return `/api/files/${encodeURIComponent(fileId)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** "Oct 28, 10:42 AM"-style in the business zone (browser zone when unset). */
function formatZoned(iso: string, timezone: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(d);
  } catch {
    return iso;
  }
}
