import PinIcon from 'lucide-react/icons/pin';
import TableIcon from 'lucide-react/icons/table';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  useBusinessTimezone,
  useCreateView,
  useDeleteView,
  useListRows,
  useLists,
  useViewData,
  useViews,
} from '../api.ts';
import AppButton from '../design/AppButton.tsx';
import CardHeading from '../design/CardHeading.tsx';
import CardsView from './CardsView.tsx';
import GridView from './GridView.tsx';
import StatView from './StatView.tsx';
import type { ListSummary, ViewDef } from './types.ts';

/** One pinned number with its live value and an unpin button. */
function PinnedStat({ view }: { view: ViewDef }) {
  const data = useViewData(view.id);
  const remove = useDeleteView();
  return (
    <div className="flex flex-col gap-2">
      {data.data ? (
        <StatView title={view.title} value={data.data.value ?? 0} />
      ) : data.isError ? (
        <p role="alert">Couldn't load this number. Try again.</p>
      ) : (
        <p>Loading…</p>
      )}
      <AppButton
        variant="outline"
        onClick={() => remove.mutate(view.id)}
        disabled={remove.isPending}
      >
        Unpin
      </AppButton>
    </div>
  );
}

/** "Pin a number": count rows, or sum a number column, optionally recent only. */
function PinNumberForm({ table, onDone }: { table: ListSummary; onDone: () => void }) {
  const create = useCreateView();
  const numberColumns = table.columns.filter((c) => c.type === 'number');
  const [op, setOp] = useState<'count' | 'sum'>('count');
  const [column, setColumn] = useState(numberColumns[0]?.name ?? '');
  const [sinceDays, setSinceDays] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handlePin = (): void => {
    const days = sinceDays.trim() === '' ? undefined : Number(sinceDays);
    if (days !== undefined && (!Number.isInteger(days) || days < 0)) {
      setError('Days must be a whole number, 0 or more.');
      return;
    }
    if (op === 'sum' && column === '') {
      setError('Pick a number column to add up.');
      return;
    }
    setError(null);
    const title =
      op === 'count'
        ? `${table.label}${days !== undefined ? ` in the last ${days} days` : ''}`
        : `Total ${table.columns.find((c) => c.name === column)?.label ?? column}`;
    create.mutate(
      {
        table: table.name,
        kind: 'stat',
        title,
        pinned: true,
        config: {
          stat: {
            op,
            ...(op === 'sum' ? { column } : {}),
            ...(days !== undefined ? { sinceDays: days } : {}),
          },
        },
      },
      {
        onSuccess: onDone,
        onError: () => setError("Couldn't pin that number. Try again."),
      },
    );
  };

  return (
    <section aria-label="Pin a number" className="flex max-w-md flex-col gap-2 border-t pt-3">
      <h3 className="text-lg font-semibold">Pin a number</h3>
      <label className="flex flex-col gap-1 text-base">
        What to count
        <select
          aria-label="What to count"
          className="min-h-10 rounded-[var(--radius)] border text-base"
          value={op}
          onChange={(e) => setOp(e.target.value === 'sum' ? 'sum' : 'count')}
        >
          <option value="count">How many rows</option>
          {numberColumns.length > 0 && <option value="sum">Add up a number column</option>}
        </select>
      </label>
      {op === 'sum' && (
        <label className="flex flex-col gap-1 text-base">
          Column
          <select
            aria-label="Column"
            className="min-h-10 rounded-[var(--radius)] border text-base"
            value={column}
            onChange={(e) => setColumn(e.target.value)}
          >
            {numberColumns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-base">
        Only rows from the last N days (optional)
        <input
          aria-label="Only rows from the last N days (optional)"
          className="min-h-10 rounded-[var(--radius)] border px-2 text-base"
          inputMode="numeric"
          placeholder="e.g. 7"
          value={sinceDays}
          onChange={(e) => setSinceDays(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="text-base text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <AppButton onClick={handlePin} disabled={create.isPending}>
          {create.isPending ? 'Pinning…' : 'Pin it'}
        </AppButton>
        <AppButton variant="outline" onClick={onDone}>
          Cancel
        </AppButton>
      </div>
    </section>
  );
}

/** Case-insensitive: a row matches when any cell contains every typed word. */
function matchesQuery(row: Record<string, unknown>, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = Object.values(row)
    .map((v) => String(v ?? '').toLowerCase())
    .join(' ');
  return words.every((w) => text.includes(w));
}

function TableGallery({ lists }: { lists: ListSummary[] }) {
  return (
    <section
      aria-label="Your tables"
      className="mx-auto grid max-w-6xl grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4"
    >
      {lists.map((t) => (
        <Link
          key={t.name}
          to={`/lists?table=${encodeURIComponent(t.name)}`}
          className="panel flex flex-col gap-1 hover:ring-2 hover:ring-ring"
        >
          <span className="flex items-center gap-2 font-semibold">
            <TableIcon size={16} aria-hidden />
            {t.label}
          </span>
          <span className="text-sm text-muted-foreground">
            {t.count} row{t.count === 1 ? '' : 's'} · {t.columns.length} column
            {t.columns.length === 1 ? '' : 's'}
          </span>
        </Link>
      ))}
    </section>
  );
}

/**
 * Data: every table as a card on the board, or the chosen one (?table=, also
 * set from the floating bar) as a searchable, sortable grid.
 */
export default function ListsPage() {
  const lists = useLists();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'grid' | 'cards'>('grid');
  const [pinning, setPinning] = useState(false);
  const [query, setQuery] = useState('');
  const timezone = useBusinessTimezone();
  const views = useViews();
  const table: ListSummary | undefined = lists.data?.find((t) => t.name === params.get('table'));
  const rows = useListRows(table?.name ?? null, { limit: 200 });
  const pinned = (views.data ?? []).filter((v) => v.table === table?.name && v.pinned && v.kind === 'stat');
  const shown = useMemo(
    () => (rows.data?.rows ?? []).filter((r) => matchesQuery(r, query)),
    [rows.data, query],
  );

  if (lists.isPending) return <p>Loading your tables…</p>;
  if (lists.isError) return <p role="alert">Couldn't load your tables. Try again.</p>;
  if (lists.data.length === 0) return <p>You don't have any tables yet.</p>;
  if (!table) return <TableGallery lists={lists.data} />;

  return (
    <section className="panel mx-auto max-w-6xl" aria-label={table.label}>
      <CardHeading icon={TableIcon} title={table.label} count={table.count} />
      <div className="mt-2 mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label={`Search ${table.label}`}
          placeholder="Search this table…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-[16rem] flex-1 rounded-[var(--radius-s)] border border-input bg-background px-3 py-1.5"
        />
        <div className="seg" role="group" aria-label="Layout">
          <button
            type="button"
            aria-pressed={mode === 'grid'}
            className={mode === 'grid' ? 'on' : ''}
            onClick={() => setMode('grid')}
          >
            Grid
          </button>
          <button
            type="button"
            aria-pressed={mode === 'cards'}
            className={mode === 'cards' ? 'on' : ''}
            onClick={() => setMode('cards')}
          >
            Cards
          </button>
        </div>
        <AppButton variant="outline" onClick={() => setPinning((p) => !p)}>
          Pin a number
        </AppButton>
      </div>
      {pinning && <PinNumberForm table={table} onDone={() => setPinning(false)} />}
      {pinned.length > 0 && (
        <section aria-label="Pinned numbers" className="mt-3 flex flex-col gap-2">
          <CardHeading icon={PinIcon} title="Pinned numbers" />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-[0.4rem]">
            {pinned.map((view) => (
              <PinnedStat key={view.id} view={view} />
            ))}
          </div>
        </section>
      )}
      {rows.isPending ? (
        <p>Loading rows…</p>
      ) : rows.isError ? (
        <p role="alert">Couldn't load these rows. Try again.</p>
      ) : (
        <>
          {rows.data.rows.length < rows.data.total && (
            <p>
              Showing {rows.data.rows.length} of {rows.data.total}
            </p>
          )}
          {query.trim() !== '' && (
            <p className="text-sm text-muted-foreground">
              {shown.length} match{shown.length === 1 ? '' : 'es'}
            </p>
          )}
          {mode === 'grid' ? (
            <GridView table={table} rows={shown} timezone={timezone.data?.timezone ?? null} />
          ) : (
            <CardsView table={table} rows={shown} timezone={timezone.data?.timezone ?? null} />
          )}
        </>
      )}
    </section>
  );
}
