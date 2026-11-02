import { lazy, Suspense } from 'react'
import { href, useRoute } from './router'
import { findModule } from './content/modules'
import { Home } from './pages/Home'
import { ModulePage } from './pages/ModulePage'
import { LessonPage } from './pages/LessonPage'
import { QuizPage } from './pages/QuizPage'
import { ScenarioPage } from './pages/ScenarioPage'
import { SandboxPage } from './pages/SandboxPage'
import { NotFound } from './pages/NotFound'

const BuilderPage = lazy(() => import('./pages/BuilderPage'))
const MonolithPage = lazy(() => import('./pages/MonolithPage'))

export default function App() {
  const route = useRoute()
  const [first, second, third] = route
  const mod = findModule(first)

  let page
  if (!first) page = <Home />
  else if (first === 'builder') page = <BuilderPage />
  else if (first === 'monolith') page = <MonolithPage />
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
          <img src="/favicon.svg" alt="" />
          Blueprint Lab
        </a>
        <nav>
          <a href={href('kafka')} className={first === 'kafka' ? 'active' : ''}>
            Kafka
          </a>
          <a href={href('microservices')} className={first === 'microservices' || first === 'monolith' ? 'active' : ''}>
            Микросервисы
          </a>
          <a href={href('builder')} className={first === 'builder' ? 'active' : ''}>
            Конструктор
          </a>
        </nav>
      </header>
      <Suspense fallback={<div className="page muted">Загрузка…</div>}>
        <div key={route.join('/')}>{page}</div>
      </Suspense>
    </>
  )
}
