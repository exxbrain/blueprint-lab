import { useMemo, useState } from 'react'
import { tr } from '../i18n'
import { builderChallenges, CHALLENGE_GROUP_LABEL, type BuilderChallenge } from '../sim/builder/challenges'
import { BuilderCanvas } from '../sim/builder/BuilderCanvas'
import { simulate } from '../sim/builder/model'
import { ms, useLiveTraffic } from '../sim/builder/TrafficPanel'
import { modules } from '../content/modules'
import type { Module } from '../content/types'
import { useProgress, type Progress } from '../progress'
import { href } from '../router'

export function moduleProgress(m: Module, p: Progress): { done: number; total: number } {
  const total = m.lessons.length + m.scenarios.length + (m.quiz.length ? 1 : 0)
  const done =
    m.lessons.filter((l) => p.lessons[`${m.id}/${l.id}`]).length +
    m.scenarios.filter((s) => p.scenarios[`${m.id}/${s.id}`]).length +
    ((p.quizzes[m.id] ?? 0) >= 0.8 ? 1 : 0)
  return { done, total }
}

const GROUPS: BuilderChallenge['group'][] = ['Классика', 'Инструменты', 'System Design']

/** Первая фраза условия — как анонс задачи */
function teaser(c: BuilderChallenge): string {
  const text = c.brief[0].replace(/\*\*/g, '')
  const m = text.match(/^.*?[.!?](\s|$)/)
  return (m ? m[0] : text).trim()
}

export function Home() {
  const progress = useProgress()
  const solvedCount = builderChallenges.filter((c) => progress.scenarios[`builder/${c.id}`]).length
  return (
    <div className="page">
      <section className="hero hub-hero">
        <div>
          <h1>{tr('Соберите систему и пустите в неё трафик', 'Build a system and send traffic through it')}</h1>
          <p>
            {tr(
              <>
                Конструктор архитектуры — центр Blueprint Lab. Клиенты шлют настоящие запросы, Redis отвечает HIT и MISS,
                PostgreSQL выполняет SQL, Kafka принимает события, а перегруженные блоки падают с теми же ошибками, что и в
                проде: 503, таймауты, too many clients, отставание консьюмеров.
              </>,
              <>
                The Architecture Builder is the heart of Blueprint Lab. Clients send real requests, Redis answers HIT and
                MISS, PostgreSQL runs SQL, Kafka takes events, and overloaded blocks fail with the same errors as in
                production: 503s, timeouts, too many clients, consumer lag.
              </>,
            )}
          </p>
          <div className="row">
            <a className="btn primary big" href={href('builder')}>
              🏗️ {tr('Открыть конструктор', 'Open the builder')}
            </a>
            <a className="btn big" href={href('builder', builderChallenges[0].id)}>
              🎯 {tr('Первая задача', 'First challenge')}
            </a>
            <span className="small muted">
              {tr(`решено ${solvedCount} из ${builderChallenges.length}`, `${solvedCount} of ${builderChallenges.length} solved`)}
            </span>
          </div>
        </div>
        <LiveDemo />
      </section>

      {GROUPS.map((g) => {
        const list = builderChallenges.filter((c) => c.group === g)
        const done = list.filter((c) => progress.scenarios[`builder/${c.id}`]).length
        return (
          <section key={g} className="hub-group">
            <h2>
              {CHALLENGE_GROUP_LABEL[g]} <span className="small muted">{done}/{list.length}</span>
            </h2>
            <p className="small muted">
              {g === 'Классика'
                ? tr('Инциденты: система падает под нагрузкой, найдите узкое место и уложитесь в бюджет.', 'Incidents: the system falls over under load; find the bottleneck and stay within budget.')
                : g === 'Инструменты'
                  ? tr('В каждой задаче есть проблема, которую решает один конкретный инструмент. Какой — догадайтесь сами.', 'Each challenge has a problem that one specific tool solves. Figure out which one.')
                  : tr('Задачи с собеседований: сначала прикидка нагрузки, потом схема.', 'Interview problems: estimate the load first, then design.')}
            </p>
            <div className="challenge-cards">
              {list.map((c) => (
                <a key={c.id} className={'challenge-card' + (progress.scenarios[`builder/${c.id}`] ? ' done' : '')} href={href('builder', c.id)}>
                  <div className="cc-title">
                    {progress.scenarios[`builder/${c.id}`] ? '✅ ' : ''}
                    {c.title}
                  </div>
                  <div className="small muted">{teaser(c)}</div>
                  <div className="small cc-meta">
                    {tr('бюджет', 'budget')} ${c.budget}
                    {c.estimate ? ' · ' + tr('прикидка', 'estimate') : ''}
                  </div>
                </a>
              ))}
            </div>
          </section>
        )
      })}

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
        {traffic.log.slice(0, 5).map((t) => (
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
