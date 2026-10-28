import './App.css';
import Pairing from './Pairing.tsx';
import RunLog from './RunLog.tsx';

// Bare M1 page: pairing card + live run log. Template CSS and main.tsx are
// untouched on purpose — no styling work until M2/M5.
function App() {
  return (
    <>
      <h1>My Dad&apos;s AI Agent</h1>
      <Pairing />
      <RunLog />
    </>
  );
}

export default App;
