import { useState } from 'react';
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

/** Lists: left, every list with its count; right, the selected list as an
 * automatic grid (no saved view needed), with a cards toggle, pinned numbers
 * and a "Pin a number" button. */
export default function ListsPage() {
  const lists = useLists();
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'grid' | 'cards'>('grid');
  const [pinning, setPinning] = useState(false);
  const timezone = useBusinessTimezone();
  const views = useViews();
  const table: ListSummary | undefined =
    lists.data?.find((t) => t.name === selected) ?? lists.data?.[0];
  const rows = useListRows(table?.name ?? null, { limit: 200 });
  const pinned = (views.data ?? []).filter((v) => v.table === table?.name && v.pinned && v.kind === 'stat');

  if (lists.isPending) return <p>Loading your lists…</p>;
  if (lists.isError) return <p role="alert">Couldn't load your lists. Try again.</p>;
  if (!table) return <p>You don't have any lists yet.</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-6">
        <nav aria-label="Lists" className="flex w-48 shrink-0 flex-col gap-1">
          {lists.data.map((t) => (
            <AppButton
              key={t.name}
              variant={t.name === table.name ? 'default' : 'outline'}
              onClick={() => {
                setSelected(t.name);
                setPinning(false);
              }}
            >
              {t.label} ({t.count})
            </AppButton>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{table.label}</h2>
            <div className="ml-auto flex gap-2">
              <AppButton
                variant={mode === 'grid' ? 'default' : 'outline'}
                onClick={() => setMode('grid')}
              >
                Grid
              </AppButton>
              <AppButton
                variant={mode === 'cards' ? 'default' : 'outline'}
                onClick={() => setMode('cards')}
              >
                Cards
              </AppButton>
              <AppButton variant="outline" onClick={() => setPinning((p) => !p)}>
                Pin a number
              </AppButton>
            </div>
          </div>
          {pinning && <PinNumberForm table={table} onDone={() => setPinning(false)} />}
          {pinned.length > 0 && (
            <section aria-label="Pinned numbers" className="flex flex-col gap-2">
              <h3 className="text-lg font-semibold">Pinned numbers</h3>
              <div className="flex flex-wrap gap-3">
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
              {mode === 'grid' ? (
                <GridView
                  table={table}
                  rows={rows.data.rows}
                  timezone={timezone.data?.timezone ?? null}
                />
              ) : (
                <CardsView
                  table={table}
                  rows={rows.data.rows}
                  timezone={timezone.data?.timezone ?? null}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
