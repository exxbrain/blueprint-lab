import { useEffect, useState } from 'react'

/** Минимальный hash-роутер: маршруты вида #/kafka/lesson/intro */
export function useRoute(): string[] {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash)
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
