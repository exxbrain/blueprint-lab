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
        <a href="#/">Главная</a> / <a href={href(mod.id)}>{mod.title}</a> / Урок {idx + 1}
      </div>
      <h1>{lesson.title}</h1>
      <p className="muted">
        {lesson.summary} · {lesson.minutes} мин
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
          {done ? '✓ Пройдено, ' : 'Понятно, '}
          {next ? `дальше: ${next.title} →` : 'к модулю'}
        </button>
      </div>
    </div>
  )
}
