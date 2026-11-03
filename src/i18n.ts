/**
 * Языки: английский (основной), русский, китайский. Язык выбирается один раз при загрузке страницы,
 * смена языка перезагружает страницу. Поэтому tr() можно вызывать где угодно — в компонентах и в данных,
 * которые вычисляются при импорте.
 */

export type Lang = 'ru' | 'en' | 'zh'

/** Языки в меню выбора — названием на самом языке */
export const LANGS: { id: Lang; name: string; short: string }[] = [
  { id: 'en', name: 'English', short: 'EN' },
  { id: 'ru', name: 'Русский', short: 'RU' },
  { id: 'zh', name: '中文', short: '中文' },
]

const KEY = 'blueprint-lab-lang'
const isLang = (v: string | null | undefined): v is Lang => v === 'ru' || v === 'en' || v === 'zh'

function detect(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get('lang')
    if (isLang(q)) return q
    const saved = localStorage.getItem(KEY)
    if (isLang(saved)) return saved
    // основной язык — английский; китайский — если браузер на китайском; русский — явным выбором
    if (navigator.language?.toLowerCase().startsWith('zh')) return 'zh'
    return 'en'
  } catch {
    return 'en'
  }
}

/** Текущий язык; вне браузера (npm run check) — из переменной BLUEPRINT_LANG, по умолчанию русский */
const envLang = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.BLUEPRINT_LANG
export const lang: Lang = typeof window === 'undefined' ? (isLang(envLang) ? envLang : 'ru') : detect()

/**
 * Выбрать вариант текста (или любого значения, включая JSX) по текущему языку.
 * Китайского варианта ещё нет — показывается английский: перевод добавляется частями, ничего не ломая.
 */
export function tr<T>(ru: T, en: T, zh?: T): T {
  return lang === 'ru' ? ru : lang === 'zh' && zh !== undefined ? zh : en
}

export const locale = lang === 'en' ? 'en-US' : lang === 'zh' ? 'zh-CN' : 'ru-RU'

export function setLang(next: Lang) {
  localStorage.setItem(KEY, next)
  const url = new URL(window.location.href)
  url.searchParams.delete('lang')
  window.history.replaceState(null, '', url.toString())
  window.location.reload()
}
