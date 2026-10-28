import { NavLink } from 'react-router';

const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/reducers', label: 'Chore reducers', end: false },
  { to: '/lists', label: 'Lists', end: true },
  { to: '/settings', label: 'Settings', end: true },
];

// NavLink sets aria-current="page" on the active anchor by itself.
export default function NavRail() {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 p-3">
      {LINKS.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex min-h-10 items-center rounded-md px-3 text-base ${
              isActive ? 'bg-muted font-semibold' : 'hover:bg-muted/60'
            }`
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
