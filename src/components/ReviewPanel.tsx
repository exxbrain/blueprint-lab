import { tr } from '../i18n'
import type { ReactNode } from 'react'
import type { Review } from '../sim/review'

const ICON = { ok: '✓', warn: '⚠', bad: '✗', info: 'ℹ' }

/** Оценка решения: звёзды, балл и конкретные замечания */
export function ReviewPanel({ review, title, children }: { review: Review; title: string; children?: ReactNode }) {
  return (
    <div className={'panel review stars-' + review.stars}>
      <div className="review-head">
        <span className="review-stars" aria-label={tr(`${review.stars} из 3`, `${review.stars} of 3`)}>
          {[1, 2, 3].map((i) => (
            <span key={i} className={i <= review.stars ? 'on' : ''}>
              ★
            </span>
          ))}
        </span>
        <div>
          <h4>
            {title}: {review.score} / 100
          </h4>
          <div>{review.verdict}</div>
        </div>
      </div>
      {children}
      <ul className="review-items">
        {review.items.map((i) => (
          <li key={i.text} className={i.tone}>
            <span className="review-icon">{ICON[i.tone]}</span> {i.text}
          </li>
        ))}
      </ul>
    </div>
  )
}
