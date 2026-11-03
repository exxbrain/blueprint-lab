import { lazy, Suspense, useEffect, useLayoutEffect } from 'react'
import { href, useRoute } from './router'
import { findModule } from './content/modules'
import { tr } from './i18n'
import { LangPicker } from './components/LangPicker'
import { Home } from './pages/Home'
import { ModulePage } from './pages/ModulePage'
import { LessonPage } from './pages/LessonPage'
import { QuizPage } from './pages/QuizPage'
import { ScenarioPage } from './pages/ScenarioPage'
import { SandboxPage } from './pages/SandboxPage'
import { NotFound } from './pages/NotFound'
import { LevelBadge, LevelToasts } from './components/Level'

const BuilderPage = lazy(() => import('./pages/BuilderPage'))
const MonolithPage = lazy(() => import('./pages/MonolithPage'))
const C4Page = lazy(() => import('./pages/C4Page'))
const CapPage = lazy(() => import('./pages/CapPage'))
const EsPage = lazy(() => import('./pages/EsPage'))
const ReferencePage = lazy(() => import('./pages/ReferencePage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const K8sPage = lazy(() => import('./pages/K8sPage'))

export default function App() {
  const route = useRoute()
  const [first, second, third] = route
  // высота шапки — в переменную --topbar-h: липкие панели страниц встают сразу под неё, даже когда меню в две строки
  useEffect(() => {
    const bar = document.querySelector('.topbar')
    if (!bar) return
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${bar.getBoundingClientRect().height}px`))
    ro.observe(bar)
    return () => ro.disconnect()
  }, [])
  // новая страница — с начала; карта сама прокручивается к заданию, откуда пришли (Home)
  useLayoutEffect(() => {
    if (first) window.scrollTo(0, 0)
  }, [route.join('/')])
  // строка меню прокручивается вбок, если не помещается: активный пункт всегда в видимой части
  useEffect(() => {
    document.querySelector('.topbar nav a.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [first])
  const mod = findModule(first)

  let page
  if (!first) page = <Home />
  else if (first === 'builder') page = <BuilderPage id={second} />
  else if (first === 'monolith') page = <MonolithPage projectId={second} stepId={third} />
  else if (first === 'c4' && second === 'exercises') page = <C4Page id={third} />
  else if (first === 'data' && second === 'cap') page = <CapPage id={third} />
  else if (first === 'data' && second === 'es') page = <EsPage id={third} />
  else if (first === 'profile') page = <ProfilePage />
  else if (first === 'kubernetes' && second === 'lab') page = <K8sPage id={third} />
  else if (first === 'reference') page = <ReferencePage focus={second} />
  else if (!mod) page = <NotFound />
  else if (!second) page = <ModulePage mod={mod} />
  else if (second === 'lesson' && third) page = <LessonPage mod={mod} lessonId={third} />
  else if (second === 'quiz') page = <QuizPage mod={mod} />
  else if (second === 'scenario' && third) page = <ScenarioPage mod={mod} scenarioId={third} />
  else if (second === 'sandbox' && mod.id === 'kafka') page = <SandboxPage />
  else page = <NotFound />

  return (
    <>
      <header className="topbar">
        <a className="logo" href="#/" aria-label={tr('Blueprint Lab — на карту', 'Blueprint Lab: to the map')}>
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          <span className="logo-text">Blueprint Lab</span>
        </a>
        <nav>
          <a href="#/" className={'nav-home' + (!first ? ' active' : '')} aria-current={!first ? 'page' : undefined}>
            <span aria-hidden>🗺️</span> {tr('Карта', 'Map')}
          </a>
          <a href={href('builder')} className={first === 'builder' ? 'active' : ''} aria-current={first === 'builder' ? 'page' : undefined}>
            {tr('Конструктор', 'Builder')}
          </a>
          <a href={href('kafka')} className={first === 'kafka' ? 'active' : ''} aria-current={first === 'kafka' ? 'page' : undefined}>
            Kafka
          </a>
          <a href={href('kubernetes')} className={first === 'kubernetes' ? 'active' : ''} aria-current={first === 'kubernetes' ? 'page' : undefined}>
            Kubernetes
          </a>
          <a href={href('microservices')} className={first === 'microservices' || first === 'monolith' ? 'active' : ''} aria-current={first === 'microservices' || first === 'monolith' ? 'page' : undefined}>
            {tr('Микросервисы', 'Microservices')}
          </a>
          <a href={href('data')} className={first === 'data' ? 'active' : ''} aria-current={first === 'data' ? 'page' : undefined}>
            {tr('Данные', 'Data')}
          </a>
          <a href={href('c4')} className={first === 'c4' ? 'active' : ''} aria-current={first === 'c4' ? 'page' : undefined}>
            C4
          </a>
          <a href={href('reference')} className={first === 'reference' ? 'active' : ''} aria-current={first === 'reference' ? 'page' : undefined}>
            {tr('Справочник', 'Reference')}
          </a>
        </nav>
        <LevelBadge active={first === 'profile'} />
        <LangPicker />
      </header>
      <Suspense fallback={<div className="page muted">{tr('Загрузка…', 'Loading…')}</div>}>
        <div key={route.join('/')}>{page}</div>
      </Suspense>
      <LevelToasts />
    </>
  )
}
