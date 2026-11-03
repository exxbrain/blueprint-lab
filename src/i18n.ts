/**
 * Двуязычность: язык выбирается один раз при загрузке страницы, смена языка перезагружает страницу.
 * Поэтому tr() можно вызывать где угодно — в компонентах и в данных, которые вычисляются при импорте.
 */

export type Lang = 'ru' | 'en'

const KEY = 'blueprint-lab-lang'

function detect(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get('lang')
    if (q === 'ru' || q === 'en') return q
    const saved = localStorage.getItem(KEY)
    if (saved === 'ru' || saved === 'en') return saved
    // основной язык — английский; русский включается явным выбором (?lang=ru или переключатель)
    return 'en'
  } catch {
    return 'en'
  }
}

/** Текущий язык; вне браузера (npm run check) — из переменной BLUEPRINT_LANG, по умолчанию русский */
const envLang = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.BLUEPRINT_LANG
export const lang: Lang = typeof window === 'undefined' ? (envLang === 'en' ? 'en' : 'ru') : detect()

/** Выбрать вариант текста (или любого значения, включая JSX) по текущему языку */
export function tr<T>(ru: T, en: T): T {
  return lang === 'en' ? en : ru
}

export const locale = lang === 'en' ? 'en-US' : 'ru-RU'

export function setLang(next: Lang) {
  localStorage.setItem(KEY, next)
  const url = new URL(window.location.href)
  url.searchParams.delete('lang')
  window.history.replaceState(null, '', url.toString())
  window.location.reload()
}
