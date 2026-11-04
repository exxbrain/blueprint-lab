import { tr } from '../i18n'

/**
 * Плашка «Вы смотрите эталонное решение» с кнопкой «Вернуть моё решение» — для конструктора и распила.
 * На рабочем экране телефона она лежит поверх схемы, поэтому там короткая, в одну строку и непрозрачная.
 */
export function RefBanner({ compact, onBack }: { compact: boolean; onBack: () => void }) {
  return (
    <div className={'ref-banner' + (compact ? ' compact' : '')}>
      {compact ? (
        <span className="ref-banner-text">👁 {tr('Эталон — не в зачёт', 'Reference — not counted', '参考答案，不计入进度')}</span>
      ) : (
        tr(
          <>
            👁 Вы смотрите <b>эталонное решение</b> — в зачёт оно не идёт.
          </>,
          <>
            👁 You are viewing the <b>reference solution</b>; it does not count toward your progress.
          </>,
          <>
            👁 你正在查看<b>参考答案</b>，它不计入你的进度。
          </>,
        )
      )}
      <button className="primary" onClick={onBack}>
        ↩ {compact ? tr('Моё решение', 'My solution', '我的方案') : tr('Вернуть моё решение', 'Back to my solution', '回到我的方案')}
      </button>
    </div>
  )
}
