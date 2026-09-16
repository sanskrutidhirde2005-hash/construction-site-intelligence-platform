import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './mobile.css'
import './tactile.css'
import App from './App.jsx'
import ToastHost from './ToastHost.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <ToastHost />
  </StrictMode>,
)
