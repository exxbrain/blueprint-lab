import { useEffect, useState } from 'react'
import { C4_EXERCISES } from '../sim/c4/exercises'
import { C4Canvas, C4_MIME } from '../sim/c4/C4Canvas'
import {
  BOUNDARY,
  EL_H,
  EL_W,
  KIND_INFO,
  LEVEL_INFO,
  needsTech,
  reviewDiagram,
  type C4Exercise,
  type C4Kind,
  type DiagramState,
} from '../sim/c4/model'
import { Rich } from '../components/Rich'
import { ReviewPanel } from '../components/ReviewPanel'
import { markScenario, useProgress } from '../progress'

let uid = 1000

export default function C4Page() {
  const progress = useProgress()
  const [exId, setExId] = useState(C4_EXERCISES[0].id)
  const ex = C4_EXERCISES.find((x) => x.id === exId)!
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">Главная</a> / <a href="#/c4">C4 Model</a> / Упражнения
      </div>
      <h1>🗺️ Упражнения по C4</h1>
      <div className="row tabs">
        {C4_EXERCISES.map((x, i) => (
          <button key={x.id} className={x.id === exId ? 'primary' : ''} onClick={() => setExId(x.id)}>
            {progress.scenarios[`c4/${x.id}`] ? '✓ ' : ''}
            {i + 1}. {x.title} <span className="small">· {LEVEL_INFO[x.level].title}</span>
          </button>
        ))}
      </div>
      <Exercise key={ex.id} ex={ex} />
    </div>
  )
}

/** Свободное место для новой карточки: снаружи границы, если она есть */
function freePlace(d: DiagramState): { x: number; y: number } {
  const spots: { x: number; y: number }[] = []
  for (let y = 10; y <= 560; y += 90) for (const x of [30, 810]) spots.push({ x, y })
  for (let x = 230; x <= 640; x += 180) spots.push({ x, y: 10 }, { x, y: 560 })
  for (let y = BOUNDARY.y + 20; y < BOUNDARY.y + BOUNDARY.h - EL_H; y += 100)
    for (let x = BOUNDARY.x + 20; x < BOUNDARY.x + BOUNDARY.w - EL_W; x += 180) spots.push({ x, y })
  const free = spots.find((s) => d.placed.every((p) => Math.abs(p.x - s.x) >= EL_W + 6 || Math.abs(p.y - s.y) >= EL_H + 6))
  return free ?? { x: 30, y: 10 }
}

