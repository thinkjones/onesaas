import { NavLink } from 'react-router';
import Explain from '../explain/Explain.tsx';
import { dataExplainValue } from '../explain/useAltClickExplain.ts';

const LINKS = [
  { to: '/', label: 'Home', end: true, explainId: 'nav-home' },
  { to: '/reducers', label: 'Chore reducers', end: false, explainId: 'nav-reducers' },
  { to: '/lists', label: 'Lists', end: true, explainId: 'nav-lists' },
  { to: '/settings', label: 'Settings', end: true, explainId: 'nav-settings' },
];

// NavLink sets aria-current="page" on the active anchor by itself. The `?`
// sits OUTSIDE the link so each link's accessible name stays exactly its
// label (pinned by NavRail.test.tsx).
export default function NavRail() {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 p-3">
      {LINKS.map(({ to, label, end, explainId }) => {
        const target = { kind: 'ui' as const, id: explainId };
        return (
          <div
            key={to}
            data-explain={dataExplainValue(target, label)}
            className="flex items-center gap-1"
          >
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-h-10 flex-1 items-center rounded-md px-3 text-base ${
                  isActive ? 'bg-muted font-semibold' : 'hover:bg-muted/60'
                }`
              }
            >
              {label}
            </NavLink>
            <Explain target={target} label={label} />
          </div>
        );
      })}
    </nav>
  );
}
