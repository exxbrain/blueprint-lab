import { useEffect, useState } from 'react'
import { tr } from '../i18n'
import { Rich } from './Rich'
import { HintDock } from './HintDock'
import { usePhone } from './popover'
import { Workspace } from './Workspace'
import { ReviewPanel } from './ReviewPanel'
import { ResultButton, ResultModal, useResultModal } from './ResultModal'
import { markScenario, recordStars, cappedStars, useHints, referenceNote } from '../progress'
import {
  CARD_KIND,
  MAP_PATTERNS,
  isRightPattern,
  mapStars,
  misplacedCards,
  partitionSolved,
  referenceState,
  reviewPartition,
  scoreMap,
  type DddCard,
  type DddTask,
  type MapPattern,
  type MapTask,
  type PartitionState,
  type PartitionTask,
} from '../sim/ddd/model'

const CARD_MIME = 'application/x-ddd-card'

/** Этап распила: поиск границ контекстов или карта контекстов */
export function DddStage({ task, progressKey, onNext, nextLabel }: { task: DddTask; progressKey: string; onNext?: () => void; nextLabel?: string }) {
  return task.type === 'partition' ? (
    <PartitionView task={task} progressKey={progressKey} onNext={onNext} nextLabel={nextLabel} />
  ) : (
    <MapView task={task} progressKey={progressKey} onNext={onNext} nextLabel={nextLabel} />
  )
}

let gid = 0
const newGroup = (n: number) => ({ id: `u${++gid}`, name: tr(`Контекст ${n}`, `Context ${n}`, `上下文 ${n}`) })

