import ChevronLeftIcon from 'lucide-react/icons/chevron-left';
import ChevronRightIcon from 'lucide-react/icons/chevron-right';
import TriangleAlertIcon from 'lucide-react/icons/triangle-alert';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useLocation, useMatch, useNavigate } from 'react-router';
import { getRuns, getWorkflows, isTauri, useModelStatus } from '../api.ts';
import './TopBar.css';

interface Crumb {
  label: string;
  to?: string;
}

function historyIndex(): number {
  const state = window.history.state as { idx?: unknown } | null;
  return typeof state?.idx === 'number' ? state.idx : 0;
}

function Crumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb" data-tauri-drag-region>
      {crumbs.map((c, i) => (
        <span key={`${c.label}-${i}`} className="crumbwrap">
          {i > 0 && (
            <span className="sep" aria-hidden="true">
              ›
            </span>
          )}
          {i === crumbs.length - 1 ? (
            <h1 aria-current="page">{c.label}</h1>
          ) : c.to !== undefined ? (
            <Link className="crumb" to={c.to}>
              {c.label}
            </Link>
          ) : (
            <span className="crumb">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export default function TopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const reducerMatch = useMatch('/reducers/:workflowId');
  const inTauri = isTauri();

  // The reducer name for `Chore reducers › <name>`; other routes never fetch.
  const workflowsQuery = useQuery({
    queryKey: ['workflows'],
    queryFn: getWorkflows,
    enabled: reducerMatch !== null,
  });
  // Status badges (conditional): model health + runs needing a look.
  const modelsQuery = useModelStatus();
  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: () => getRuns() });
  const failedCount = (runsQuery.data ?? []).filter((r) => r.status === 'failed').length;

  // ⌘[ / ⌘] and the mouse side buttons. Browser-native behaviour already
  // covers these outside Tauri; inside the webview they need explicit wiring
  // (attaching both would navigate twice).
  useEffect(() => {
    if (!inTauri) return;
    const onKey = (e: KeyboardEvent): void => {
      if (!e.metaKey) return;
      if (e.key === '[') {
        e.preventDefault();
        navigate(-1);
      } else if (e.key === ']') {
        e.preventDefault();
        navigate(1);
      }
    };
    const onMouse = (e: MouseEvent): void => {
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

  const path = location.pathname;
  let crumbs: Crumb[];
  if (path === '/') crumbs = [{ label: 'Activity' }];
  else if (path === '/automate') crumbs = [{ label: 'Automate' }];
  else if (path === '/reducers') crumbs = [{ label: 'Chore reducers' }];
  else if (reducerMatch?.params.workflowId !== undefined) {
    const name = workflowsQuery.data?.find((w) => w.id === reducerMatch.params.workflowId)?.name;
    crumbs = [{ label: 'Chore reducers', to: '/reducers' }, { label: name ?? '…' }];
  } else if (path === '/lists') crumbs = [{ label: 'Data' }];
  else if (path === '/settings') crumbs = [{ label: 'Settings' }];
  else if (path === '/design') crumbs = [{ label: 'Design' }];
  else crumbs = [{ label: '…' }];

  const idx = historyIndex();
  const canBack = idx > 0;
  const canForward = idx < window.history.length - 1;

  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="nav">
        <button
          type="button"
          className="ic"
          title="Back (⌘[)"
          aria-label="Back"
          disabled={!canBack}
          onClick={() => navigate(-1)}
        >
          <ChevronLeftIcon size={18} strokeWidth={2} aria-hidden />
        </button>
        <button
          type="button"
          className="ic"
          title="Forward (⌘])"
          aria-label="Forward"
          disabled={!canForward}
          onClick={() => navigate(1)}
        >
          <ChevronRightIcon size={18} strokeWidth={2} aria-hidden />
        </button>
      </div>
      <Crumbs crumbs={crumbs} />
      {modelsQuery.isError && (
        <span className="err" title="The app couldn't reach the models.">
          Models unavailable
        </span>
      )}
      {failedCount > 0 && (
        <span className="warn" title="Failed runs are listed in Activity.">
          <TriangleAlertIcon size={13} strokeWidth={2} aria-hidden />
          {failedCount === 1 ? '1 needs a look' : `${failedCount} need a look`}
        </span>
      )}
    </header>
  );
}
