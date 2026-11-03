import { useEffect, useRef, useState } from 'react'
import { C4_EXERCISES } from '../sim/c4/exercises'
import { C4Canvas, C4_MIME } from '../sim/c4/C4Canvas'
import {
  BOUNDARY,
  CANVAS,
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
import { ResultButton, ResultModal, useResultModal } from '../components/ResultModal'
import { HintDock } from '../components/HintDock'
import { ReviewPanel } from '../components/ReviewPanel'
import { markScenario, recordStars, useProgress, cappedStars, useHints, referenceNote } from '../progress'
import { TaskGate, TaskLevelTag } from '../components/Level'
import { tr } from '../i18n'
import { usePhone } from '../components/popover'
import { PanZoomField, Sheet, Tool, Workspace, ZoomMenu, usePanZoom } from '../components/Workspace'

let uid = 1000

export default function C4Page({ id }: { id?: string }) {
  const progress = useProgress()
  // без адреса — первое нерешённое упражнение, выбранное один раз
  const [entry] = useState(() => C4_EXERCISES.find((x) => !progress.scenarios[`c4/${x.id}`]) ?? C4_EXERCISES[0])
  const ex = C4_EXERCISES.find((x) => x.id === id) ?? entry
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">{tr('Карта', 'Map')}</a> / C4 / {LEVEL_INFO[ex.level].title}
      </div>
      <h1>
        🗺️ {ex.title} <TaskLevelTag taskKey={`c4/${ex.id}`} full />
      </h1>
      <TaskGate taskKey={`c4/${ex.id}`}>
        <Exercise key={ex.id} ex={ex} />
      </TaskGate>
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
  const phone = usePhone()
  // условие при входе — модальным окном (на телефоне)
  const [panelOpen, setPanelOpen] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const pz = usePanZoom(CANVAS.w, CANVAS.h, { interactive: '.c4-el, .c4-rel, .bnode-port' })
  // свойства на телефоне — шторкой по касанию элемента (без сдвига); при нажатии и перетаскивании — нет
  const [propsOpen, setPropsOpen] = useState(false)
  const tapStart = useRef<{ id: number; x: number; y: number; n: number } | null>(null)
  const pointersDown = useRef(new Set<number>())
  useEffect(() => {
    // отпустили за пределами поля (над панелью, за окном) или меню браузера забрало указатель — забыть его
    const forget = (e: PointerEvent) => pointersDown.current.delete(e.pointerId)
    const clear = () => pointersDown.current.clear()
    window.addEventListener('pointerup', forget, true)
    window.addEventListener('pointercancel', forget, true)
    window.addEventListener('contextmenu', clear, true)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('pointerup', forget, true)
      window.removeEventListener('pointercancel', forget, true)
      window.removeEventListener('contextmenu', clear, true)
      window.removeEventListener('blur', clear)
    }
  }, [])
  const selectedNow = useRef(selected)
  selectedNow.current = selected
  const hintState = useHints(`c4/${ex.id}`)
  const hints = hintState.used
  const [mine, setMine] = useState<DiagramState | null>(null)
  const viewingRef = mine !== null
  const review = reviewDiagram(ex, d)
  const showReview = checked || review.solved
  const result$ = useResultModal(review.solved, !viewingRef)

  useEffect(() => {
    if (review.solved && !viewingRef) {
      markScenario(`c4/${ex.id}`)
      recordStars(`c4/${ex.id}`, cappedStars(review.stars, hints))
    }
  }, [review.solved, review.stars, viewingRef, ex.id, hints])

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
    // шторка свойств закрыта: следующее нажатие на элемент — снова перетаскивание, а не свойства
    setPropsOpen(false)
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
      hintState.reveal()
      setD(structuredClone(ex.solution))
    }
    setSelected(null)
  }

  const headEl = <>
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
            {hints < ex.hints.length && (
              <button onClick={hintState.take}>
                💡 {tr('Подсказка', 'Hint')} ({Math.min(hints, ex.hints.length)}/{ex.hints.length})
              </button>
            )}
            {review.solved && !viewingRef ? (
              <ResultButton solved onClick={() => result$.setOpen(true)} />
            ) : (
              <button className="primary" onClick={() => setChecked(true)}>
                {tr('✔ Проверить диаграмму', '✔ Check diagram')}
              </button>
            )}
            {!viewingRef && <button onClick={toggleReference} title={referenceNote()}>{tr('👁 Показать эталон', '👁 Show reference')}</button>}
            <button
              onClick={() => {
                setD(structuredClone(initial))
                setChecked(false)
                setSelected(null)
              }}
            >
              {tr('↺ Заново', '↺ Start over')}
            </button>
          </div>
        </div>
        <div className="panel">
          <h4>{tr('Уровень', 'Level')}: {LEVEL_INFO[ex.level].title}</h4>
          <p className="small">{tr('На этой диаграмме допустимы:', 'Allowed on this diagram:')}</p>
          <ul className="small c4-allowed">
            {LEVEL_INFO[ex.level].allowed.map((k) => (
              <li key={k}>
                <span className={'c4-swatch ' + k} /> <b>{KIND_INFO[k].title}</b> — {KIND_INFO[k].desc}
              </li>
            ))}
          </ul>
          {ex.level !== 'context' && (
            <p className="small muted">
              {tr(
                'У контейнеров, компонентов и межконтейнерных связей указывают технологию.',
                'Containers, components and relationships between containers carry a technology.',
              )}
            </p>
          )}
        </div>
      </div>
    </>
  const refEl = <>
      {viewingRef && (
        <div className="ref-banner">
          {tr(
            <>👁 Вы смотрите <b>эталонную диаграмму</b> — в зачёт она не идёт.</>,
            <>👁 You are viewing the <b>reference diagram</b> — it does not count towards your progress.</>,
          )}
          <button className="primary" onClick={toggleReference}>
            {tr('↩ Вернуть мою диаграмму', '↩ Back to my diagram')}
          </button>
        </div>
      )}
    </>
  const resultEl = <>
      <ResultModal open={result$.open} onClose={() => result$.setOpen(false)} progressKey={`c4/${ex.id}`} stars={cappedStars(review.stars, hints)}>
        <ReviewPanel review={review} title={tr('Проверка диаграммы', 'Diagram check')} />
        <div className="lesson">
          <h3>{tr('Разбор', 'Debrief')}</h3>
          <Rich paras={ex.debrief} />
        </div>
      </ResultModal>
    </>
  const reviewEl = <>
      {showReview && !(review.solved && !viewingRef) && <ReviewPanel review={review} title={viewingRef ? tr('Оценка эталона', 'Reference assessment') : tr('Проверка диаграммы', 'Diagram check')} />}
    </>
  const canvasEl = <>
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
    </>
  const propsEl = <>
          {!selEl && !selRel && <p className="small muted">{tr('Выберите элемент или связь', 'Select an element or a relationship')}</p>}
          {selEl && (
            <div>
              <p>
                <b>{card(selEl.card).name}</b>
              </p>
              <p className="small muted">{card(selEl.card).desc}</p>
              <label>
                {tr('тип элемента', 'element type')}
                <select
                  value={selEl.kind ?? ''}
                  onChange={(e) => patchEl(selEl.card, { kind: (e.target.value || null) as C4Kind | null })}
                >
                  <option value="">{tr('— выберите —', '— select —')}</option>
                  {(Object.keys(KIND_INFO) as C4Kind[]).map((k) => (
                    <option key={k} value={k}>
                      {tr(`${KIND_INFO[k].title} — ${KIND_INFO[k].short}`, KIND_INFO[k].title)}
                    </option>
                  ))}
                </select>
              </label>
              {selEl.kind && (
                <p className="small muted">{KIND_INFO[selEl.kind].desc}</p>
              )}
              {(needsTech(ex.level, selEl.kind) || selEl.tech) && (
                <label>
                  {tr('технология', 'technology')}
                  <input
                    type="text"
                    placeholder={tr('например, Kotlin, Spring Boot', 'e.g. Kotlin, Spring Boot')}
                    value={selEl.tech}
                    onChange={(e) => patchEl(selEl.card, { tech: e.target.value })}
                  />
                </label>
              )}
              <button onClick={remove}>{tr('Убрать с диаграммы', 'Remove from diagram')}</button>
            </div>
          )}
          {selRel && (
            <div>
              <p>
                <b>{card(selRel.from).name}</b> → <b>{card(selRel.to).name}</b>
              </p>
              <label>
                {tr('что происходит', 'what happens')}
                <input
                  type="text"
                  autoFocus
                  placeholder={tr('например, списывает оплату', 'e.g. charges the payment')}
                  value={selRel.label}
                  onChange={(e) => patchRel(selRel.id, { label: e.target.value })}
                />
              </label>
              {ex.level !== 'context' && (
                <label>
                  {tr('протокол / технология', 'protocol / technology')}
                  <input
                    type="text"
                    placeholder={tr('например, JSON/HTTPS', 'e.g. JSON/HTTPS')}
                    value={selRel.tech}
                    onChange={(e) => patchRel(selRel.id, { tech: e.target.value })}
                  />
                </label>
              )}
              <div className="row">
                <button onClick={() => patchRel(selRel.id, { from: selRel.to, to: selRel.from })}>{tr('⇄ Развернуть', '⇄ Reverse')}</button>
                <button onClick={remove}>{tr('Удалить связь', 'Delete relationship')}</button>
              </div>
            </div>
          )}
    </>

  // телефон: рабочий экран — диаграмма на весь экран, масштаб пальцами; кандидаты и свойства — шторками
  if (phone)
    return (
      <>
        <Workspace
          title={ex.title}
          panelOpen={panelOpen}
          setPanelOpen={setPanelOpen}
          panel={
            <>
              {headEl}
              {reviewEl}
            </>
          }
          metrics={<span>{tr(`на диаграмме ${d.placed.length} · связей ${d.rels.length}`, `on diagram ${d.placed.length} · links ${d.rels.length}`)}</span>}
          right={
            <>
              <ZoomMenu pz={pz} />
              <HintDock hints={ex.hints} used={hints} take={hintState.take} compact />
              {review.solved && !viewingRef ? (
                <button className="primary ws-btn" onClick={() => result$.setOpen(true)} title={tr('Результат', 'Result')} aria-label={tr('Результат', 'Result')}>
                  ★
                </button>
              ) : (
                <button
                  className="primary ws-check"
                  onClick={() => {
                    setChecked(true)
                    if (!review.solved) setPanelOpen(true)
                  }}
                >
                  ✔
                </button>
              )}
            </>
          }
          bottom={
            <>
              <Tool icon="＋" label={tr('Элемент', 'Element')} on={addOpen} onClick={() => setAddOpen(!addOpen)} badge={unplaced.length || undefined} />
              <Tool icon="↺" label={tr('Заново', 'Restart')} onClick={() => {
                setD(structuredClone(initial))
                setChecked(false)
                setSelected(null)
              }} />
            </>
          }
        >
          <div
            className="ws-tap"
            onPointerDownCapture={(e) => {
              pointersDown.current.add(e.pointerId)
              tapStart.current = { id: e.pointerId, x: e.clientX, y: e.clientY, n: pointersDown.current.size }
            }}
            onPointerUpCapture={(e) => {
              const t = tapStart.current
              tapStart.current = null
              // касание одним пальцем почти без сдвига, и элемент выбран — открыть его свойства
              if (t && t.id === e.pointerId && t.n === 1 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 8)
                // выбор уже обновлён: нажатие — отдельное событие, React отрисовал его до отпускания
                selectedNow.current && setPropsOpen(true)
            }}
            onPointerCancelCapture={() => {
              tapStart.current = null
            }}
          >
            <PanZoomField pz={pz}>{canvasEl}</PanZoomField>
          </div>
          {refEl}
        </Workspace>
        {addOpen && (
          <Sheet title={tr('Кандидаты', 'Candidates')} onClose={() => setAddOpen(false)}>
            <p className="small muted">{tr('Не все нужны. Нажмите — элемент появится на диаграмме.', 'Not all are needed. Tap to place an element on the diagram.')}</p>
            {unplaced.map((c) => (
              <button
                key={c.id}
                className="palette-item c4-card"
                onClick={() => {
                  place(c.id)
                  setAddOpen(false)
                  // поставили элемент — сразу его свойства: тип и технология
                  setPropsOpen(true)
                }}
              >
                <span>
                  <b>{c.name}</b>
                  <span className="small muted"> — {c.desc}</span>
                </span>
              </button>
            ))}
            {unplaced.length === 0 && <p className="small muted">{tr('Все карточки на диаграмме', 'All cards are on the diagram')}</p>}
          </Sheet>
        )}
        {propsOpen && (selEl || selRel) && (
          <Sheet
            title={tr('Свойства', 'Properties')}
            onClose={() => {
              setPropsOpen(false)
              setSelected(null)
            }}
          >
            {propsEl}
          </Sheet>
        )}
        {resultEl}
      </>
    )

  return (
    <>
      {headEl}
      {refEl}
      {resultEl}
      {reviewEl}

      <div className="builder-grid c4-grid">
        <aside className="panel palette">
          <h4>{tr('Кандидаты', 'Candidates')}</h4>
          <p className="small muted">{tr('Не все нужны. Перетащите на холст или кликните.', 'Not all are needed. Drag onto the canvas or click.')}</p>
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
          {unplaced.length === 0 && <p className="small muted">{tr('Все карточки на холсте', 'All cards are on the canvas')}</p>}
          <p className="small muted">
            {tr(
              'Связь — тяните за кружок справа от элемента. Del — удалить выделенное.',
              'Relationship: drag from the dot on the right of an element. Del deletes the selection.',
            )}
          </p>
        </aside>

        <div className="panel canvas-wrap c4-wrap">
          <div className="add-bar">
            <HintDock hints={ex.hints} used={hints} take={hintState.take} />
          </div>
          {canvasEl}
        </div>

        <aside className="panel props">
          <h4>{tr('Свойства', 'Properties')}</h4>
          {propsEl}
        </aside>
      </div>
    </>
  )
}