function Hints({ hints, used, take }: { hints: string[]; used: number; take: () => void }) {
  return (
    <>
      {used > 0 && (
        <ol className="small">
          {hints.slice(0, used).map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ol>
      )}
      {used < hints.length && (
        <button onClick={take}>
          💡 {tr('Подсказка', 'Hint', '提示')} ({Math.min(used, hints.length)}/{hints.length})
        </button>
      )}
    </>
  )
}

function Card({ c, selected, onClick, wrong }: { c: DddCard; selected: boolean; onClick: () => void; wrong?: boolean }) {
  return (
    <button
      className={`ddd-card kind-${c.kind}` + (selected ? ' selected' : '') + (wrong ? ' wrong' : '')}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CARD_MIME, c.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      title={CARD_KIND[c.kind].hint}
    >
      <span className="ddd-kind">{CARD_KIND[c.kind].title}</span>
      {c.name}
    </button>
  )
}

function PartitionView({ task, progressKey, onNext, nextLabel }: { task: PartitionTask; progressKey: string; onNext?: () => void; nextLabel?: string }) {
  const [state, setState] = useState<PartitionState>(() => ({ groups: [newGroup(1), newGroup(2)], place: {} }))
  const [picked, setPicked] = useState<string | null>(null)
  const phone = usePhone()
  // условие при входе — модальным окном (на телефоне)
  const [panelOpen, setPanelOpen] = useState(true)
  const hintState = useHints(progressKey)
  const hints = hintState.used
  const [checked, setChecked] = useState(false)
  const [mine, setMine] = useState<PartitionState | null>(null)
  const viewingRef = mine !== null
  const review = checked ? reviewPartition(task, state, Math.min(hints, task.hints.length)) : null
  const solved = checked && partitionSolved(task, state)
  const result$ = useResultModal(solved, !viewingRef)

  useEffect(() => {
    if (solved && !viewingRef && review) {
      markScenario(progressKey)
      recordStars(progressKey, cappedStars(review.stars, hints))
    }
  }, [solved, viewingRef, review, progressKey, hints])

  const update = (next: PartitionState) => {
    setState(next)
    setChecked(false)
  }
  const placeCard = (cardId: string, groupId: string | null) => {
    const place = { ...state.place }
    if (groupId) place[cardId] = groupId
    else delete place[cardId]
    update({ ...state, place })
    setPicked(null)
  }
  const addGroup = () => {
    const g = newGroup(state.groups.length + 1)
    const next = { ...state, groups: [...state.groups, g] }
    if (picked) next.place = { ...state.place, [picked]: g.id }
    update(next)
    setPicked(null)
  }
  const removeGroup = (id: string) => {
    const place = Object.fromEntries(Object.entries(state.place).filter(([, g]) => g !== id))
    update({ groups: state.groups.filter((g) => g.id !== id), place })
  }
  const toggleRef = () => {
    if (mine) {
      setState(mine)
      setMine(null)
    } else {
      setMine(state)
      hintState.reveal()
      setState(referenceState(task))
    }
    setChecked(false)
    setPicked(null)
  }

  const pool = task.cards.filter((c) => !state.place[c.id])
  // красным — те же стикеры, что названы в проверке
  const wrongIds = new Set<string>(review ? misplacedCards(task, state).map((c) => c.id) : [])
  const dropProps = (groupId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes(CARD_MIME)) e.preventDefault()
    },
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData(CARD_MIME)
      if (id) placeCard(id, groupId)
    },
  })

  const headEl = <>
      <div className="scenario-head">
        <div className="panel lesson">
          <Rich paras={task.brief} />
          <Hints hints={task.hints} used={hints} take={hintState.take} />
        </div>
        <div className={'panel goal' + (solved ? ' success' : '')}>
          <h4>{solved ? tr('✅ Границы найдены!', '✅ Boundaries found!', '✅ 边界找到了！') : tr('🎯 Цели', '🎯 Goals', '🎯 目标')}</h4>
          <ul className="goal-list">
            <li className={pool.length === 0 ? 'ok-text' : ''}>
              {pool.length === 0 ? '✓' : '○'} {tr(`Все карточки разложены (${task.cards.length - pool.length}/${task.cards.length})`, `All cards placed (${task.cards.length - pool.length}/${task.cards.length})`, `所有卡片都已归类（${task.cards.length - pool.length}/${task.cards.length}）`)}
            </li>
            <li className={solved ? 'ok-text' : ''}>
              {solved ? '✓' : '○'} {tr('Границы совпадают с эталоном хотя бы на 80%', 'Boundaries match the reference by at least 80%', '边界与参考答案的吻合度至少达到 80%')}
            </li>
          </ul>
          <div className="small muted">
            {tr('Кнопка «Проверить» покажет точность и ошибки.', 'The Check button shows the accuracy and mistakes.', '点击“检查”按钮即可查看准确度和错误。')}
          </div>
        </div>
      </div>
    </>
  const refEl = <>
      {viewingRef && (
        <div className="ref-banner">
          {tr('👁 Вы смотрите эталонное разбиение — в зачёт оно не идёт.', '👁 You are viewing the reference split; it does not count toward completion.', '👁 你正在查看参考答案的划分方式，它不计入完成进度。')}
          <button className="primary" onClick={toggleRef}>
            ↩ {tr('Вернуть моё решение', 'Back to my solution', '返回我的方案')}
          </button>
        </div>
      )}
    </>
  const actionsEl = <>
      <div className="row review-actions">
        {solved && !viewingRef ? (
          <ResultButton solved onClick={() => result$.setOpen(true)} />
        ) : (
          <button className="primary" disabled={pool.length > 0 || viewingRef} onClick={() => setChecked(true)}>
            ✔ {tr('Проверить', 'Check', '检查')}
          </button>
        )}
        {!viewingRef && <button onClick={toggleRef} title={referenceNote()}>👁 {tr('Показать эталон', 'Show reference', '查看参考答案')}</button>}
        {picked && <span className="small muted">{tr('Выберите контекст для карточки или нажмите на стопку, чтобы вернуть её', 'Pick a context for the card, or tap the pile to put it back', '为卡片选择一个上下文，或点按卡堆把它放回去')}</span>}
      </div>
    </>
  const reviewEl = <>
      {review && !(solved && !viewingRef) && <ReviewPanel review={review} title={tr('Оценка разбиения', 'Split assessment', '划分评估')} />}
    </>
  const resultEl = <>
      <ResultModal
        open={result$.open}
        onClose={() => result$.setOpen(false)}
        progressKey={progressKey}
        stars={review ? cappedStars(review.stars, hints) : 1}
        title={tr('Границы найдены!', 'Boundaries found!', '边界找到了！')}
        next={onNext ? { label: nextLabel ?? tr('Дальше', 'Next', '下一步'), onClick: onNext } : undefined}
      >
        {review && <ReviewPanel review={review} title={tr('Оценка разбиения', 'Split assessment', '划分评估')} />}
        <div className="lesson">
          <h3>{tr('Разбор', 'Debrief', '解析')}</h3>
          <Rich paras={task.debrief} />
        </div>
      </ResultModal>
    </>
  const pickerEl = <>
      {picked && (
        <div className="ddd-picker" role="dialog" aria-label={tr('Куда положить стикер', 'Where to put the sticky', '把便签放到哪里')}>
          <div className="small">
            <b>{task.cards.find((c) => c.id === picked)?.name}</b> → {tr('в контекст:', 'to context:', '放入上下文：')}
          </div>
          <div className="ddd-picker-row">
            {state.groups.map((g) => (
              <button key={g.id} onClick={() => placeCard(picked, g.id)} className={state.place[picked] === g.id ? 'primary' : ''}>
                {g.name}
              </button>
            ))}
            <button onClick={addGroup}>＋ {tr('Новый', 'New', '新建')}</button>
            {state.place[picked] && <button onClick={() => placeCard(picked, null)}>↩ {tr('В стопку', 'Back to pile', '放回卡堆')}</button>}
            <button className="icon" onClick={() => setPicked(null)} title={tr('Отмена', 'Cancel', '取消')}>
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  const groupsEl = <>
        <div className="ddd-groups">
          {state.groups.map((g) => {
            const cards = task.cards.filter((c) => state.place[c.id] === g.id)
            return (
              <div key={g.id} className={'panel ddd-group' + (picked ? ' target' : '')} onClick={() => picked && placeCard(picked, g.id)} {...dropProps(g.id)}>
                <div className="ddd-group-head">
                  <input
                    value={g.name}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setState({ ...state, groups: state.groups.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)) })}
                    aria-label={tr('Название контекста', 'Context name', '上下文名称')}
                  />
                  <span className="small muted">{cards.length}</span>
                  {!cards.length && (
                    <button
                      className="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeGroup(g.id)
                      }}
                      title={tr('Удалить пустой контекст', 'Delete empty context', '删除空的上下文')}
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className="ddd-cards">
                  {cards.map((c) => (
                    <Card key={c.id} c={c} selected={picked === c.id} wrong={wrongIds.has(c.id)} onClick={() => setPicked(picked === c.id ? null : c.id)} />
                  ))}
                  {!cards.length && <p className="small muted">{tr('Перетащите сюда стикеры или выберите стикер и нажмите на контекст', 'Drag stickies here, or select a sticky and tap the context', '把便签拖到这里，或先选中便签再点按这个上下文')}</p>}
                </div>
              </div>
            )
          })}
          <button className="ddd-add" onClick={addGroup}>
            ＋ {picked ? tr('Новый контекст с этим стикером', 'New context with this sticky', '用这张便签新建上下文') : tr('Новый контекст', 'New context', '新建上下文')}
          </button>
        </div>
    </>

  // телефон: рабочий экран — группы на весь экран, стикеры лентой внизу, условие модальным окном
  if (phone)
    return (
      <>
        <Workspace
          title={task.title}
          scroll
          panelOpen={panelOpen}
          setPanelOpen={setPanelOpen}
          panel={
            <>
              {headEl}
              {actionsEl}
              {reviewEl}
            </>
          }
          metrics={<span>{tr(`разложено ${task.cards.length - pool.length}/${task.cards.length}`, `placed ${task.cards.length - pool.length}/${task.cards.length}`, `已归类 ${task.cards.length - pool.length}/${task.cards.length}`)}</span>}
          right={
            <>
              <HintDock hints={task.hints} used={hints} take={hintState.take} compact />
              {solved && !viewingRef ? (
                <button className="primary ws-btn" onClick={() => result$.setOpen(true)} title={tr('Результат', 'Result', '结果')} aria-label={tr('Результат', 'Result', '结果')}>
                  ★
                </button>
              ) : (
                <button
                  className="primary ws-check"
                  disabled={pool.length > 0 || viewingRef}
                  onClick={() => {
                    setChecked(true)
                    // не решено — сразу показать оценку; решено — откроется окно результата
                    if (!partitionSolved(task, state)) setPanelOpen(true)
                  }}
                >
                  ✔ {tr('Проверить', 'Check', '检查')}
                </button>
              )}
            </>
          }
          bottom={
            <div className={'ddd-tray' + (picked && state.place[picked] ? ' target' : '')} onClick={() => picked && placeCard(picked, null)}>
              <span className="ddd-tray-count">
                {tr('Стикеры', 'Stickies', '便签')} {pool.length}
              </span>
              {pool.map((c) => (
                <Card key={c.id} c={c} selected={picked === c.id} onClick={() => setPicked(picked === c.id ? null : c.id)} />
              ))}
              {!pool.length && <span className="small muted">{tr('Все разложены — проверьте', 'All placed: check now', '已全部归类，快来检查吧')}</span>}
            </div>
          }
        >
          {refEl}
          {checked && review && !(solved && !viewingRef) && (
            <button className="ws-review-chip" onClick={() => setPanelOpen(true)}>
              📋 {tr('Оценка готова — открыть', 'Assessment ready: open', '评估已就绪，点击查看')}
            </button>
          )}
          {groupsEl}
          {pickerEl}
        </Workspace>
        {resultEl}
      </>
    )

  return (
    <div className="ddd">
      {headEl}
      {refEl}
      {actionsEl}
      {reviewEl}
      {resultEl}
      {pickerEl}
      <div className="ddd-board">
        <div className={'panel ddd-pool' + (picked && state.place[picked] ? ' target' : '')} onClick={() => picked && placeCard(picked, null)} {...dropProps(null)}>
          <h4>
            {tr('Стикеры', 'Stickies', '便签')} <span className="small muted">{pool.length}</span>
          </h4>
          <div className="ddd-legend small">
            {(Object.keys(CARD_KIND) as (keyof typeof CARD_KIND)[]).map((k) => (
              <span key={k} className={`ddd-dot kind-${k}`} title={CARD_KIND[k].hint}>
                {CARD_KIND[k].title}
              </span>
            ))}
          </div>
          <div className="ddd-cards">
            {pool.map((c) => (
              <Card key={c.id} c={c} selected={picked === c.id} onClick={() => setPicked(picked === c.id ? null : c.id)} />
            ))}
            {!pool.length && <p className="small muted">{tr('Все стикеры разложены', 'All stickies placed', '所有便签都已归类')}</p>}
          </div>
        </div>
        {groupsEl}
      </div>
    </div>
  )
}

