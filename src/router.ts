import { useEffect, useState } from 'react'
import { renamedPath } from './progress'

/** Минимальный hash-роутер: маршруты вида #/kafka/lesson/intro */
/** Текущий адрес; старые адреса переименованных задач заменяются новыми */
function currentHash(): string {
  const moved = renamedPath(window.location.hash.replace(/^#\/?/, '').replace(/\/$/, ''))
  if (!moved) return window.location.hash
  history.replaceState(null, '', '#/' + moved)
  return '#/' + moved
}

/** Адрес без вариантов записи: «», «#», «#/» — это всё карта */
const norm = (h: string) => '#/' + h.replace(/^#\/?/, '').replace(/\/$/, '')
/** Где была прокрутка на каждом адресе и откуда пришли: карта возвращает туда, где вы были */
const scrolls = new Map<string, number>()
let current = ''
let previous = ''
/** Адрес, с которого перешли на текущий */
export const lastRoute = () => previous
/** Прокрутка, с которой ушли с адреса */
export const savedScroll = (h: string) => scrolls.get(norm(h))

export function useRoute(): string[] {
  const [hash, setHash] = useState(() => (current = norm(currentHash())))
  useEffect(() => {
    const onChange = () => {
      scrolls.set(current, window.scrollY)
      previous = current
      current = norm(currentHash())
      setHash(current)
      // прокрутку ставит страница после отрисовки: карта — к заданию, откуда пришли, остальные — в начало
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean)
}

export function href(...parts: string[]): string {
  return '#/' + parts.join('/')
}
