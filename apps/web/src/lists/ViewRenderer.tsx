import CardsView from './CardsView.tsx';
import GridView from './GridView.tsx';
import StatView from './StatView.tsx';
import type { ListTable, ViewData, ViewDef } from './types.ts';

/** Renders a saved view from its computed data. */
export default function ViewRenderer({
  view,
  table,
  data,
  timezone,
}: {
  view: ViewDef;
  table: ListTable;
  data: ViewData;
  timezone: string | null;
}) {
  if (view.kind === 'stat') {
    return <StatView title={view.title} value={data.value ?? 0} />;
  }
  if (view.kind === 'cards') {
    return <CardsView table={table} rows={data.rows ?? []} timezone={timezone} />;
  }
  return (
    <GridView
      table={table}
      rows={data.rows ?? []}
      timezone={timezone}
      columns={view.config.columns}
    />
  );
}
