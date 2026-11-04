import PinIcon from 'lucide-react/icons/pin';
import Search from 'lucide-react/icons/search';
import TableIcon from 'lucide-react/icons/table';
import XIcon from 'lucide-react/icons/x';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
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
import { CellValue } from './cells.tsx';
import GridView from './GridView.tsx';
import { isLevelColumn } from './levels.ts';
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
        size="sm"
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

/** The left pane: every table with its row count. */
function TablesList({
  lists,
  current,
  onPick,
}: {
  lists: ListSummary[];
  current: string;
  onPick(name: string): void;
}) {
  return (
    <aside
      aria-label="Your tables"
      className="flex w-[220px] flex-none flex-col gap-1 self-start rounded-[var(--radius)] border border-border bg-card p-3 shadow-sm"
    >
      <span className="section-label px-1.5 pt-1 pb-1.5">Your tables</span>
      {lists.map((t) => (
        <button
          key={t.name}
          type="button"
          className="tables-item"
          aria-current={t.name === current ? 'true' : undefined}
          onClick={() => onPick(t.name)}
        >
          <TableIcon size={16} aria-hidden className={t.name === current ? 'text-primary' : 'text-muted-foreground'} />
          <span className="min-w-0 flex-1 text-[0.882rem] break-words">{t.label}</span>
          <span className="text-[0.765rem] font-normal text-muted-foreground">{t.count}</span>
        </button>
      ))}
      <span className="my-1.5 h-px bg-border" />
      <span className="px-1.5 text-[0.765rem] leading-[1.45] text-muted-foreground">
        Your automations fill these tables.
      </span>
    </aside>
  );
}

