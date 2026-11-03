import type { CSSProperties } from 'react'
import { tr } from '../i18n'
import { TASKS, TASK_LEVEL, TASK_XP, XP, levelStatus, playerLevel, type Task, type TaskLevel } from '../levels'
import { useProgress, type Progress } from '../progress'
import { href } from '../router'

/** Миры карты: по одному на уровень задач */
const WORLDS: Record<TaskLevel, { title: string; scale: string; icon: string }> = {
  1: { title: tr('Мир 1 · Младший', 'World 1 · Junior', '世界 1 · 初级'), scale: tr('Сервис, база и первый кэш', 'A service, a database and a first cache', '一个服务、一个数据库和第一个缓存'), icon: '🌱' },
  2: { title: tr('Мир 2 · Средний', 'World 2 · Middle', '世界 2 · 中级'), scale: tr('Реплики, очереди, правильные хранилища', 'Replicas, queues, the right storage', '副本、队列和合适的存储'), icon: '⚙️' },
  3: { title: tr('Мир 3 · Старший', 'World 3 · Senior', '世界 3 · 高级'), scale: tr('Микросервисы и распределённые данные', 'Microservices and distributed data', '微服务与分布式数据'), icon: '🛰️' },
  4: { title: tr('Мир 4 · Архитектор', 'World 4 · Architect', '世界 4 · 架构师'), scale: tr('Системы на миллионы пользователей', 'Systems for millions of users', '面向数百万用户的系统'), icon: '🏛️' },
}

/** Значок раздела на кружке уровня */
function areaIcon(t: Task): string {
  if (t.key.startsWith('builder/')) return '🏗️'
  if (/^monolith\/[^/]+\/(contexts|context-map)$/.test(t.key)) return '🧭'
  if (t.key.startsWith('monolith/')) return '🧩'
  if (t.key.startsWith('c4/')) return '🗺️'
  if (t.key.startsWith('kubernetes/')) return '☸️'
  if (t.key.startsWith('data/cap/')) return '⚖️'
  if (t.key.startsWith('data/es/')) return '📜'
  return '📨'
}

/** Порядок задач в мире: разделы чередуются, чтобы путь был разнообразным */
export function worldTasks(level: TaskLevel): Task[] {
  const list = TASKS.filter((t) => t.level === level)
  const byArea = new Map<string, Task[]>()
  for (const t of list) byArea.set(t.area, [...(byArea.get(t.area) ?? []), t])
  const queues = [...byArea.values()]
  const out: Task[] = []
  while (out.length < list.length) for (const q of queues) if (q.length) out.push(q.shift()!)
  return out
}

/** Следующая задача на карте: первая нерешённая в первом открытом непройденном мире */
/**
 * Следующее задание после текущего — по порядку на карте: дальше в этом же мире, потом пропущенные в нём,
 * потом — первое нерешённое в открытых мирах. Так кнопка «Следующее задание» ведёт вперёд, а не в начало карты.
 */
export function nextAfter(p: Progress, key: string): Task | null {
  for (const st of levelStatus(p)) {
    if (!st.open) break
    const list = worldTasks(st.level)
    const i = list.findIndex((t) => t.key === key)
    if (i < 0) continue
    const open = (t: Task) => t.key !== key && !p.scenarios[t.key]
    return list.slice(i + 1).find(open) ?? list.slice(0, i).find(open) ?? nextOther(p, key)
  }
  return nextOther(p, key)
}

function nextOther(p: Progress, key: string): Task | null {
  for (const st of levelStatus(p)) {
    if (!st.open) return null
    const t = worldTasks(st.level).find((x) => x.key !== key && !p.scenarios[x.key])
    if (t) return t
  }
  return null
}

export function nextTask(p: Progress): Task | null {
  for (const st of levelStatus(p)) {
    if (!st.open) return null
    const t = worldTasks(st.level).find((x) => !p.scenarios[x.key])
    if (t) return t
  }
  return null
}

const STEP = 112
const AMP = 150

export function PlayerCard() {
  const p = useProgress()
  const lv = playerLevel(p)
  const next = nextTask(p)
  return (
    <div className="player-card">
      <div className="level-big">{lv.level}</div>
      <div className="level-info">
        <div className="player-rank">
          {lv.rank.title} <span className="muted">· {lv.rank.scale}</span>
        </div>
        <div className="progressbar level-progress">
          <div style={{ width: `${lv.toNext * 100}%` }} />
        </div>
        <div className="small muted">
          {lv.next
            ? tr(`${lv.xp} опыта · до уровня ${lv.level + 1}: ${lv.next.xp - lv.xp}`, `${lv.xp} XP · ${lv.next.xp - lv.xp} XP to level ${lv.level + 1}`, `${lv.xp} XP · 距离等级 ${lv.level + 1} 还差 ${lv.next.xp - lv.xp} XP`)
            : `${lv.xp} ${XP}`}
        </div>
      </div>
      {next && (
        <a className="btn primary big play-btn" href={next.href}>
          ▶ {tr('Продолжить', 'Continue', '继续')}
          <span className="small">{next.title}</span>
        </a>
      )}
    </div>
  )
}

