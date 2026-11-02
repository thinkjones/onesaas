import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// System fonts only (Craft §1): --font-ui/--font-heading in styles/tokens.css.
import './styles/app.css'
import App from './App.tsx'
import DesktopGate from './shell/DesktopGate.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesktopGate>
      <App />
    </DesktopGate>
  </StrictMode>,
)
