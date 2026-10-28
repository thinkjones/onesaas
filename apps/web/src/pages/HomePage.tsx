import { Link } from 'react-router';

export default function HomePage() {
  return (
    <div>
      <h1>Home</h1>
      <p>Your day at a glance — coming in a later milestone.</p>
      <p>
        New here? <Link to="/settings">Connect Gmail in Settings</Link> so the agent
        can watch your inbox.
      </p>
    </div>
  );
}
