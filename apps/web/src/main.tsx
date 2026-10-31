import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted variable fonts (M5): Inter for the interface, Nunito for headings.
import '@fontsource-variable/inter'
import '@fontsource-variable/nunito'
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