function MapView({ task, progressKey, onNext, nextLabel }: { task: MapTask; progressKey: string; onNext?: () => void; nextLabel?: string }) {
  const [answers, setAnswers] = useState<Record<string, MapPattern | undefined>>({})
  const [checked, setChecked] = useState(false)
  const [wrongChecks, setWrongChecks] = useState(0)
  const hintState = useHints(progressKey)
  const hints = hintState.used
  const [showRef, setShowRef] = useState(false)
  const phone = usePhone()
  const [panelOpen, setPanelOpen] = useState(true)
  const sc = scoreMap(task, answers)
  const allAnswered = task.relations.every((r) => answers[r.id])
  const solved = checked && sc.correct === sc.total && !showRef
  const stars = cappedStars(mapStars(wrongChecks, 0), hints)
  const result$ = useResultModal(solved)
  const ctx = (id: string) => task.contexts.find((c) => c.id === id)

  useEffect(() => {
    if (solved) {
      markScenario(progressKey)
      recordStars(progressKey, stars)
    }
  }, [solved, stars, progressKey])

  const check = () => {
    setChecked(true)
    if (scoreMap(task, answers).correct < task.relations.length) setWrongChecks((n) => n + 1)
  }

  const headEl = <>
      <div className="scenario-head">
        <div className="panel lesson">
          <Rich paras={task.brief} />
          <Hints hints={task.hints} used={hints} take={hintState.take} />
        </div>
        <div className={'panel goal' + (solved ? ' success' : '')}>
          <h4>{solved ? tr('✅ Карта готова!', '✅ Map complete!', '✅ 上下文映射图完成！') : tr('🎯 Цели', '🎯 Goals', '🎯 目标')}</h4>
          <ul className="goal-list">
            <li className={allAnswered ? 'ok-text' : ''}>
              {allAnswered ? '✓' : '○'} {tr('Для каждой связи выбран паттерн', 'A pattern is chosen for every relationship', '每条关系都选好了模式')}
            </li>
            <li className={solved ? 'ok-text' : ''}>
              {solved ? '✓' : '○'} {tr('Все паттерны верные', 'All patterns are correct', '所有模式都正确')}
            </li>
          </ul>
          {checked && !solved && (
            <div className="small bad-text">
              {tr(`Верно ${sc.correct} из ${sc.total}. Ошибок при проверке: ${wrongChecks}`, `${sc.correct} of ${sc.total} correct. Failed checks: ${wrongChecks}`, `${sc.total} 个中答对 ${sc.correct} 个。检查未通过次数：${wrongChecks}`)}
            </div>
          )}
          {solved && <div className="review-stars small">{[1, 2, 3].map((i) => <span key={i} className={i <= stars ? 'on' : ''}>★</span>)}</div>}
        </div>
      </div>
    </>
  const patternsEl = <>
      <details className="panel ddd-patterns">
        <summary>{tr('Паттерны Context Map', 'Context Map patterns', '上下文映射图（Context Map）的模式')}</summary>
        <ul className="small">
          {(Object.keys(MAP_PATTERNS) as MapPattern[]).map((p) => (
            <li key={p}>
              <b>{MAP_PATTERNS[p].title}</b> — {MAP_PATTERNS[p].desc}
            </li>
          ))}
        </ul>
      </details>
    </>
  const actionsEl = <>
      <div className="row review-actions">
        {solved ? (
          <ResultButton solved onClick={() => result$.setOpen(true)} />
        ) : (
          <button className="primary" disabled={!allAnswered || showRef} onClick={check}>
            ✔ {tr('Проверить', 'Check', '检查')}
          </button>
        )}
        <button
          title={showRef ? undefined : referenceNote()}
          onClick={() => {
            if (!showRef) hintState.reveal()
            setShowRef(!showRef)
          }}
        >
          {showRef ? '↩ ' + tr('Скрыть ответы', 'Hide answers', '隐藏答案') : '👁 ' + tr('Показать ответы', 'Show answers', '显示答案')}
        </button>
      </div>
    </>
  const resultEl = <>
      <ResultModal
        open={result$.open}
        onClose={() => result$.setOpen(false)}
        progressKey={progressKey}
        stars={stars}
        title={tr('Карта готова!', 'Map complete!', '上下文映射图完成！')}
        next={onNext ? { label: nextLabel ?? tr('Дальше', 'Next', '下一步'), onClick: onNext } : undefined}
      >
        <div className="lesson">
          <h3>{tr('Разбор', 'Debrief', '解析')}</h3>
          <Rich paras={task.debrief} />
        </div>
      </ResultModal>
    </>
  const relationsEl = <>
      <div className="ddd-relations">
        {task.relations.map((r, i) => {
          const a = showRef ? r.answer : answers[r.id]
          const ok = checked && isRightPattern(r, answers[r.id])
          const bad = !showRef && checked && answers[r.id] && !isRightPattern(r, answers[r.id])
          return (
            <div key={r.id} className={'panel ddd-rel' + (ok || showRef ? ' ok' : bad ? ' bad' : '')}>
              <div className="ddd-rel-head">
                <span className="num">{i + 1}</span>
                <b>{ctx(r.upstream)?.name}</b>
                <span className="muted small">upstream</span>
                <span>→</span>
                <b>{ctx(r.downstream)?.name}</b>
                <span className="muted small">downstream</span>
              </div>
              <p>{r.situation}</p>
              <div className="ddd-options">
                {(Object.keys(MAP_PATTERNS) as MapPattern[]).map((p) => (
                  <button
                    key={p}
                    className={a === p ? 'primary' : ''}
                    disabled={showRef}
                    title={MAP_PATTERNS[p].desc}
                    onClick={() => {
                      setAnswers((prev) => ({ ...prev, [r.id]: p }))
                      setChecked(false)
                    }}
                  >
                    {MAP_PATTERNS[p].title}
                  </button>
                ))}
              </div>
              {(ok || showRef) && <div className="small ok-text">✓ {r.why}</div>}
              {bad && <div className="small bad-text">✗ {tr('Не тот паттерн — перечитайте, кто на кого может влиять.', 'Wrong pattern: reread who can influence whom.', '模式不对：再读一遍，看看谁能影响谁。')}</div>}
            </div>
          )
        })}
      </div>
    </>

  // телефон: рабочий экран — связи на весь экран, условие и паттерны модальным окном
  if (phone)
    return (
      <>
        <Workspace
          title={task.title}
          scroll
          panelOpen={panelOpen}
          setPanelOpen={setPanelOpen}
          panel={
            <>
              {headEl}
              {patternsEl}
              {actionsEl}
            </>
          }
          metrics={<span>{tr(`выбрано ${Object.values(answers).filter(Boolean).length}/${task.relations.length}`, `chosen ${Object.values(answers).filter(Boolean).length}/${task.relations.length}`, `已选 ${Object.values(answers).filter(Boolean).length}/${task.relations.length}`)}</span>}
          right={
            <>
              <HintDock hints={task.hints} used={hints} take={hintState.take} compact />
              {solved ? (
                <button className="primary ws-btn" onClick={() => result$.setOpen(true)} title={tr('Результат', 'Result', '结果')} aria-label={tr('Результат', 'Result', '结果')}>
                  ★
                </button>
              ) : (
                <button className="primary ws-check" disabled={!allAnswered || showRef} onClick={check}>
                  ✔ {tr('Проверить', 'Check', '检查')}
                </button>
              )}
            </>
          }
        >
          {checked && !solved && (
            <div className="panel small bad-text ws-note">
              {tr(`Верно ${sc.correct} из ${sc.total} — ошибки отмечены ниже`, `${sc.correct} of ${sc.total} correct; mistakes are marked below`, `${sc.total} 个中答对 ${sc.correct} 个，错误已在下方标出`)}
            </div>
          )}
          {relationsEl}
        </Workspace>
        {resultEl}
      </>
    )

  return (
    <div className="ddd">
      {headEl}
      {patternsEl}
      {actionsEl}
      {resultEl}
      {relationsEl}
    </div>
  )
}
