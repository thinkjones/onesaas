import ActivityIcon from 'lucide-react/icons/activity';
import PlusIcon from 'lucide-react/icons/plus';
import SettingsIcon from 'lucide-react/icons/settings';
import SparklesIcon from 'lucide-react/icons/sparkles';
import TableIcon from 'lucide-react/icons/table';
import { Fragment } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { isTauri, useCreateWorkflow, useLists, useSettings, useWorkflows } from '../api.ts';
import Explain from '../explain/Explain.tsx';
import { dataExplainValue } from '../explain/useAltClickExplain.ts';
import { UNTITLED_CHORE_REDUCER } from '../pages/ChoreReducersPage.tsx';
import './Sidebar.css';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  explainId: string;
  Icon: typeof ActivityIcon;
}

const LINKS: NavItem[] = [
  { to: '/', label: 'Activity', end: true, explainId: 'nav-activity', Icon: ActivityIcon },
  { to: '/automate', label: 'Automate', end: true, explainId: 'nav-automate', Icon: SparklesIcon },
  { to: '/lists', label: 'Data', end: true, explainId: 'nav-data', Icon: TableIcon },
];

const SETTINGS_LINK: NavItem = {
  to: '/settings',
  label: 'Settings',
  end: true,
  explainId: 'nav-settings',
  Icon: SettingsIcon,
};

// NavLink sets aria-current="page" on the active anchor by itself. The icon
// is aria-hidden and the `?` sits OUTSIDE the link, so each link's accessible
// name stays exactly its label (pinned by Sidebar.test.tsx).
function NavRow({ item }: { item: NavItem }) {
  const target = { kind: 'ui' as const, id: item.explainId };
  const Icon = item.Icon;
  return (
    <div data-explain={dataExplainValue(target, item.label)} className="navrow">
      <NavLink
        to={item.to}
        end={item.end}
        className={({ isActive }) => `nav${isActive ? ' active' : ''}`}
      >
        <Icon size={16} strokeWidth={1.75} aria-hidden />
        {item.label}
      </NavLink>
      <Explain target={target} label={item.label} />
    </div>
  );
}

/**
 * Chore reducers under Automate, one row each. NavLink's prefix match keeps
 * the row active on the reducer page and its runs subpage. Empty, pending,
 * or errored renders nothing — the rail never flashes or breaks.
 */
function ReducerSublist() {
  const { data: workflows } = useWorkflows();
  if (workflows === undefined || workflows.length === 0) return null;
  return (
    <ul data-testid="sidebar-reducers" className="sub" aria-label="Chore reducers">
      {workflows.map((w) => (
        <li key={w.id}>
          <NavLink
            to={`/reducers/${w.id}`}
            title={w.name}
            className={({ isActive }) => `nav${isActive ? ' active' : ''}`}
          >
            {w.name}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * Stored lists under Data as `label · count`, deep-linking to ?table=.
 * NavLink ignores the query string when matching active, so every row
 * would light up at once — these use Link with a manual current check
 * (same resolution as ListsPage: named table, else the first list).
 */
function ListSublist() {
  const { data: lists } = useLists();
  const location = useLocation();
  if (lists === undefined || lists.length === 0) return null;
  const param = new URLSearchParams(location.search).get('table');
  const current = lists.some((t) => t.name === param) ? param : lists[0]!.name;
  const onLists = location.pathname === '/lists';
  return (
    <ul data-testid="sidebar-lists" className="sub" aria-label="Stored lists">
      {lists.map((t) => {
        const isCurrent = onLists && t.name === current;
        const label = `${t.label} · ${t.count}`;
        return (
          <li key={t.name}>
            <Link
              to={`/lists?table=${encodeURIComponent(t.name)}`}
              title={label}
              className={`nav${isCurrent ? ' active' : ''}`}
              aria-current={isCurrent ? 'page' : undefined}
            >
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function CreateToolbar() {
  const create = useCreateWorkflow();
  const navigate = useNavigate();
  return (
    <div className="create" role="toolbar" aria-label="Create">
      <button
        type="button"
        className="ic"
        title="New chore reducer"
        aria-label="New chore reducer"
        disabled={create.isPending}
        onClick={() => {
          create.mutate(
            { name: UNTITLED_CHORE_REDUCER, description: '' },
            {
              onSuccess: (wf) => navigate(`/reducers/${wf.id}?mode=design`),
              onError: () => toast("Couldn't create a chore reducer. Try again."),
            },
          );
        }}
      >
        <PlusIcon size={17} strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}

export default function Sidebar() {
  const { settings } = useSettings();
  return (
    <nav className="side" aria-label="Primary">
      {isTauri() && <div className="drag" data-tauri-drag-region aria-hidden />}
      <CreateToolbar />
      <div className="group">
        {LINKS.map((item) => (
          <Fragment key={item.to}>
            <NavRow item={item} />
            {item.to === '/automate' && <ReducerSublist />}
            {item.to === '/lists' && <ListSublist />}
          </Fragment>
        ))}
      </div>
      <div className="foot">
        <NavRow item={SETTINGS_LINK} />
        {settings?.businessName && (
          <span className="vn" title={settings.businessName}>
            {settings.businessName}
          </span>
        )}
      </div>
    </nav>
  );
}
