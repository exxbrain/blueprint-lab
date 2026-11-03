/**
 * Вход по логину и паролю (HTTP Basic Auth) перед сайтом на Cloudflare Workers.
 *
 * Worker запускается раньше статических файлов (assets.run_worker_first в wrangler.jsonc) — на каждый запрос:
 * страницы, файлы сборки, всё. Без этой настройки Cloudflare отдал бы файлы мимо Worker'а, то есть без пароля.
 * Логин и пароль — секреты Worker'а, в репозитории их нет:
 *   AUTH_USER     — логин без двоеточия (регистр не важен: телефоны любят делать первую букву заглавной);
 *   AUTH_PASSWORD — пароль.
 * Если секреты не заданы, сайт закрыт для всех: лучше не открыть, чем открыть случайно.
 */

export default {
  fetch(request, env) {
    return guard(request, env, () => env.ASSETS.fetch(request))
  },
}

const REALM = 'Blueprint Lab'

/** Заголовки из public/_headers ставятся и здесь: ответы проходят через Worker */
const HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
}

/** Проверка входа; next() — отдать то, что просили (файлы сборки) */
export async function guard(request, env, next) {
  const user = (env.AUTH_USER ?? '').trim().toLowerCase()
  const password = env.AUTH_PASSWORD ?? ''
  if (!user || !password)
    return text(503, 'Вход не настроен: задайте секреты AUTH_USER и AUTH_PASSWORD в настройках Worker’а.')
  // браузер разделяет логин и пароль первым двоеточием — такой логин не совпал бы никогда
  if (user.includes(':')) return text(503, 'Вход не настроен: в логине AUTH_USER не должно быть двоеточия.')

  const given = credentials(request.headers.get('Authorization'))
  // обе проверки считаются всегда — время ответа не подсказывает, что из двух неверно
  const userOk = await same(given?.user.trim().toLowerCase() ?? '', user)
  const passwordOk = await same(given?.pass ?? '', password)
  if (!userOk || !passwordOk) {
    const res = text(401, 'Нужен вход: логин и пароль.')
    res.headers.set('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`)
    return res
  }

  const upstream = await next()
  const res = new Response(upstream.body, upstream)
  for (const [k, v] of Object.entries(HEADERS)) res.headers.set(k, v)
  // страницы за паролем не должны лежать в общих кэшах по дороге
  const cache = res.headers.get('Cache-Control')
  res.headers.set('Cache-Control', cache ? cache.replace(/\bpublic\b/, 'private') : 'private, no-cache')
  return res
}

function text(status, body) {
  return new Response(body, {
    status,
    headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/** «Basic base64(логин:пароль)» → логин и пароль; UTF-8, чтобы пароль мог быть и по-русски */
function credentials(header) {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header ?? '')
  if (!m) return null
  try {
    const raw = new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)))
    const i = raw.indexOf(':')
    return i < 0 ? null : { user: raw.slice(0, i), pass: raw.slice(i + 1) }
  } catch {
    return null
  }
}

/** Сравнение без утечки по времени: сравниваются SHA-256 обеих строк, всегда целиком */
async function same(a, b) {
  const enc = new TextEncoder()
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))))
  const u = new Uint8Array(x)
  const v = new Uint8Array(y)
  let diff = 0
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i]
  return diff === 0
}
