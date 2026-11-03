import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { lang, tr } from './i18n'

document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang
document.title = tr('Blueprint Lab — архитектура на практике', 'Blueprint Lab — hands-on software architecture')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
