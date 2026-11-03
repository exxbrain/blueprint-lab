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

export function useRoute(): string[] {
  const [hash, setHash] = useState(currentHash)
  useEffect(() => {
    const onChange = () => {
      setHash(currentHash())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean)
}

export function href(...parts: string[]): string {
  return '#/' + parts.join('/')
}
