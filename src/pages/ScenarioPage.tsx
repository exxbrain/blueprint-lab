import { tr } from '../i18n'
import { useRef, useState } from 'react'
import type { Module } from '../content/types'
import { KafkaSimulator } from '../sim/kafka/KafkaSimulator'
import type { KafkaSim } from '../sim/kafka/engine'
import { hintStars, markScenario, recordStars, useProgress } from '../progress'
import { TaskGate } from '../components/Level'
import { href } from '../router'
import { NotFound } from './NotFound'

interface GoalState {
  progress: number
  status: string
  solved: boolean
}

export function ScenarioPage({ mod, scenarioId }: { mod: Module; scenarioId: string }) {
  const progress = useProgress()
  const scenario = mod.scenarios.find((s) => s.id === scenarioId)
  const [goal, setGoal] = useState<GoalState>({ progress: 0, status: '', solved: false })
  const [hints, setHints] = useState(0)
  const holdStart = useRef<number | null>(null)
  const simRef = useRef<KafkaSim | null>(null)
  const triggered = useRef(new WeakSet<KafkaSim>())

  if (!scenario) return <NotFound />
  const key = `${mod.id}/${scenario.id}`
  const idx = mod.scenarios.indexOf(scenario)
  const next = mod.scenarios[idx + 1]

  const onTick = (sim: KafkaSim) => {
    if (sim !== simRef.current) {
      // «Сначала» создаёт новую симуляцию
      simRef.current = sim
      holdStart.current = null
    }
    const g = scenario.goal
    const armed = !g.afterTrigger || triggered.current.has(sim)
    const ok = g.check(sim) && armed
    if (goal.solved) {
      setGoal((s) => ({ ...s, status: g.status(sim) }))
      return
    }
    if (ok) holdStart.current ??= sim.now
    else holdStart.current = null
    const p = holdStart.current === null ? 0 : Math.min(1, (sim.now - holdStart.current) / g.holdSeconds)
    const solved = p >= 1
    if (solved) {
      markScenario(key)
      recordStars(key, hintStars(hints))
    }
    setGoal({ progress: p, status: (armed ? '' : tr('ждём аварию · ', 'waiting for the failure · ')) + g.status(sim), solved })
  }

  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">{tr('Главная', 'Home')}</a> / <a href={href(mod.id)}>{mod.title}</a> / {tr('Инцидент', 'Incident')}
      </div>
      <h1>
        🚨 {scenario.title} <span className="small muted">{'★'.repeat(scenario.difficulty)}</span>
        {progress.scenarios[key] && !goal.solved && <span className="badge ok" style={{ marginLeft: 12 }}>{tr('решено ранее', 'solved earlier')}</span>}
      </h1>
      <TaskGate taskKey={key}>
      <div className="scenario-head">
        <div className="panel lesson">
          {scenario.brief}
          {hints > 0 && (
            <ol className="small">
              {scenario.hints.slice(0, hints).map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ol>
          )}
          {hints < scenario.hints.length && !goal.solved && (
            <button onClick={() => setHints(hints + 1)}>💡 {tr('Подсказка', 'Hint')} ({hints}/{scenario.hints.length})</button>
          )}
        </div>
        <div className={'panel goal' + (goal.solved ? ' success' : '')}>
          <h4>
            {goal.solved ? tr('✅ Решено!', '✅ Solved!') : tr('🎯 Цель', '🎯 Goal')}
            {goal.solved && <span className="goal-stars">{[1, 2, 3].map((i) => <span key={i} className={i <= hintStars(hints) ? 'on' : ''}>★</span>)}</span>}
          </h4>
          <div>{scenario.goal.text}</div>
          <div className="progressbar">
            <div style={{ width: `${goal.progress * 100}%` }} />
          </div>
          <div className="small muted">{goal.status}</div>
        </div>
      </div>
      {goal.solved && (
        <div className="panel success lesson" style={{ marginBottom: 16 }}>
          <h3>{tr('Разбор', 'Debrief')}</h3>
          {scenario.debrief}
          <div className="row">
            {next ? (
              <a href={href(mod.id, 'scenario', next.id)}>
                <button className="primary">{tr('Следующий инцидент', 'Next incident')}: {next.title} →</button>
              </a>
            ) : (
              <a href={href(mod.id)}>
                <button className="primary">{tr('К модулю', 'Back to module')}</button>
              </a>
            )}
          </div>
        </div>
      )}
      <KafkaSimulator
        config={scenario.config}
        controls={scenario.controls}
        onTick={onTick}
        extraActions={(sim, act) =>
          scenario.trigger && (
            <button
              className="primary"
              disabled={triggered.current.has(sim)}
              onClick={() =>
                act((s) => {
                  triggered.current.add(s)
                  scenario.trigger!.run(s)
                })
              }
            >
              {scenario.trigger.label}
            </button>
          )
        }
      />
      </TaskGate>
    </div>
  )
}