/** "Priya Nair" becomes PN. */
function initialsOf(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** The right pane: one row's fields, all in full. */
function RowDetail({
  table,
  row,
  timezone,
  onClose,
}: {
  table: ListSummary;
  row: Record<string, unknown>;
  timezone: string | null;
  onClose(): void;
}) {
  const heading = String(row[table.displayField] ?? 'This row');
  const fields = table.columns.filter((c) => c.name !== table.displayField);
  return (
    <aside
      aria-label={heading}
      className="flex w-[370px] flex-none flex-col gap-3.5 self-start rounded-[18px] border border-border bg-card p-5 shadow-md"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-11 flex-none items-center justify-center rounded-full bg-accent-soft font-bold text-accent-ink">
          {initialsOf(heading)}
        </span>
        <h2 className="m-0 min-w-0 flex-1 text-[1.176rem] font-bold break-words">{heading}</h2>
        <AppButton variant="ghost" size="icon-sm" aria-label="Close details" onClick={onClose}>
          <XIcon aria-hidden />
        </AppButton>
      </div>
      <dl className="m-0 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[0.824rem]">
        {fields.map((c) => (
          <div key={c.name} className="contents">
            <dt className="text-muted-foreground">{c.label}</dt>
            <dd className="m-0 font-semibold break-words">
              <CellValue type={c.type} value={row[c.name]} timezone={timezone} column={c.name} />
            </dd>
          </div>
        ))}
        {typeof row['created_at'] === 'string' && (
          <>
            <dt className="text-muted-foreground">Added</dt>
            <dd className="m-0 font-semibold">
              <CellValue type="datetime" value={row['created_at']} timezone={timezone} />
            </dd>
          </>
        )}
      </dl>
    </aside>
  );
}

/**
 * Data, in three panes: the tables, the chosen table (?table=, else the first)
 * as a searchable grid or cards, and the details of the row you click.
 */
export default function ListsPage() {
  const lists = useLists();
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState<'grid' | 'cards'>('grid');
  const [pinning, setPinning] = useState(false);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const timezone = useBusinessTimezone();
  const views = useViews();
  const table: ListSummary | undefined =
    lists.data?.find((t) => t.name === params.get('table')) ?? lists.data?.[0];
  const rows = useListRows(table?.name ?? null, { limit: 200 });
  // A link to one record (?row=) opens it, once per link: closing it stays closed.
  const rowParam = params.get('row');
  const linkedKey = rowParam === null || !rows.data ? null : `${table?.name}/${rowParam}`;
  const [openedLink, setOpenedLink] = useState<string | null>(null);
  const [linkMissing, setLinkMissing] = useState(false);
  if (linkedKey !== null && linkedKey !== openedLink) {
    setOpenedLink(linkedKey);
    const linked = rows.data!.rows.find((r) => String(r['id']) === rowParam);
    setSelectedRow(linked ?? null);
    setLinkMissing(linked === undefined);
    setQuery('');
    setLevel(null);
  }
  const pinned = (views.data ?? []).filter((v) => v.table === table?.name && v.pinned && v.kind === 'stat');
  const levelColumn = table?.columns.find((c) => isLevelColumn(c.name));
  const levels = useMemo(() => {
    if (!levelColumn) return [];
    const seen = new Set((rows.data?.rows ?? []).map((r) => String(r[levelColumn.name] ?? '')));
    seen.delete('');
    return [...seen];
  }, [rows.data, levelColumn]);
  const shown = useMemo(
    () =>
      (rows.data?.rows ?? []).filter(
        (r) =>
          matchesQuery(r, query) &&
          (level === null || levelColumn === undefined || String(r[levelColumn.name] ?? '') === level),
      ),
    [rows.data, query, level, levelColumn],
  );

  const page = 'flex h-full min-h-0 gap-4 px-3.5 pt-20 pb-3.5';
  if (lists.isPending) return <p className={page}>Loading your tables…</p>;
  if (lists.isError) return <p role="alert" className={page}>Couldn't load your tables. Try again.</p>;
  if (lists.data.length === 0 || !table) return <p className={page}>You don't have any tables yet.</p>;

  const pickTable = (name: string): void => {
    setQuery('');
    setLevel(null);
    setSelectedRow(null);
    setLinkMissing(false);
    setPinning(false);
    setParams({ table: name });
  };
  const tz = timezone.data?.timezone ?? null;

  return (
    <div className={page}>
      <TablesList lists={lists.data} current={table.name} onPick={pickTable} />
      <section
        aria-label={table.label}
        className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-border bg-card shadow-sm"
      >
        <div className="flex flex-col gap-3 px-5 pt-[18px] pb-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="m-0 mr-auto text-[1.412rem] font-bold">
              {table.label} <span className="font-medium text-muted-foreground">· {table.count}</span>
            </h1>
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
            <AppButton variant="outline" size="sm" onClick={() => setPinning((p) => !p)}>
              Pin a number
            </AppButton>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-w-[14rem] flex-1 items-center gap-2 rounded-[var(--radius-s)] border border-border bg-input px-3">
              <Search size={16} className="text-muted-foreground" aria-hidden />
              <input
                type="search"
                aria-label={`Search ${table.label}`}
                placeholder="Search this table…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-10 min-w-0 flex-1 border-0! bg-transparent! px-0! text-[0.824rem] outline-none!"
              />
            </label>
            {levelColumn && levels.length > 0 && (
              <div role="group" aria-label={levelColumn.label} className="flex items-center gap-1.5">
                <span className="text-[0.765rem] text-muted-foreground">{levelColumn.label}</span>
                {[null, ...levels].map((value) => (
                  <button
                    key={value ?? 'all'}
                    type="button"
                    className="chip"
                    aria-pressed={level === value}
                    onClick={() => setLevel(value)}
                  >
                    {value ?? 'All'}
                  </button>
                ))}
              </div>
            )}
          </div>
          {pinning && <PinNumberForm table={table} onDone={() => setPinning(false)} />}
          {pinned.length > 0 && (
            <section aria-label="Pinned numbers" className="flex flex-col gap-2">
              <CardHeading icon={PinIcon} title="Pinned numbers" />
              <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-[0.4rem]">
                {pinned.map((view) => (
                  <PinnedStat key={view.id} view={view} />
                ))}
              </div>
            </section>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {rows.isPending ? (
            <p className="px-5">Loading rows…</p>
          ) : rows.isError ? (
            <p role="alert" className="px-5">
              Couldn't load these rows. Try again.
            </p>
          ) : (
            <>
              {rows.data.rows.length < rows.data.total && (
                <p className="px-5">
                  Showing {rows.data.rows.length} of {rows.data.total}
                </p>
              )}
              {linkMissing && (
                <p role="status" className="px-5 text-sm text-muted-foreground">
                  I couldn&apos;t find that record here. It may have been removed, or be past the rows showing here.
                </p>
              )}
              {query.trim() !== '' && (
                <p className="px-5 text-sm text-muted-foreground">
                  {shown.length} match{shown.length === 1 ? '' : 'es'}
                </p>
              )}
              {mode === 'grid' ? (
                <GridView
                  table={table}
                  rows={shown}
                  timezone={tz}
                  selectedRow={selectedRow ?? undefined}
                  onSelectRow={setSelectedRow}
                />
              ) : (
                <div className="px-5 pb-4">
                  <CardsView table={table} rows={shown} timezone={tz} />
                </div>
              )}
            </>
          )}
        </div>
        {/* Labelled as a concept: asking in plain words isn't built yet. */}
        <div className="concept-bar">
          <span className="tag">CONCEPT</span>
          <span>Ask your data: &ldquo;Who needs catering this month?&rdquo;</span>
        </div>
      </section>
      {selectedRow && (
        <RowDetail table={table} row={selectedRow} timezone={tz} onClose={() => setSelectedRow(null)} />
      )}
    </div>
  );
}
