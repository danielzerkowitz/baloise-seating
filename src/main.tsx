// Shared styles first: in the bundle they must come before the views' own styles, so that
// a view's class can refine a base class of the same weight.
import './styles/index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startPersistence } from './state/store'

void startPersistence()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
