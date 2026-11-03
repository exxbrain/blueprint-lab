import { tr } from '../i18n'
import type { Module } from '../content/types'
import { markLesson, useProgress } from '../progress'
import { href } from '../router'
import { NotFound } from './NotFound'

export function LessonPage({ mod, lessonId }: { mod: Module; lessonId: string }) {
  const progress = useProgress()
  const idx = mod.lessons.findIndex((l) => l.id === lessonId)
  if (idx < 0) return <NotFound />
  const lesson = mod.lessons[idx]
  const prev = mod.lessons[idx - 1]
  const next = mod.lessons[idx + 1]
  const key = `${mod.id}/${lesson.id}`
  const done = progress.lessons[key]
  return (
    <div className="page" style={{ maxWidth: 1300 }}>
      <div className="crumbs">
        <a href="#/">{tr('Карта', 'Map', '地图')}</a> / <a href={href(mod.id)}>{mod.title}</a> / {tr('Урок', 'Lesson', '课程')} {idx + 1}
      </div>
      <h1>{lesson.title}</h1>
      <p className="muted">
        {lesson.summary} · {lesson.minutes} {tr('мин', 'min', '分钟')}
      </p>
      <lesson.Body />
      <div className="lesson-nav">
        {prev ? <a href={href(mod.id, 'lesson', prev.id)}>← {prev.title}</a> : <span />}
        <button
          className="primary"
          onClick={() => {
            markLesson(key)
            window.location.hash = next ? href(mod.id, 'lesson', next.id) : href(mod.id)
          }}
        >
          {done ? tr('✓ Пройдено, ', '✓ Done, ', '✓ 已完成，') : tr('Понятно, ', 'Got it, ', '明白了，')}
          {next ? tr(`дальше: ${next.title} →`, `next: ${next.title} →`, `下一课：${next.title} →`) : tr('к модулю', 'back to module', '返回模块')}
        </button>
      </div>
    </div>
  )
}
