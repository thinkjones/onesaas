import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { CellValue } from './cells.tsx';
import type { ListTable } from './types.ts';

/** A sortable spreadsheet over a list's rows. Headers show column LABELS. */
export default function GridView({
  table,
  rows,
  timezone,
  columns,
}: {
  table: ListTable;
  rows: Record<string, unknown>[];
  timezone: string | null;
  /** Saved column pick; all columns when omitted (the automatic grid). */
  columns?: string[];
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
      cell: (info) => <CellValue type={col.type} value={info.getValue()} timezone={timezone} />,
    }));
  }, [table.columns, columns, timezone]);
  const data = useMemo(() => rows, [rows]);
  const grid = useReactTable({ data, columns: defs, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });

  if (rows.length === 0) return <p>Nothing here yet.</p>;
  return (
    <table className="w-full text-base">
      <thead>
        {grid.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => (
              <th key={header.id} className="border-b p-2 text-left font-semibold">
                <button
                  type="button"
                  onClick={header.column.getToggleSortingHandler()}
                  aria-label={`Sort by ${String(header.column.columnDef.header)}`}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {header.column.getIsSorted() === 'asc'
                    ? ' ▲'
                    : header.column.getIsSorted() === 'desc'
                      ? ' ▼'
                      : ''}
                </button>
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {grid.getRowModel().rows.map((row) => (
          <tr key={row.id} className="border-b">
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id} className="p-2">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
