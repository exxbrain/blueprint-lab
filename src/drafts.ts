import { useEffect, useRef } from 'react'
import { lang } from './i18n'

/**
 * Черновики задач: то, что игрок собрал на схеме, переживает случайную перезагрузку страницы.
 *
 * Черновик лежит в localStorage под ключом задачи. К нему приложена подпись старта задачи:
 * если задачу с тех пор поменяли (обновление игры), старый черновик к ней не подходит и не подхватывается.
 * Где в черновике есть тексты игры (подписи блоков, названия контекстов, журнал), в подпись входит и язык:
 * после смены языка задача начинается заново, как и до черновиков, — иначе на экране смешались бы два языка.
 */
const PREFIX = 'blueprint-lab-draft:'
/** Меняется, если меняется формат самих черновиков */
const VERSION = 1

interface Stored<T> {
  v: number
  sig: string
  work: T
}

/**
 * Черновик задачи, если он есть, задача с тех пор не менялась и черновик по форме годится (valid):
 * испорченный черновик не должен ронять страницу — тогда задача просто начинается с начала.
 */
export function loadDraft<T>(key: string, sig: string, valid: (w: T) => boolean = () => true): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return undefined
    const d = JSON.parse(raw) as Stored<T>
    return d.v === VERSION && d.sig === sig && d.work != null && valid(d.work) ? d.work : undefined
  } catch {
    return undefined
  }
}

/** Удалить все черновики (сброс прогресса: решённый черновик иначе снова засчитал бы задачу) */
export function clearDrafts() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k)
  } catch {
    // хранилище недоступно — и черновиков в нём нет
  }
}

function write(key: string, sig: string, work: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ v: VERSION, sig, work } satisfies Stored<unknown>))
  } catch {
    // хранилище переполнено или недоступно (приватный режим) — работа просто не переживёт перезагрузку
  }
}

/**
 * Сохранять работу игрока при каждом её изменении. Пишет с задержкой (перетаскивание блока меняет схему
 * на каждом движении), а перед уходом со страницы и при закрытии задачи — сразу.
 * work — то, что собрал игрок; пока он смотрит эталон, сюда передают его собственное решение, а не эталон.
 */
export function useSaveDraft(key: string, sig: string, work: unknown) {
  const latest = useRef({ key, sig, work, dirty: false })
  const first = useRef(true)
  useEffect(() => {
    // первая отрисовка — то, что и так уже сохранено (или старт задачи): писать нечего
    if (first.current) {
      first.current = false
      latest.current = { key, sig, work, dirty: false }
      return
    }
    latest.current = { key, sig, work, dirty: true }
    const t = setTimeout(() => {
      write(key, sig, work)
      latest.current.dirty = false
    }, 300)
    return () => clearTimeout(t)
  }, [key, sig, work])
  useEffect(() => {
    const flush = () => {
      const l = latest.current
      if (l.dirty) write(l.key, l.sig, l.work)
      l.dirty = false
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])
}

/** Подпись старта задачи. withLang — в черновике есть тексты игры на текущем языке */
export function signature(parts: unknown, withLang = false): string {
  const s = JSON.stringify(withLang ? [lang, parts] : parts)
  // короткий хэш (FNV-1a): ключ черновика не раздувает хранилище
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + ':' + s.length
}
