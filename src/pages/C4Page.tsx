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
import { menuOpen, usePhone } from '../components/popover'
import { RefBanner } from '../components/RefBanner'
import { Sheet, Tool, Workspace } from '../components/Workspace'
import { useViewport, type Rect } from '../components/editor/useViewport'
import { ZoomMenu } from '../components/editor/ZoomMenu'
import { EditorBar, ElementDialog } from '../components/editor/EditorBar'
import { nextId } from '../components/editor/nextId'

export default function C4Page({ id }: { id?: string }) {
  const progress = useProgress()
  // без адреса — первое нерешённое упражнение, выбранное один раз
  const [entry] = useState(() => C4_EXERCISES.find((x) => !progress.scenarios[`c4/${x.id}`]) ?? C4_EXERCISES[0])
  const ex = C4_EXERCISES.find((x) => x.id === id) ?? entry
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">{tr('Карта', 'Map', '地图')}</a> / C4 / {LEVEL_INFO[ex.level].title}
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

/**
 * Свободное место для новой карточки: снаружи границы, если она есть.
 * within — видимая часть холста (масштаб, сдвиг, прокрутка страницы, прилипшая панель): сначала ищем место в ней,
 * чтобы карточка не оказалась под шапкой или за краем экрана
 */
function freePlace(d: DiagramState, within?: Rect, boundary = false): { x: number; y: number } {
  const fits = (s: { x: number; y: number }) => d.placed.every((p) => Math.abs(p.x - s.x) >= EL_W + 6 || Math.abs(p.y - s.y) >= EL_H + 6)
  const onCanvas = (s: { x: number; y: number }) => s.x >= 0 && s.y >= 0 && s.x + EL_W <= CANVAS.w && s.y + EL_H <= CANVAS.h
  const inside = (s: { x: number; y: number }) =>
    !within || (s.x >= within.x && s.y >= within.y && s.x + EL_W <= within.x + within.w && s.y + EL_H <= within.y + within.h)
  // карточка не ложится на линию границы системы: она целиком внутри границы или целиком снаружи
  // (только в упражнениях, где граница на холсте есть)
  const straddles = (s: { x: number; y: number }) => {
    if (!boundary) return false
    const overlaps = s.x < BOUNDARY.x + BOUNDARY.w && s.x + EL_W > BOUNDARY.x && s.y < BOUNDARY.y + BOUNDARY.h && s.y + EL_H > BOUNDARY.y
    const inBox = s.x >= BOUNDARY.x && s.y >= BOUNDARY.y && s.x + EL_W <= BOUNDARY.x + BOUNDARY.w && s.y + EL_H <= BOUNDARY.y + BOUNDARY.h
    return overlaps && !inBox
  }
  const spots: { x: number; y: number }[] = []
  for (let y = 10; y <= 560; y += 90) for (const x of [30, 810]) spots.push({ x, y })
  for (let x = 230; x <= 640; x += 180) spots.push({ x, y: 10 }, { x, y: 560 })
  for (let y = BOUNDARY.y + 20; y < BOUNDARY.y + BOUNDARY.h - EL_H; y += 100)
    for (let x = BOUNDARY.x + 20; x < BOUNDARY.x + BOUNDARY.w - EL_W; x += 180) spots.push({ x, y })
  if (within) {
    // привычные места, если они видны; иначе — мелкая сетка по видимой части, от её середины
    const seen = spots.find((s) => inside(s) && fits(s))
    if (seen) return seen
    const c = { x: within.x + within.w / 2 - EL_W / 2, y: within.y + within.h / 2 - EL_H / 2 }
    const grid: { x: number; y: number }[] = []
    for (let y = Math.ceil(within.y / 10) * 10; y + EL_H <= within.y + within.h; y += 20)
      for (let x = Math.ceil(within.x / 10) * 10; x + EL_W <= within.x + within.w; x += 20) grid.push({ x, y })
    grid.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))
    const near = grid.find((s) => onCanvas(s) && fits(s) && !straddles(s))
    if (near) return near
  }
  return spots.find(fits) ?? { x: 30, y: 10 }
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
  /** Тянут элемент или связь: окно свойств на это время прячется — не загораживает путь */
  const [dragging, setDragging] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  // масштаб и сдвиг — общие для всех редакторов; на телефоне при входе схема вписывается в экран
  const vp = useViewport({
    width: CANVAS.w,
    height: CANVAS.h,
    autoFit: phone,
    selection: () => {
      const el = d.placed.find((x) => x.card === selected)
      const rel = d.rels.find((x) => x.id === selected)
      const ends = el ? [el] : rel ? d.placed.filter((x) => x.card === rel.from || x.card === rel.to) : []
      if (!ends.length) return null
      const x0 = Math.min(...ends.map((x) => x.x)) - 60
      const y0 = Math.min(...ends.map((x) => x.y)) - 60
      return { x: x0, y: y0, w: Math.max(...ends.map((x) => x.x + EL_W)) - x0 + 60, h: Math.max(...ends.map((x) => x.y + EL_H)) - y0 + 60 }
    },
  })
  // свойства на телефоне — шторкой по касанию элемента (без сдвига); при нажатии и перетаскивании — нет
  const [propsOpen, setPropsOpen] = useState(false)
  const tapStart = useRef<{ id: number; x: number; y: number; n: number; onItem: boolean } | null>(null)
  const pointersDown = useRef(new Set<number>())
  useEffect(() => {
    // отпустили за пределами поля (над панелью, за окном) или меню браузера забрало указатель — забыть его
    const forget = (e: PointerEvent) => pointersDown.current.delete(e.pointerId)
    const clear = () => pointersDown.current.clear()
    // контекстное меню не чистим: на Android оно приходит при долгом касании, пока палец ещё прижат
    window.addEventListener('pointerup', forget, true)
    window.addEventListener('pointercancel', forget, true)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('pointerup', forget, true)
      window.removeEventListener('pointercancel', forget, true)
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
    const at = pos ?? freePlace(d, vp.visibleRect(), !!ex.boundary)
    // новую карточку из меню всегда показываем, как конструктор — новый блок (вид и страница — только если нужно)
    if (!pos) vp.show({ x: at.x, y: at.y, w: EL_W, h: EL_H }, cardId)
    setD({ ...d, placed: [...d.placed, { card: cardId, x: Math.round(at.x / 10) * 10, y: Math.round(at.y / 10) * 10, kind: null, tech: '' }] })
    // из меню — сразу свойства (тип и технология); брошенную на холст карточку не выбираем, как блок в конструкторе:
    // окно свойств не выскакивает над местом, куда её только что положили
    setSelected(pos ? null : cardId)
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
      if (e.defaultPrevented || menuOpen()) return
      const t = e.target as HTMLElement
      if ((e.key === 'Delete' || e.key === 'Backspace') && !['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) remove()
      if (e.key === 'Escape') {
        setSelected(null)
        setAddOpen(false)
        setPropsOpen(false)
      }
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
                💡 {tr('Подсказка', 'Hint', '提示')} ({Math.min(hints, ex.hints.length)}/{ex.hints.length})
              </button>
            )}
            {review.solved && !viewingRef ? (
              <ResultButton solved onClick={() => result$.setOpen(true)} />
            ) : (
              <button className="primary" onClick={() => setChecked(true)}>
                {tr('✔ Проверить диаграмму', '✔ Check diagram', '✔ 检查图表')}
              </button>
            )}
            {!viewingRef && <button onClick={toggleReference} title={referenceNote()}>{tr('👁 Показать эталон', '👁 Show reference', '👁 查看参考答案')}</button>}
            <button
              onClick={() => {
                setD(structuredClone(initial))
                setChecked(false)
                setSelected(null)
              }}
            >
              {tr('↺ Заново', '↺ Start over', '↺ 重新开始')}
            </button>
          </div>
        </div>
        <div className="panel">
          <h4>{tr('Уровень', 'Level', '层级')}: {LEVEL_INFO[ex.level].title}</h4>
          <p className="small">{tr('На этой диаграмме допустимы:', 'Allowed on this diagram:', '这张图中允许出现：')}</p>
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
                '容器、组件以及容器之间的关系都要注明技术。',
              )}
            </p>
          )}
        </div>
      </div>
    </>
  const refEl = viewingRef && <RefBanner compact={phone} diagram onBack={toggleReference} />
  const resultEl = <>
      <ResultModal open={result$.open} onClose={() => result$.setOpen(false)} progressKey={`c4/${ex.id}`} stars={cappedStars(review.stars, hints)}>
        <ReviewPanel review={review} title={tr('Проверка диаграммы', 'Diagram check', '图表检查')} />
        <div className="lesson">
          <h3>{tr('Разбор', 'Debrief', '解析')}</h3>
          <Rich paras={ex.debrief} />
        </div>
      </ResultModal>
    </>
  const reviewEl = <>
      {showReview && !(review.solved && !viewingRef) && <ReviewPanel review={review} title={viewingRef ? tr('Оценка эталона', 'Reference assessment', '参考答案评估') : tr('Проверка диаграммы', 'Diagram check', '图表检查')} />}
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
              const id = nextId('u', d.rels)
              setD({ ...d, rels: [...d.rels, { id, from, to, label: '', tech: '' }] })
              setSelected(id)
            }}
            onDropCard={(cardId, x, y) => {
              if (!d.placed.some((p) => p.card === cardId)) place(cardId, { x, y })
              setAddOpen(false)
            }}
            onDragging={setDragging}
            vp={vp}
          />
    </>
  const propsEl = <>
          {!selEl && !selRel && <p className="small muted">{tr('Выберите элемент или связь', 'Select an element or a relationship', '请选择一个元素或一条关系')}</p>}
          {selEl && (
            <div>
              <p>
                <b>{card(selEl.card).name}</b>
              </p>
              <p className="small muted">{card(selEl.card).desc}</p>
              <label>
                {tr('тип элемента', 'element type', '元素类型')}
                <select
                  value={selEl.kind ?? ''}
                  onChange={(e) => patchEl(selEl.card, { kind: (e.target.value || null) as C4Kind | null })}
                >
                  <option value="">{tr('— выберите —', '— select —', '— 请选择 —')}</option>
                  {(Object.keys(KIND_INFO) as C4Kind[]).map((k) => (
                    <option key={k} value={k}>
                      {tr(`${KIND_INFO[k].title} — ${KIND_INFO[k].short}`, KIND_INFO[k].title, `${KIND_INFO[k].title} — ${KIND_INFO[k].short}`)}
                    </option>
                  ))}
                </select>
              </label>
              {selEl.kind && (
                <p className="small muted">{KIND_INFO[selEl.kind].desc}</p>
              )}
              {(needsTech(ex.level, selEl.kind) || selEl.tech) && (
                <label>
                  {tr('технология', 'technology', '技术')}
                  <input
                    type="text"
                    placeholder={tr('например, Kotlin, Spring Boot', 'e.g. Kotlin, Spring Boot', '例如 Kotlin、Spring Boot')}
                    value={selEl.tech}
                    onChange={(e) => patchEl(selEl.card, { tech: e.target.value })}
                  />
                </label>
              )}
              <button onClick={remove}>{tr('Убрать с диаграммы', 'Remove from diagram', '从图表中移除')}</button>
            </div>
          )}
          {selRel && (
            <div>
              <p>
                <b>{card(selRel.from).name}</b> → <b>{card(selRel.to).name}</b>
              </p>
              <label>
                {tr('что происходит', 'what happens', '发生了什么')}
                <input
                  type="text"
                  autoFocus
                  placeholder={tr('например, списывает оплату', 'e.g. charges the payment', '例如：扣款')}
                  value={selRel.label}
                  onChange={(e) => patchRel(selRel.id, { label: e.target.value })}
                />
              </label>
              {ex.level !== 'context' && (
                <label>
                  {tr('протокол / технология', 'protocol / technology', '协议 / 技术')}
                  <input
                    type="text"
                    placeholder={tr('например, JSON/HTTPS', 'e.g. JSON/HTTPS', '例如 JSON/HTTPS')}
                    value={selRel.tech}
                    onChange={(e) => patchRel(selRel.id, { tech: e.target.value })}
                  />
                </label>
              )}
              <div className="row">
                <button onClick={() => patchRel(selRel.id, { from: selRel.to, to: selRel.from })}>{tr('⇄ Развернуть', '⇄ Reverse', '⇄ 反转方向')}</button>
                <button onClick={remove}>{tr('Удалить связь', 'Delete relationship', '删除关系')}</button>
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
          metrics={<span>{tr(`на диаграмме ${d.placed.length} · связей ${d.rels.length}`, `on diagram ${d.placed.length} · links ${d.rels.length}`, `图中元素 ${d.placed.length} · 关系 ${d.rels.length}`)}</span>}
          right={
            <>
              <ZoomMenu vp={vp} />
              <HintDock hints={ex.hints} used={hints} take={hintState.take} compact />
              {review.solved && !viewingRef ? (
                <button className="primary ws-btn" onClick={() => result$.setOpen(true)} title={tr('Результат', 'Result', '结果')} aria-label={tr('Результат', 'Result', '结果')}>
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
              <Tool icon="＋" label={tr('Элемент', 'Element', '元素')} on={addOpen} onClick={() => setAddOpen(!addOpen)} badge={unplaced.length || undefined} />
              <Tool icon="↺" label={tr('Заново', 'Restart', '重来')} onClick={() => {
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
              const t = e.target as Element
              // свойства — только по касанию самого элемента или связи: не по пустому месту, подписи границы или точке связи
              const onItem =
                e.button === 0 && !(e.pointerType === 'mouse' && e.ctrlKey) && !!t.closest?.('.c4-el, .c4-rel') && !t.closest?.('.bnode-port')
              tapStart.current = { id: e.pointerId, x: e.clientX, y: e.clientY, n: pointersDown.current.size, onItem }
            }}
            onPointerUpCapture={(e) => {
              const t = tapStart.current
              tapStart.current = null
              // касание одним пальцем почти без сдвига, и элемент выбран — открыть его свойства
              if (t && t.onItem && t.id === e.pointerId && t.n === 1 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 8)
                // выбор уже обновлён: нажатие — отдельное событие, React отрисовал его до отпускания
                selectedNow.current && setPropsOpen(true)
            }}
            onPointerCancelCapture={() => {
              tapStart.current = null
            }}
          >
            {canvasEl}
          </div>
          {refEl}
        </Workspace>
        {addOpen && (
          <Sheet title={tr('Кандидаты', 'Candidates', '候选元素')} onClose={() => setAddOpen(false)}>
            <p className="small muted">{tr('Не все нужны. Нажмите — элемент появится на диаграмме.', 'Not all are needed. Tap to place an element on the diagram.', '并非全部都需要。点按即可把元素放到图中。')}</p>
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
            {unplaced.length === 0 && <p className="small muted">{tr('Все карточки на диаграмме', 'All cards are on the diagram', '所有卡片都已在图中')}</p>}
          </Sheet>
        )}
        {propsOpen && (selEl || selRel) && (
          <Sheet
            title={tr('Свойства', 'Properties', '属性')}
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

      <div className="panel canvas-wrap c4-wrap" ref={wrapRef}>
        <div className={'canvas-stage' + vp.stage.className} onPointerEnter={vp.stage.onPointerEnter} onPointerLeave={vp.stage.onPointerLeave}>
          <EditorBar
            vp={vp}
            add={{
              label: tr('Добавить элемент', 'Add an element', '添加元素') + (unplaced.length ? ` · ${unplaced.length}` : ''),
              caption: tr('не все кандидаты нужны', 'not every candidate is needed', '并非所有候选都需要'),
              open: addOpen,
              setOpen: setAddOpen,
              menu: (
                <>
                  {unplaced.map((c) => (
                    <button
                      key={c.id}
                      className="palette-item c4-card"
                      onClick={() => {
                        place(c.id)
                        setAddOpen(false)
                      }}
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
                  {unplaced.length === 0 && <p className="small muted">{tr('Все карточки на холсте', 'All cards are on the canvas', '所有卡片都已在画布上')}</p>}
                  <p className="small muted">
                    {tr(
                      'Кликните — элемент появится на холсте, или перетащите его на нужное место. Связь — тяните за кружок справа от элемента. Del — удалить выделенное.',
                      'Click to place an element on the canvas, or drag it where you want. Relationship: drag from the dot on the right of an element. Del deletes the selection.',
                      '点击即可把元素放到画布上，也可以拖到想要的位置。关系：从元素右侧的圆点拖出。按 Del 删除选中内容。',
                    )}
                  </p>
                </>
              ),
            }}
            right={<HintDock hints={ex.hints} used={hints} take={hintState.take} />}
          />
          {canvasEl}
        </div>
        {(selEl || selRel) && selected && !dragging && (
          <ElementDialog
            wrap={wrapRef.current}
            id={selected}
            label={selEl ? card(selEl.card).name : tr('Связь', 'Relationship', '关系')}
            title={tr('Свойства', 'Properties', '属性')}
            keep=".c4-el, .c4-rel, .zoom-tool"
            onClose={() => setSelected(null)}
          >
            {propsEl}
          </ElementDialog>
        )}
      </div>
    </>
  )
}
