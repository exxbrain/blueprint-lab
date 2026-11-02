/**
 * Разбор решения: насколько точно собрано относительно целей и эталона.
 * Общий формат для конструктора и распила монолита.
 */

export type ReviewTone = 'ok' | 'warn' | 'bad' | 'info'

export interface ReviewItem {
  tone: ReviewTone
  text: string
}

export interface Review {
  score: number // 0..100
  stars: 1 | 2 | 3
  verdict: string
  items: ReviewItem[]
}

/** Итоговая оценка: цели обязательны, дальше штрафы за переплату и замечания */
export function grade(goalsOk: boolean, costRatio: number, items: ReviewItem[]): Review {
  let score = 100
  if (costRatio > 1.5) score -= 30
  else if (costRatio > 1.2) score -= 15
  else if (costRatio > 1.05) score -= 5
  score -= 8 * items.filter((i) => i.tone === 'warn').length
  if (!goalsOk) score = Math.min(score, 40)
  score = Math.max(0, Math.round(score))
  const stars = score >= 85 ? 3 : score >= 65 ? 2 : 1
  const verdict = !goalsOk
    ? 'Цели пока не выполнены'
    : stars === 3
      ? 'Отличное решение — на уровне эталона'
      : stars === 2
        ? 'Хорошее решение, но есть что улучшить'
        : 'Работает, но заметно дороже или рискованнее эталона'
  return { score, stars, verdict, items }
}
