import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import './styles/index.css'
import './styles/web-v1.css'
import './styles/web-v1-platform.css'
import './styles/immersive.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
