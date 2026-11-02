import { grade, type Review, type ReviewItem } from '../review'
import type { BuilderChallenge } from './challenges'
import { KINDS, WORKLOADS, fitOf, isStorage, reaches, simulate, type BEdge, type BNode, type Result, type Workload } from './model'

const HOT = 0.85 // выше — работает на пределе
const IDLE = 0.3 // ниже при нескольких экземплярах — переплата

export function reviewBuilder(c: BuilderChallenge, nodes: BNode[], edges: BEdge[], r: Result, estimated: boolean): Review {
  const items: ReviewItem[] = []
  const ref = simulate(c.solution.nodes, c.solution.edges)

  // цели
  const failed = [
    ...c.paths.filter((p) => !reaches(edges, p.from, p.to)).map((p) => p.text),
    ...c.goals.filter((g) => !g.check(r)).map((g) => g.text),
    ...(r.cost > c.budget ? [`Стоимость ≤ $${c.budget}`] : []),
    ...(c.estimate && !estimated ? ['Прикидка нагрузки'] : []),
  ]
  const goalsOk = failed.length === 0
  if (goalsOk) items.push({ tone: 'ok', text: 'Все цели выполнены' })
  else items.push({ tone: 'bad', text: `Не выполнено: ${failed.join('; ')}` })

  // деньги
  const ratio = r.cost / ref.cost
  if (ratio <= 1) items.push({ tone: 'ok', text: `Стоимость $${r.cost} — не дороже эталона ($${ref.cost})` })
  else if (ratio <= 1.2)
    items.push({ tone: 'ok', text: `Стоимость $${r.cost} — почти как у эталона ($${ref.cost}), разница $${r.cost - ref.cost}` })
  else
    items.push({
      tone: 'warn',
      text: `Эталон дешевле на $${r.cost - ref.cost} ($${ref.cost} против $${r.cost}). Посмотрите на недогруженные блоки ниже`,
    })

  // запас прочности и простой
  for (const n of nodes) {
    if (n.kind === 'client') continue
    const st = r.nodes[n.id]
    if (!st) continue
    if (st.in === 0) {
      items.push({ tone: 'warn', text: `«${n.label}» не получает трафика — лишний блок ($${KINDS[n.kind].cost * n.instances})` })
      continue
    }
    // потребители за очередью могут работать «впритык»: важно лишь, чтобы очередь не росла
    const incoming = edges.filter((e) => e.to === n.id)
    const behindQueue = incoming.length > 0 && incoming.every((e) => r.edges[e.id]?.async)
    if (st.util > HOT && behindQueue)
      items.push({
        tone: 'info',
        text: `«${n.label}» за очередью загружен на ${Math.round(st.util * 100)}% — для асинхронной обработки это нормально, пока очередь не растёт`,
      })
    else if (st.util > 1)
      items.push({
        tone: 'warn',
        text: `«${n.label}» перегружен: нагрузка в ${st.util.toFixed(1)} раза выше мощности — часть запросов отбрасывается`,
      })
    else if (st.util > HOT)
      items.push({
        tone: 'warn',
        text: `«${n.label}» загружен на ${Math.round(st.util * 100)}% — пик сверх расчёта уронит его, а латентность уже растёт`,
      })
    else if (n.instances > 1 && st.util < IDLE) {
      const need = Math.max(1, Math.ceil((st.util * n.instances) / 0.7))
      if (need < n.instances)
        items.push({
          tone: 'warn',
          text: `«${n.label}»: ${n.instances} экз. загружены на ${Math.round(st.util * 100)}% — хватит ${need}, экономия $${KINDS[n.kind].cost * (n.instances - need)}`,
        })
    }
    if (st.deadEnd) items.push({ tone: 'warn', text: `«${n.label}» — тупик: запросам некуда идти дальше` })
    // хранилище не по назначению
    if (isStorage(n.kind)) {
      for (const w of Object.keys(st.vec) as Workload[]) {
        const f = fitOf(n.kind, w)
        if (st.vec[w] > 0 && f > 0 && f < 0.5)
          items.push({
            tone: 'warn',
            text: `«${n.label}» обрабатывает «${WORKLOADS[w].short}» с эффективностью ×${f} — для этого есть специализированное хранилище`,
          })
      }
    }
  }

  // отличия от эталона по типам компонентов
  const kinds = (ns: BNode[]) => new Set(ns.filter((n) => n.kind !== 'client').map((n) => n.kind))
  const mine = kinds(nodes)
  const theirs = kinds(c.solution.nodes)
  const missing = [...theirs].filter((k) => !mine.has(k)).map((k) => KINDS[k].title)
  const extra = [...mine].filter((k) => !theirs.has(k)).map((k) => KINDS[k].title)
  if (missing.length) items.push({ tone: 'info', text: `В эталоне есть: ${missing.join(', ')}` })
  if (extra.length) items.push({ tone: 'info', text: `Эталон обходится без: ${extra.join(', ')}` })
  if (!missing.length && !extra.length) items.push({ tone: 'ok', text: 'Набор компонентов совпадает с эталоном' })

  return grade(goalsOk, ratio, items)
}
