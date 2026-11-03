import { useEffect, useRef, useState, type ReactNode } from 'react'
import { tr } from '../i18n'
import { TASK_LEVEL, XP, blockerOf, isTaskOpen, playerLevel, taskLevel, type TaskLevel } from '../levels'
import { useProgress } from '../progress'
import { href } from '../router'

/** Метка уровня задачи: J / M / S / A */
export function LevelTag({ level, full }: { level?: TaskLevel; full?: boolean }) {
  if (!level) return null
  return (
    <span className={`lvl-tag lvl-${level}`} title={tr(`Уровень задачи: ${TASK_LEVEL[level].name}`, `Challenge level: ${TASK_LEVEL[level].name}`)}>
      {full ? TASK_LEVEL[level].name : TASK_LEVEL[level].short}
    </span>
  )
}

export function TaskLevelTag({ taskKey, full }: { taskKey: string; full?: boolean }) {
  return <LevelTag level={taskLevel(taskKey)} full={full} />
}

/** Уровень игрока в шапке */
export function LevelBadge({ active }: { active: boolean }) {
  const p = useProgress()
  const lv = playerLevel(p)
  return (
    <a
      className={'level-badge' + (active ? ' active' : '')}
      href={href('profile')}
      title={`${lv.rank.title} · ${lv.rank.scale}\n${lv.xp} ${XP}${lv.next ? tr(` · до уровня ${lv.level + 1}: ${lv.next.xp - lv.xp}`, ` · ${lv.next.xp - lv.xp} XP to level ${lv.level + 1}`) : ''}`}
    >
      <span className="level-num">{lv.level}</span>
      <span className="level-text">
        <span className="level-title">{lv.rank.title}</span>
        <span className="level-bar">
          <span style={{ width: `${lv.toNext * 100}%` }} />
        </span>
      </span>
    </a>
  )
}

/** Всплывашка: +XP и новый уровень */
export function LevelToasts() {
  const p = useProgress()
  const lv = playerLevel(p)
  const prev = useRef(lv)
  const [toasts, setToasts] = useState<{ id: number; text: string; big?: boolean }[]>([])
  useEffect(() => {
    const before = prev.current
    prev.current = lv
    const gained = lv.xp - before.xp
    if (gained <= 0) return
    const id = Date.now()
    const items: { id: number; text: string; big?: boolean }[] = [{ id, text: `+${gained} ${XP}` }]
    if (lv.level > before.level)
      items.push({
        id: id + 1,
        big: true,
        text: tr(`Новый уровень ${lv.level}: ${lv.rank.title} — ${lv.rank.scale}`, `Level ${lv.level}: ${lv.rank.title}, ${lv.rank.scale}`),
      })
    setToasts((xs) => [...xs, ...items])
    // таймер не сбрасываем при перерисовке: всплывашка живёт своё время
    setTimeout(() => setToasts((xs) => xs.filter((x) => !items.some((i) => i.id === x.id))), lv.level > before.level ? 5000 : 2500)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lv.xp])
  if (!toasts.length) return null
  return (
    <div className="level-toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={'level-toast' + (t.big ? ' big' : '')}>
          {t.big ? '🎉 ' : '⭐ '}
          {t.text}
        </div>
      ))}
    </div>
  )
}

/** Метка вкладки задачи: 🔒, если уровень ещё закрыт, и уровень сложности */
export function TaskMarks({ taskKey }: { taskKey: string }) {
  const p = useProgress()
  return (
    <>
      {!isTaskOpen(taskKey, p) && <span title={tr('Откроется после прохождения предыдущего уровня', 'Opens after you pass the previous level')}>🔒 </span>}
      <TaskLevelTag taskKey={taskKey} />
    </>
  )
}

/** Закрытая задача: вместо неё — что нужно пройти, чтобы её открыть */
export function TaskGate({ taskKey, children }: { taskKey: string; children: ReactNode }) {
  const p = useProgress()
  const b = blockerOf(taskKey, p)
  if (!b) return <>{children}</>
  const own = taskLevel(taskKey)!
  return (
    <div className="panel task-locked">
      <div className="lock-icon">🔒</div>
      <h3>
        {tr('Задача уровня', 'A challenge of level')} <LevelTag level={own} full />
      </h3>
      <p>
        {tr(
          <>
            Задачи открываются по уровням. Сначала пройдите уровень <LevelTag level={b.level} full />: решено{' '}
            <b>
              {b.status.done} из {b.status.total}
            </b>
            .
          </>,
          <>
            Challenges open level by level. First pass the <LevelTag level={b.level} full /> level:{' '}
            <b>
              {b.status.done} of {b.status.total}
            </b>{' '}
            solved.
          </>,
        )}
      </p>
      <div className="progressbar">
        <div style={{ width: `${(b.status.done / b.status.total) * 100}%` }} />
      </div>
      <h4>{tr('Осталось решить', 'Still to solve')}</h4>
      <ul className="task-list">
        {b.left.map((t) => (
          <li key={t.key}>
            <LevelTag level={t.level} />
            <a href={t.href}>{t.title}</a>
            <span className="small muted">{t.area}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
