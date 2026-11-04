import type { ReactElement } from 'react'
import type { NodeKind } from './model'

/**
 * Пиктограмма вида компонента в принятой нотации схем (свои рисунки), в квадрате 16×16:
 * сервис — шестиугольник, базы — цилиндр, кэш — цилиндр с молнией, S3 — ведро, очередь — труба с ячейками,
 * CDN — облако, клиент — окно приложения, балансировщик — развилка, шлюз — арка ворот.
 * Линии и точки — цвета currentColor: на холсте это цвет рамки блока, в тексте — цвет текста.
 */
function glyph(kind: NodeKind): ReactElement {
  switch (kind) {
    case 'client':
      return (
        <>
          <rect x={1.5} y={2.5} width={13} height={11} rx={1.5} />
          <path d="M1.5 5.5H14.5" />
        </>
      )
    case 'cdn':
      return <path d="M4.5 12.5H12A2.75 2.75 0 0 0 12.4 7.03 4.25 4.25 0 0 0 4.1 7.6 2.5 2.5 0 0 0 4.5 12.5Z" />
    case 'lb':
      return (
        <>
          <path d="M1.5 8H6M6 8L13 3.5M6 8H13M6 8L13 12.5" />
          <circle cx={6} cy={8} r={1.6} fill="currentColor" stroke="none" />
        </>
      )
    case 'gateway':
      return <path d="M3 14V7.5A5 5 0 0 1 13 7.5V14M1.5 14H14.5M6.5 14V9.5M9.5 14V9.5" />
    case 'service':
      return <path d="M4.5 2.5H11.5L15 8 11.5 13.5H4.5L1 8Z" />
    case 'queue':
      return (
        <>
          <rect x={1} y={4.5} width={14} height={7} rx={1.5} />
          <path d="M5.5 4.5V11.5M9 4.5V11.5M12.5 4.5V11.5" />
        </>
      )
    case 'cache':
      return (
        <>
          <ellipse cx={8} cy={4} rx={5.5} ry={2} />
          <path d="M2.5 4V12A5.5 2 0 0 0 13.5 12V4M9 6.8 6.8 9.8H9.2L7.2 12.6" />
        </>
      )
    case 's3':
      return (
        <>
          <ellipse cx={8} cy={4.5} rx={6} ry={1.8} />
          <path d="M2 4.5 3.6 12.8A4.4 1.6 0 0 0 12.4 12.8L14 4.5" />
        </>
      )
    case 'postgres':
    case 'mongo':
    case 'cassandra':
    case 'clickhouse':
    case 'elastic':
      return (
        <>
          <ellipse cx={8} cy={4} rx={5.5} ry={2} />
          <path d="M2.5 4V12A5.5 2 0 0 0 13.5 12V4M2.5 8A5.5 2 0 0 0 13.5 8" />
        </>
      )
  }
}

const LINE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** Значок вида на холсте конструктора: квадрат 16×16 с левым верхним углом в (x, y), цвета color */
export function KindGlyph({ kind, x, y, color }: { kind: NodeKind; x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x},${y})`} className="bnode-glyph" style={{ color }} {...LINE}>
      {glyph(kind)}
    </g>
  )
}

/** Тот же значок в строке текста (меню «Добавить», окно свойств, трасса запроса) — цвета текста */
export function KindIcon({ kind }: { kind: NodeKind }) {
  return (
    <svg className="kind-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false" {...LINE}>
      {glyph(kind)}
    </svg>
  )
}
