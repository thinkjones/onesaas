import { CellValue } from './cells.tsx';
import type { ListTable } from './types.ts';

/** One card per row: the display field as the title plus 3 more fields. */
export default function CardsView({
  table,
  rows,
  timezone,
}: {
  table: ListTable;
  rows: Record<string, unknown>[];
  timezone: string | null;
}) {
  if (rows.length === 0) return <p>Nothing here yet.</p>;
  const rest = table.columns.filter((c) => c.name !== table.displayField).slice(0, 3);
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <li
          key={typeof row['id'] === 'number' || typeof row['id'] === 'string' ? row['id'] : i}
          className="flex flex-col gap-1 rounded-[var(--radius)] border p-3"
        >
          <span className="text-lg font-semibold">
            {String(row[table.displayField] ?? '—')}
          </span>
          {rest.map((col) => (
            <span key={col.name} className="text-base">
              {col.label}: <CellValue type={col.type} value={row[col.name]} timezone={timezone} />
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}
