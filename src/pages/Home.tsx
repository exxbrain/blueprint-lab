import { useLayoutEffect, useMemo, useState } from 'react'
import { tr } from '../i18n'
import { builderChallenges } from '../sim/builder/challenges'
import { BuilderCanvas } from '../sim/builder/BuilderCanvas'
import { simulate } from '../sim/builder/model'
import { ms, useCalm, useLiveTraffic } from '../sim/builder/TrafficPanel'
import { modules } from '../content/modules'
import type { Module } from '../content/types'
import { useProgress, type Progress } from '../progress'
import { href, lastRoute, savedScroll } from '../router'
import { LevelMap, PlayerCard } from '../components/LevelMap'

export function moduleProgress(m: Module, p: Progress): { done: number; total: number } {
  const total = m.lessons.length + m.scenarios.length + (m.quiz.length ? 1 : 0)
  const done =
    m.lessons.filter((l) => p.lessons[`${m.id}/${l.id}`]).length +
    m.scenarios.filter((s) => p.scenarios[`${m.id}/${s.id}`]).length +
    ((p.quizzes[m.id] ?? 0) >= 0.8 ? 1 : 0)
  return { done, total }
}

export function Home() {
  const progress = useProgress()
  // вернулись на карту из задания — карта на месте этого задания; иначе — там, где с неё ушли
  useLayoutEffect(() => {
    const from = lastRoute()
    const node = from ? document.querySelector(`.page a[href="${CSS.escape(from)}"]`) : null
    if (node) node.scrollIntoView({ block: 'center' })
    else window.scrollTo(0, savedScroll('#/') ?? 0)
  }, [])
  return (
    <div className="page">
      <section className="game-top">
        <div className="game-title">
          <h1>{tr('Blueprint Lab: путь архитектора', 'Blueprint Lab: the architect\'s path')}</h1>
          <p className="muted">
            {tr(
              'Проходите уровни от Младшего до Архитектора: собирайте системы, пускайте в них трафик и чините то, что падает.',
              'Go from Junior to Architect: build systems, send traffic through them and fix what breaks.',
            )}
          </p>
        </div>
        <PlayerCard />
      </section>

      <LevelMap />

      <section className="hub-hero">
        <div>
          <h2>{tr('Как это работает', 'How it works')}</h2>
          <p>
            {tr(
              <>
                В каждом уровне — живая схема. Клиенты шлют настоящие запросы, Redis отвечает HIT и MISS, PostgreSQL
                выполняет SQL, Kafka принимает события, а перегруженные блоки падают с теми же ошибками, что и в проде:
                503, таймауты, too many clients, отставание консьюмеров.
              </>,
              <>
                Every level is a live diagram. Clients send real requests, Redis answers HIT and MISS, PostgreSQL runs
                SQL, Kafka takes events, and overloaded blocks fail with the same errors as in production: 503s,
                timeouts, too many clients, consumer lag.
              </>,
            )}
          </p>
          <div className="row">
            <a className="btn big" href={href('builder')}>
              🏗️ {tr('Свободный режим', 'Sandbox')}
            </a>
          </div>
        </div>
        <LiveDemo />
      </section>

      <h2 className="hub-more">{tr('Уроки и другие симуляторы', 'Lessons and other simulators')}</h2>
      <div className="tiles">
        {modules.map((m) => {
          const { done, total } = moduleProgress(m, progress)
          const content = (
            <>
              <div className="icon">{m.icon}</div>
              <h3>{m.title}</h3>
              <p>{m.summary}</p>
              {m.status === 'soon' ? (
                <span className="badge warn">{tr('скоро', 'coming soon')}</span>
              ) : total > 0 ? (
                <>
                  <div className="progressbar">
                    <div style={{ width: `${(done / total) * 100}%` }} />
                  </div>
                  <div className="small muted" style={{ marginTop: 6 }}>
                    {tr(`пройдено ${done} из ${total}`, `${done} of ${total} completed`)}
                  </div>
                </>
              ) : (
                <div className="small muted">{m.extras.map((e) => e.title).join(' · ')}</div>
              )}
            </>
          )
          return m.status === 'soon' ? (
            <div key={m.id} className="tile soon">
              {content}
            </div>
          ) : (
            <a key={m.id} className="tile" href={href(m.id)}>
              {content}
            </a>
          )
        })}
      </div>
    </div>
  )
}

/** Живая схема на главной: та же система до и после исправления */
function LiveDemo() {
  const ch = builderChallenges.find((c) => c.id === 'tickets') ?? builderChallenges[0]
  const [fixed, setFixed] = useState(false)
  const { nodes, edges } = fixed ? ch.solution : ch
  const result = useMemo(() => simulate(nodes, edges), [nodes, edges])
  const traffic = useLiveTraffic(nodes, edges, result, true)
  const calmLog = useCalm(traffic.log)
  const noop = () => {}
  return (
    <div className="panel hub-demo">
      <div className="row hub-demo-head">
        <b>{ch.title}</b>
        <div className="row tabs">
          <button className={fixed ? '' : 'primary'} onClick={() => setFixed(false)}>
            {tr('Как есть', 'As is')}
          </button>
          <button className={fixed ? 'primary' : ''} onClick={() => setFixed(true)}>
            {tr('После исправления', 'Fixed')}
          </button>
        </div>
      </div>
      <BuilderCanvas
        nodes={nodes}
        edges={edges}
        result={result}
        selected={null}
        onSelect={noop}
        onMove={noop}
        onConnect={noop}
        traces={traffic.inFlight}
        fit
      />
      <div className="access-log hub-log">
        {calmLog.slice(0, 5).map((t) => (
          <div key={t.id} className={'access-row' + (t.status === 'error' ? ' err' : '')}>
            <span className={'code ' + (t.status === 'error' ? 'bad' : 'ok')}>{t.httpStatus || 'ERR'}</span>
            <span className="req">
              {t.request.split('  ')[0]}
              {t.status === 'error' && <span className="muted"> — {t.spans.find((s) => s.status === 'error')?.detail}</span>}
            </span>
            <span className="dur">{ms(t.totalMs)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
