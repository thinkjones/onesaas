import ActivityIcon from 'lucide-react/icons/activity';
import SettingsIcon from 'lucide-react/icons/settings';
import SparklesIcon from 'lucide-react/icons/sparkles';
import TableIcon from 'lucide-react/icons/table';
import TriangleAlertIcon from 'lucide-react/icons/triangle-alert';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, NavLink, useLocation, useMatch, useNavigate } from 'react-router';
import { getRuns, isTauri, useLists, useModelStatus, useSettings, useWorkflows } from '../api.ts';
import { dataExplainValue } from '../explain/useAltClickExplain.ts';
import { BAR_SLOT_ID } from './barSlot.ts';
import './FloatingBar.css';

const MODES = [
  { to: '/', label: 'Activity', end: true, explainId: 'nav-activity', Icon: ActivityIcon, match: ['/'] },
  {
    to: '/automate',
    label: 'Automate',
    end: false,
    explainId: 'nav-automate',
    Icon: SparklesIcon,
    match: ['/automate', '/reducers'],
  },
  { to: '/lists', label: 'Data', end: false, explainId: 'nav-data', Icon: TableIcon, match: ['/lists'] },
];

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Jump between what's in the current mode: every automation, or every table. */
function ContextPicker() {
  const navigate = useNavigate();
  const location = useLocation();
  const reducer = useMatch('/reducers/:workflowId');
  const onAutomate = location.pathname === '/automate' || reducer !== null;
  const onData = location.pathname === '/lists';
  const workflows = useWorkflows();
  const lists = useLists();

  if (onAutomate && (workflows.data?.length ?? 0) > 0) {
    return (
      <select
        className="picker"
        aria-label="Choose an automation"
        value={reducer?.params.workflowId ?? ''}
        onChange={(e) =>
          navigate(e.target.value === '' ? '/automate' : `/reducers/${e.target.value}?mode=design`)
        }
      >
        <option value="">All automations</option>
        {workflows.data!.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    );
  }
  if (onData && (lists.data?.length ?? 0) > 0) {
    return (
      <select
        className="picker"
        aria-label="Choose a table"
        value={new URLSearchParams(location.search).get('table') ?? ''}
        onChange={(e) =>
          navigate(e.target.value === '' ? '/lists' : `/lists?table=${encodeURIComponent(e.target.value)}`)
        }
      >
        <option value="">All tables</option>
        {lists.data!.map((t) => (
          <option key={t.name} value={t.name}>
            {t.label}
          </option>
        ))}
      </select>
    );
  }
  return null;
}

/**
 * The one way around the app, floating top left over a full-screen canvas:
 * Activity, Automate or Data (also Alt+1, 2, 3), then a picker for what's in
 * that mode, then whatever the current screen adds through BarActions.
 */
export default function FloatingBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const inTauri = isTauri();
  const { settings } = useSettings();
  const models = useModelStatus();
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => getRuns() });
  const failedCount = (runs.data ?? []).filter((r) => r.status === 'failed').length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey && !e.metaKey && !e.ctrlKey && !isEditable(e.target)) {
        const mode = MODES[['Digit1', 'Digit2', 'Digit3'].indexOf(e.code)];
        if (mode) {
          e.preventDefault();
          navigate(mode.to);
        }
      }
      // ⌘[ / ⌘] are native in a browser but need wiring inside the webview.
      if (inTauri && e.metaKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        navigate(e.key === '[' ? -1 : 1);
      }
    };
    const onMouse = (e: MouseEvent): void => {
      if (!inTauri) return;
      if (e.button === 3) navigate(-1);
      else if (e.button === 4) navigate(1);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onMouse);
    };
  }, [inTauri, navigate]);

  return (
    <div className={`floatbar${inTauri ? ' tauri' : ''}`} data-testid="floating-bar">
      <span className="wordmark" data-tauri-drag-region>
        OneSaaS
      </span>
      <nav className="modes" aria-label="Primary">
        {MODES.map((mode, i) => {
          const active = mode.match.some((m) =>
            m === '/' ? location.pathname === '/' : location.pathname.startsWith(m),
          );
          return (
            <NavLink
              key={mode.to}
              to={mode.to}
              end={mode.end}
              title={`${mode.label} (Alt+${i + 1})`}
              data-explain={dataExplainValue({ kind: 'ui', id: mode.explainId }, mode.label)}
              className={`mode${active ? ' active' : ''}`}
            >
              <mode.Icon size={15} strokeWidth={2} aria-hidden />
              {mode.label}
            </NavLink>
          );
        })}
      </nav>
      <ContextPicker />
      <div id={BAR_SLOT_ID} className="slot" />
      {models.isError && (
        <span className="err" title="The app couldn't reach the models.">
          Models unavailable
        </span>
      )}
      {failedCount > 0 && (
        <Link to="/" className="warn" title="Failed runs are listed in Activity.">
          <TriangleAlertIcon size={13} strokeWidth={2} aria-hidden />
          {failedCount === 1 ? '1 needs a look' : `${failedCount} need a look`}
        </Link>
      )}
      <NavLink
        to="/settings"
        aria-label="Settings"
        title={settings?.businessName ? `Settings · ${settings.businessName}` : 'Settings'}
        data-explain={dataExplainValue({ kind: 'ui', id: 'nav-settings' }, 'Settings')}
        className={({ isActive }) => `ic${isActive ? ' active' : ''}`}
      >
        <SettingsIcon size={17} strokeWidth={1.75} aria-hidden />
      </NavLink>
    </div>
  );
}
