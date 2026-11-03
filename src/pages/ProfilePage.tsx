import { tr } from '../i18n'
import { LevelTag } from '../components/Level'
import { RANKS, TASKS, TASK_LEVEL, TASK_XP, XP, levelStatus, playerLevel, recommended, taskXp, type TaskLevel } from '../levels'
import { resetProgress, useProgress } from '../progress'

export default function ProfilePage() {
  const p = useProgress()
  const lv = playerLevel(p)
  const next = recommended(p, 6)
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">{tr('Главная', 'Home')}</a> / {tr('Мой уровень', 'My level')}
      </div>

      <section className="panel level-card">
        <div className="level-big">{lv.level}</div>
        <div className="level-info">
          <h1>{lv.rank.title}</h1>
          <p className="muted">{lv.rank.scale}</p>
          <div className="progressbar level-progress">
            <div style={{ width: `${lv.toNext * 100}%` }} />
          </div>
          <div className="small muted">
            {lv.next
              ? tr(
                  `${lv.xp} опыта · до уровня ${lv.level + 1} «${lv.next.title}» осталось ${lv.next.xp - lv.xp}`,
                  `${lv.xp} XP · ${lv.next.xp - lv.xp} XP to level ${lv.level + 1} "${lv.next.title}"`,
                )
              : tr(`${lv.xp} опыта · высший уровень`, `${lv.xp} XP · top level`)}
          </div>
        </div>
      </section>

      <div className="profile-grid">
        <section className="panel">
          <h3>{tr('Лестница уровней', 'Level ladder')}</h3>
          <ol className="rank-ladder">
            {RANKS.map((r, i) => (
              <li key={r.title} className={i + 1 === lv.level ? 'current' : i + 1 < lv.level ? 'passed' : ''}>
                <span className="rank-num">{i + 1}</span>
                <span>
                  <b>{r.title}</b> <span className="muted">· {r.scale}</span>
                </span>
                <span className="small muted">{r.xp} {XP}</span>
              </li>
            ))}
          </ol>
          <h4>{tr('Как растёт опыт', 'How you earn XP')}</h4>
          <ul className="small">
            <li>
              {tr('Задача: ', 'Challenge: ')}
              {([1, 2, 3, 4] as TaskLevel[]).map((l) => `${TASK_LEVEL[l].name} ${TASK_XP[l]}`).join(' · ')} {XP}
            </li>
            <li>{tr('Каждая звезда оценки сверх первой — ещё +25%', 'Each assessment star beyond the first adds +25%')}</li>
            <li>{tr('Урок — 15 опыта, тест — до 40 по лучшему результату', 'Lesson: 15 XP; quiz: up to 40 XP for your best score')}</li>
          </ul>
        </section>

        <section className="panel">
          <h3>{tr('Для вашего уровня', 'For your level')}</h3>
          {next.length ? (
            <ul className="task-list">
              {next.map((t) => (
                <li key={t.key}>
                  <LevelTag level={t.level} />
                  <a href={t.href}>{t.title}</a>
                  <span className="small muted">
                    {t.area} · {TASK_XP[t.level]} {XP}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>{tr('Всё решено. Вы прошли Blueprint Lab целиком!', 'Everything is solved. You have completed Blueprint Lab!')}</p>
          )}
        </section>
      </div>

      <h2>{tr('Задачи по уровням', 'Challenges by level')}</h2>
      <p className="small muted">
        {tr(
          'Уровни открываются по порядку: задачи следующего уровня становятся доступны, когда решены все задачи предыдущего.',
          'Levels open in order: the next level\'s challenges become available once every challenge of the previous level is solved.',
        )}
      </p>
      <div className="level-columns">
        {([1, 2, 3, 4] as TaskLevel[]).map((l) => {
          const list = TASKS.filter((t) => t.level === l)
          const done = list.filter((t) => p.scenarios[t.key]).length
          const st = levelStatus(p)[l - 1]
          return (
            <section key={l} className={'panel' + (st.open ? '' : ' level-closed')}>
              <h3>
                {!st.open && '🔒 '}
                <LevelTag level={l} full /> <span className="small muted">{done}/{list.length}</span>
                {st.passed && <span className="small ok-text"> ✓ {tr('пройден', 'passed')}</span>}
              </h3>
              <div className="progressbar">
                <div style={{ width: `${(done / list.length) * 100}%` }} />
              </div>
              <ul className="task-list compact">
                {list.map((t) => {
                  const solved = p.scenarios[t.key]
                  const stars = p.stars?.[t.key]
                  return (
                    <li key={t.key} className={solved ? 'solved' : ''}>
                      <span>{solved ? '✅' : '○'}</span>
                      <a href={t.href}>{t.title}</a>
                      <span className="small muted">
                        {solved ? (stars ? '★'.repeat(stars) + ' · ' : '') + `${taskXp(t, p)} ${XP}` : t.area}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>

      <p className="small muted" style={{ marginTop: 24 }}>
        <button
          onClick={() => {
            if (confirm(tr('Сбросить весь прогресс и уровень?', 'Reset all progress and your level?'))) resetProgress()
          }}
        >
          {tr('Сбросить прогресс', 'Reset progress')}
        </button>
      </p>
    </div>
  )
}
