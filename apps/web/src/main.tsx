import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/app.css'
import App from './App.tsx'

// Morning is the only theme in M2; the attribute selects the token set.
document.documentElement.dataset.theme = 'morning'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