function Exercise({ ex }: { ex: C4Exercise }) {
  const initial: DiagramState = ex.start ? structuredClone(ex.start) : { placed: [], rels: [] }
  const [d, setD] = useState<DiagramState>(initial)
  const [selected, setSelected] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  const [hints, setHints] = useState(0)
  const [mine, setMine] = useState<DiagramState | null>(null)
  const viewingRef = mine !== null
  const review = reviewDiagram(ex, d)
  const showReview = checked || review.solved

  useEffect(() => {
    if (review.solved && !viewingRef) markScenario(`c4/${ex.id}`)
  }, [review.solved, viewingRef, ex.id])

  const unplaced = ex.cards.filter((c) => !d.placed.some((p) => p.card === c.id))
  const selEl = d.placed.find((p) => p.card === selected)
  const selRel = d.rels.find((r) => r.id === selected)
  const card = (id: string) => ex.cards.find((c) => c.id === id)!

  const place = (cardId: string, pos?: { x: number; y: number }) => {
    const at = pos ?? freePlace(d)
    setD({ ...d, placed: [...d.placed, { card: cardId, x: Math.round(at.x / 10) * 10, y: Math.round(at.y / 10) * 10, kind: null, tech: '' }] })
    setSelected(cardId)
  }
  const patchEl = (cardId: string, patch: Partial<DiagramState['placed'][number]>) =>
    setD({ ...d, placed: d.placed.map((p) => (p.card === cardId ? { ...p, ...patch } : p)) })
  const patchRel = (id: string, patch: Partial<DiagramState['rels'][number]>) =>
    setD({ ...d, rels: d.rels.map((r) => (r.id === id ? { ...r, ...patch } : r)) })
  const remove = () => {
    if (selEl) setD({ placed: d.placed.filter((p) => p !== selEl), rels: d.rels.filter((r) => r.from !== selEl.card && r.to !== selEl.card) })
    else if (selRel) setD({ ...d, rels: d.rels.filter((r) => r !== selRel) })
    setSelected(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if ((e.key === 'Delete' || e.key === 'Backspace') && !['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) remove()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const toggleReference = () => {
    if (mine) {
      setD(mine)
      setMine(null)
    } else {
      setMine(d)
      setD(structuredClone(ex.solution))
    }
    setSelected(null)
  }

  return (
    <>
      <div className="scenario-head">
        <div className="panel lesson">
          <Rich paras={ex.brief} />
          {hints > 0 && (
            <ol className="small">
              {ex.hints.slice(0, hints).map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ol>
          )}
          <div className="row">
            {hints < ex.hints.length && !review.solved && (
              <button onClick={() => setHints(hints + 1)}>
                💡 Подсказка ({hints}/{ex.hints.length})
              </button>
            )}
            {!review.solved && (
              <button className="primary" onClick={() => setChecked(true)}>
                ✔ Проверить диаграмму
              </button>
            )}
            {!viewingRef && <button onClick={toggleReference}>👁 Показать эталон</button>}
            <button
              onClick={() => {
                setD(structuredClone(initial))
                setChecked(false)
                setSelected(null)
              }}
            >
              ↺ Заново
            </button>
          </div>
        </div>
        <div className="panel">
          <h4>Уровень: {LEVEL_INFO[ex.level].title}</h4>
          <p className="small">На этой диаграмме допустимы:</p>
          <ul className="small c4-allowed">
            {LEVEL_INFO[ex.level].allowed.map((k) => (
              <li key={k}>
                <span className={'c4-swatch ' + k} /> <b>{KIND_INFO[k].title}</b> — {KIND_INFO[k].desc}
              </li>
            ))}
          </ul>
          {ex.level !== 'context' && (
            <p className="small muted">У контейнеров, компонентов и межконтейнерных связей указывают технологию.</p>
          )}
        </div>
      </div>

      {viewingRef && (
        <div className="ref-banner">
          👁 Вы смотрите <b>эталонную диаграмму</b> — в зачёт она не идёт.
          <button className="primary" onClick={toggleReference}>
            ↩ Вернуть мою диаграмму
          </button>
        </div>
      )}
      {review.solved && !viewingRef && (
        <div className="panel success lesson" style={{ marginBottom: 12 }}>
          <h3>Разбор</h3>
          <Rich paras={ex.debrief} />
        </div>
      )}
      {showReview && <ReviewPanel review={review} title={viewingRef ? 'Оценка эталона' : 'Проверка диаграммы'} />}

      <div className="builder-grid c4-grid">
        <aside className="panel palette">
          <h4>Кандидаты</h4>
          <p className="small muted">Не все нужны. Перетащите на холст или кликните.</p>
          {unplaced.map((c) => (
            <button
              key={c.id}
              className="palette-item c4-card"
              onClick={() => place(c.id)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(C4_MIME, c.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              title={c.desc}
            >
              <span>
                <b>{c.name}</b>
                <span className="small muted"> — {c.desc}</span>
              </span>
            </button>
          ))}
          {unplaced.length === 0 && <p className="small muted">Все карточки на холсте</p>}
          <p className="small muted">
            Связь — тяните за кружок справа от элемента. Del — удалить выделенное.
          </p>
        </aside>

        <div className="panel canvas-wrap">
          <C4Canvas
            ex={ex}
            diagram={d}
            selected={selected}
            onSelect={setSelected}
            onMove={(cardId, x, y) => patchEl(cardId, { x, y })}
            onConnect={(from, to) => {
              if (d.rels.some((r) => r.from === from && r.to === to)) return
              const id = `u${++uid}`
              setD({ ...d, rels: [...d.rels, { id, from, to, label: '', tech: '' }] })
              setSelected(id)
            }}
            onDropCard={(cardId, x, y) => {
              if (!d.placed.some((p) => p.card === cardId)) place(cardId, { x, y })
            }}
          />
        </div>

        <aside className="panel props">
          <h4>Свойства</h4>
          {!selEl && !selRel && <p className="small muted">Выберите элемент или связь</p>}
          {selEl && (
            <div>
              <p>
                <b>{card(selEl.card).name}</b>
              </p>
              <p className="small muted">{card(selEl.card).desc}</p>
              <label>
                тип элемента
                <select
                  value={selEl.kind ?? ''}
                  onChange={(e) => patchEl(selEl.card, { kind: (e.target.value || null) as C4Kind | null })}
                >
                  <option value="">— выберите —</option>
                  {(Object.keys(KIND_INFO) as C4Kind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_INFO[k].title} — {KIND_INFO[k].short}
                    </option>
                  ))}
                </select>
              </label>
              {selEl.kind && (
                <p className="small muted">{KIND_INFO[selEl.kind].desc}</p>
              )}
              {(needsTech(ex.level, selEl.kind) || selEl.tech) && (
                <label>
                  технология
                  <input
                    type="text"
                    placeholder="например, Kotlin, Spring Boot"
                    value={selEl.tech}
                    onChange={(e) => patchEl(selEl.card, { tech: e.target.value })}
                  />
                </label>
              )}
              <button onClick={remove}>Убрать с диаграммы</button>
            </div>
          )}
          {selRel && (
            <div>
              <p>
                <b>{card(selRel.from).name}</b> → <b>{card(selRel.to).name}</b>
              </p>
              <label>
                что происходит
                <input
                  type="text"
                  autoFocus
                  placeholder="например, списывает оплату"
                  value={selRel.label}
                  onChange={(e) => patchRel(selRel.id, { label: e.target.value })}
                />
              </label>
              {ex.level !== 'context' && (
                <label>
                  протокол / технология
                  <input
                    type="text"
                    placeholder="например, JSON/HTTPS"
                    value={selRel.tech}
                    onChange={(e) => patchRel(selRel.id, { tech: e.target.value })}
                  />
                </label>
              )}
              <div className="row">
                <button onClick={() => patchRel(selRel.id, { from: selRel.to, to: selRel.from })}>⇄ Развернуть</button>
                <button onClick={remove}>Удалить связь</button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </>
  )
}
