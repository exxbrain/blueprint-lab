import { lazy, Suspense } from 'react'
import { href, useRoute } from './router'
import { findModule } from './content/modules'
import { lang, setLang, tr } from './i18n'
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
        <a className="logo" href="#/">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          <span className="logo-text">Blueprint Lab</span>
        </a>
        <nav>
          <a href={href('builder')} className={first === 'builder' ? 'active' : ''}>
            {tr('Конструктор', 'Builder')}
          </a>
          <a href={href('kafka')} className={first === 'kafka' ? 'active' : ''}>
            Kafka
          </a>
          <a href={href('kubernetes')} className={first === 'kubernetes' ? 'active' : ''}>
            Kubernetes
          </a>
          <a href={href('microservices')} className={first === 'microservices' || first === 'monolith' ? 'active' : ''}>
            {tr('Микросервисы', 'Microservices')}
          </a>
          <a href={href('data')} className={first === 'data' ? 'active' : ''}>
            {tr('Данные', 'Data')}
          </a>
          <a href={href('c4')} className={first === 'c4' ? 'active' : ''}>
            C4
          </a>
          <a href={href('reference')} className={first === 'reference' ? 'active' : ''}>
            {tr('Справочник', 'Reference')}
          </a>
        </nav>
        <LevelBadge active={first === 'profile'} />
        <div className="lang-switch" role="group" aria-label="Language">
          <button className={lang === 'ru' ? 'primary' : ''} onClick={() => lang !== 'ru' && setLang('ru')}>
            RU
          </button>
          <button className={lang === 'en' ? 'primary' : ''} onClick={() => lang !== 'en' && setLang('en')}>
            EN
          </button>
        </div>
      </header>
      <Suspense fallback={<div className="page muted">{tr('Загрузка…', 'Loading…')}</div>}>
        <div key={route.join('/')}>{page}</div>
      </Suspense>
      <LevelToasts />
    </>
  )
}
