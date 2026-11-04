import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import ChevronDownIcon from 'lucide-react/icons/chevron-down';
import ChevronUpIcon from 'lucide-react/icons/chevron-up';
import { useMemo, useState } from 'react';
import Explain from '../explain/Explain.tsx';
import { dataExplainValue } from '../explain/useAltClickExplain.ts';
import { CellValue } from './cells.tsx';
import type { ListTable } from './types.ts';

/** A sortable spreadsheet over a list's rows. Headers show column LABELS. */
export default function GridView({
  table,
  rows,
  timezone,
  columns,
  selectedRow,
  onSelectRow,
}: {
  table: ListTable;
  rows: Record<string, unknown>[];
  timezone: string | null;
  /** Saved column pick; all columns when omitted (the automatic grid). */
  columns?: string[];
  selectedRow?: Record<string, unknown>;
  /** Clicking a row opens its details. */
  onSelectRow?(row: Record<string, unknown>): void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const defs = useMemo((): ColumnDef<Record<string, unknown>, unknown>[] => {
    const picked = columns
      ? table.columns.filter((c) => columns.includes(c.name))
      : table.columns;
    return picked.map((col) => ({
      id: col.name,
      header: col.label,
      accessorFn: (row: Record<string, unknown>) => row[col.name],
      cell: (info) => <CellValue type={col.type} value={info.getValue()} timezone={timezone} column={col.name} />,
    }));
  }, [table.columns, columns, timezone]);
  const data = useMemo(() => rows, [rows]);
  const grid = useReactTable({ data, columns: defs, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });

  if (rows.length === 0) return <p>Nothing here yet.</p>;
  return (
    <table className="w-full text-[0.882rem]">
      <thead>
        {grid.getHeaderGroups().map((group) => (
          <tr key={group.id} className="bg-background">
            {group.headers.map((header) => {
              const col = table.columns.find((c) => c.name === header.column.id);
              const target = { kind: 'column' as const, id: header.column.id, context: table.name };
              const label = col?.label ?? String(header.column.columnDef.header);
              return (
                <th
                  key={header.id}
                  data-explain={dataExplainValue(target, label)}
                  className="border-y border-border px-5 py-2 text-left text-[0.765rem] font-bold text-muted-foreground"
                >
                  <span className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      aria-label={`Sort by ${String(header.column.columnDef.header)}`}
                      className="inline-flex items-center gap-1 rounded-[var(--radius-s)] border-transparent bg-transparent p-1 font-semibold shadow-none hover:bg-accent"
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' && (
                        <ChevronUpIcon size={13} strokeWidth={2} aria-hidden />
                      )}
                      {header.column.getIsSorted() === 'desc' && (
                        <ChevronDownIcon size={13} strokeWidth={2} aria-hidden />
                      )}
                    </button>
                    <Explain target={target} label={label} />
                  </span>
                </th>
              );
            })}
          </tr>
        ))}
      </thead>
      <tbody>
        {grid.getRowModel().rows.map((row) => (
          <tr
            key={row.id}
            aria-selected={selectedRow !== undefined && row.original === selectedRow}
            className={`border-b border-border aria-selected:bg-accent-soft aria-selected:shadow-[inset_3px_0_0_var(--accent)] ${onSelectRow ? 'cursor-pointer hover:bg-accent' : ''}`}
            onClick={onSelectRow ? () => onSelectRow(row.original) : undefined}
          >
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id} className="px-5 py-3 break-words">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