export function LevelMap() {
  const p = useProgress()
  const status = levelStatus(p)
  const next = nextTask(p)
  return (
    <div className="level-map">
      {status.map((st) => {
        const tasks = worldTasks(st.level)
        const w = WORLDS[st.level]
        const height = tasks.length * STEP + 40
        const pts = tasks.map((_, i) => ({ x: 50 + (Math.sin(i * 0.85) * AMP) / 6, y: 40 + i * STEP }))
        // путь в процентах по X: кривая через все кружки
        const d = pts
          .map((pt, i) => {
            if (i === 0) return `M ${pt.x} ${pt.y}`
            const prev = pts[i - 1]
            const my = (prev.y + pt.y) / 2
            return `C ${prev.x} ${my} ${pt.x} ${my} ${pt.x} ${pt.y}`
          })
          .join(' ')
        return (
          <section key={st.level} className={`world world-${st.level}` + (st.open ? '' : ' closed') + (st.passed ? ' passed' : '')}>
            <header className="world-head">
              <span className="world-icon">{st.open ? w.icon : '🔒'}</span>
              <div>
                <h2>{w.title}</h2>
                <div className="muted small">{w.scale}</div>
              </div>
              <div className="world-progress">
                <b>
                  {st.done}/{st.total}
                </b>
                <div className="progressbar">
                  <div style={{ width: `${(st.done / st.total) * 100}%` }} />
                </div>
                {st.passed ? (
                  <span className="small ok-text">✓ {tr('мир пройден', 'world complete', '已通关本世界')}</span>
                ) : !st.open ? (
                  <span className="small muted">
                    {tr(`откроется после мира ${st.level - 1}`, `opens after world ${st.level - 1}`, `通过世界 ${st.level - 1} 后解锁`)}
                  </span>
                ) : null}
              </div>
            </header>
            {!st.open ? (
              <div className="world-locked-row" aria-label={tr(`${tasks.length} закрытых уровней`, `${tasks.length} locked levels`, `${tasks.length} 个未解锁关卡`)}>
                {tasks.map((t) => (
                  <span key={t.key} className="mini-lock" title={t.title}>
                    🔒
                  </span>
                ))}
              </div>
            ) : (
            <div className="world-path" style={{ height }}>
              <svg className="path-line" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
                <path d={d} vectorEffect="non-scaling-stroke" />
              </svg>
              {tasks.map((t, i) => {
                const solved = !!p.scenarios[t.key]
                const stars = solved ? (p.stars?.[t.key] ?? 1) : 0
                const isNext = next?.key === t.key
                const open = st.open || solved
                const cls = 'map-node' + (solved ? ' solved' : open ? ' open' : ' locked') + (isNext ? ' next' : '')
                const left = pts[i].x
                const labelRight = left < 50
                const body = (
                  <>
                    <span className="node-circle">
                      <span className="node-icon">{open ? areaIcon(t) : '🔒'}</span>
                    </span>
                    <span className="node-stars">
                      {[1, 2, 3].map((s) => (
                        <span key={s} className={s <= stars ? 'on' : ''}>
                          ★
                        </span>
                      ))}
                    </span>
                    <span className={'node-label' + (labelRight ? ' right' : ' left')}>
                      <b>{t.title}</b>
                      <span className="small muted">
                        {t.area} · {TASK_XP[t.level]} {XP}
                      </span>
                    </span>
                    {isNext && <span className="node-play">▶ {tr('Играть', 'Play', '开始')}</span>}
                  </>
                )
                return open ? (
                  <a key={t.key} className={cls} href={t.href} style={{ left: `${left}%`, top: pts[i].y, '--x': left } as CSSProperties} title={`${TASK_LEVEL[t.level].name}: ${t.title}`}>
                    {body}
                  </a>
                ) : (
                  <div key={t.key} className={cls} style={{ left: `${left}%`, top: pts[i].y, '--x': left } as CSSProperties}>
                    {body}
                  </div>
                )
              })}
            </div>
            )}
          </section>
        )
      })}
      <p className="small muted map-note">
        {tr(
          'Мир открывается, когда пройдены все уровни предыдущего. Звёзды — оценка решения: чем ближе к эталону и бюджету, тем больше звёзд и опыта.',
          'A world opens once every level of the previous one is complete. Stars rate your solution: the closer to the reference and the budget, the more stars and XP.',
          '上一个世界的所有关卡都完成后，下一个世界才会解锁。星代表对解法的评分：越接近参考答案、越符合预算，获得的星和 XP 就越多。',
        )}{' '}
        <a href={href('profile')}>{tr('Мой уровень →', 'My level →', '我的等级 →')}</a>
      </p>
    </div>
  )
}
