import { tr } from '../i18n'

/**
 * Плашка «Вы смотрите эталон» с кнопкой возврата — для конструктора, распила и карты контекстов (решение) и C4 (диаграмма).
 * На рабочем экране телефона она лежит поверх схемы, поэтому там короткая, в одну строку и непрозрачная.
 */
export function RefBanner({
  compact,
  onBack,
  diagram = false,
  text,
}: {
  compact: boolean
  onBack: () => void
  diagram?: boolean
  /** Полный текст плашки, если он особый (например, «эталонное разбиение» на карте контекстов) */
  text?: string
}) {
  const full = text
    ? text
    : diagram
    ? tr(
        <>
          👁 Вы смотрите <b>эталонную диаграмму</b> — в зачёт она не идёт.
        </>,
        <>
          👁 You are viewing the <b>reference diagram</b>; it does not count toward your progress.
        </>,
        <>
          👁 你正在查看<b>参考图表</b>，它不计入你的进度。
        </>,
      )
    : tr(
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
  const back = compact
    ? diagram
      ? tr('Моя диаграмма', 'My diagram', '我的图表')
      : tr('Моё решение', 'My solution', '我的方案')
    : diagram
      ? tr('Вернуть мою диаграмму', 'Back to my diagram', '返回我的图表')
      : tr('Вернуть моё решение', 'Back to my solution', '回到我的方案')
  return (
    <div className={'ref-banner' + (compact ? ' compact' : '')}>
      {compact ? <span className="ref-banner-text">👁 {tr('Эталон — не в зачёт', 'Reference — not counted', '参考答案，不计入进度')}</span> : full}
      <button className="primary" onClick={onBack}>
        ↩ {back}
      </button>
    </div>
  )
}
