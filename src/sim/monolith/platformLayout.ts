import type { PatternId } from './patterns'

/** Где на схеме распила стоят узлы платформы: полоса над сервисами, 4 колонки × 2 строки (PatternLayers) */
export const SLOT_X = [575, 728, 881, 1034]
export const SLOT_Y = [8, 54]
export const NODE_W = 146
export const NODE_H = 36

/** Место каждого узла платформы: колонка и строка */
export const NODE_SLOT: Partial<Record<PatternId, { col: number; row: number }>> = {
  accessToken: { col: 0, row: 0 },
  discovery: { col: 1, row: 0 },
  config: { col: 2, row: 0 },
  contracts: { col: 3, row: 0 },
  tracing: { col: 0, row: 1 },
  logs: { col: 1, row: 1 },
  metrics: { col: 2, row: 1 },
  auditLog: { col: 3, row: 1 },
}

/** Где на схеме узел платформы (для подсветки шага пути запроса) */
export function platformRect(id: PatternId, H: number): { x: number; y: number; w: number; h: number } | null {
  const n = NODE_SLOT[id]
  if (n) return { x: SLOT_X[n.col], y: SLOT_Y[n.row], w: NODE_W, h: NODE_H }
  if (id === 'eventSourcing') return { x: 960, y: H - 80, w: 190, h: 30 }
  if (id === 'sagaOrchestrator') return { x: 560, y: H - 80, w: 190, h: 30 }
  return null
}
