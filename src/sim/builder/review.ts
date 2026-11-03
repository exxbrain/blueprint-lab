import { tr } from '../../i18n'
import { grade, type Review, type ReviewItem } from '../review'
import type { BuilderChallenge } from './challenges'
import { KINDS, WORKLOADS, fitOf, isStorage, nodeCost, reaches, simulate, writeCapacity, type BEdge, type BNode, type Result, type Workload } from './model'

const HOT = 0.85 // выше — работает на пределе
const IDLE = 0.3 // ниже при нескольких экземплярах — переплата

export function reviewBuilder(c: BuilderChallenge, nodes: BNode[], edges: BEdge[], r: Result, estimated: boolean): Review {
  const items: ReviewItem[] = []
  const ref = simulate(c.solution.nodes, c.solution.edges)

  // цели
  const failed = [
    ...c.paths.filter((p) => !reaches(edges, p.from, p.to)).map((p) => p.text),
    ...c.goals.filter((g) => !g.check(r)).map((g) => g.text),
    ...(r.cost > c.budget ? [tr(`Стоимость ≤ $${c.budget}`, `Cost ≤ $${c.budget}`, `成本 ≤ $${c.budget}`)] : []),
    ...(c.estimate && !estimated ? [tr('Прикидка нагрузки', 'Back-of-the-envelope estimate', '负载估算')] : []),
  ]
  const goalsOk = failed.length === 0
  if (goalsOk) items.push({ tone: 'ok', text: tr('Все цели выполнены', 'All goals met', '所有目标均已达成') })
  else items.push({ tone: 'bad', text: tr(`Не выполнено: ${failed.join('; ')}`, `Not met: ${failed.join('; ')}`, `未达成：${failed.join('; ')}`) })

  // деньги
  const ratio = r.cost / ref.cost
  if (ratio <= 1) items.push({ tone: 'ok', text: tr(`Стоимость $${r.cost} — не дороже эталона ($${ref.cost})`, `Cost $${r.cost}, no more than the reference ($${ref.cost})`, `成本 $${r.cost}，不高于参考答案（$${ref.cost}）`) })
  else if (ratio <= 1.2)
    items.push({ tone: 'ok', text: tr(`Стоимость $${r.cost} — почти как у эталона ($${ref.cost}), разница $${r.cost - ref.cost}`, `Cost $${r.cost}, close to the reference ($${ref.cost}), difference $${r.cost - ref.cost}`, `成本 $${r.cost}，接近参考答案（$${ref.cost}），相差 $${r.cost - ref.cost}`) })
  else
    items.push({
      tone: 'warn',
      text: tr(
        `Эталон дешевле на $${r.cost - ref.cost} ($${ref.cost} против $${r.cost}). Посмотрите на недогруженные блоки ниже`,
        `The reference is $${r.cost - ref.cost} cheaper ($${ref.cost} vs $${r.cost}). Check the underutilized blocks below`,
        `参考答案便宜 $${r.cost - ref.cost}（$${ref.cost} 对比 $${r.cost}）。请看看下方利用率偏低的组件`,
      ),
    })

  // запас прочности и простой
  for (const n of nodes) {
    if (n.kind === 'client') continue
    const st = r.nodes[n.id]
    if (!st) continue
    if (st.in === 0) {
      items.push({ tone: 'warn', text: tr(`«${n.label}» не получает трафика — лишний блок ($${nodeCost(n)})`, `“${n.label}” receives no traffic, so it is redundant ($${nodeCost(n)})`, `“${n.label}”没有收到任何流量，是多余的组件（$${nodeCost(n)}）`) })
      continue
    }
    // потребители за очередью могут работать «впритык»: важно лишь, чтобы очередь не росла
    const incoming = edges.filter((e) => e.to === n.id)
    const behindQueue = incoming.length > 0 && incoming.every((e) => r.edges[e.id]?.async)
    if (st.util > 1 && behindQueue)
      items.push({
        tone: 'info',
        text: tr(
          `«${n.label}» разбирает очередь медленнее, чем она пополняется (поток в ${st.util.toFixed(1)} раза выше мощности) — излишек копится в очереди. Для пика это нормально, если такой рост очереди заложен в задачу`,
          `“${n.label}” drains the queue slower than it fills (inflow is ${st.util.toFixed(1)}× capacity), so the excess accumulates in the queue. That is fine for a peak if the task allows for this queue growth`,
          `“${n.label}”消费队列的速度慢于队列增长的速度（流入量是处理能力的 ${st.util.toFixed(1)} 倍），多出的部分会在队列中积压。如果任务允许队列这样增长，那么在峰值期间这是正常的`,
        ),
      })
    else if (st.util > HOT && behindQueue)
      items.push({
        tone: 'info',
        text: tr(
          `«${n.label}» за очередью загружен на ${Math.round(st.util * 100)}% — для асинхронной обработки это нормально, пока очередь не растёт`,
          `“${n.label}” behind the queue is at ${Math.round(st.util * 100)}% load, which is fine for asynchronous processing as long as the queue does not grow`,
          `队列后面的“${n.label}”负载为 ${Math.round(st.util * 100)}%。对异步处理来说，只要队列不持续增长，这就是正常的`,
        ),
      })
    else if (st.util > 1)
      items.push({
        tone: 'warn',
        text: tr(
          `«${n.label}» перегружен: нагрузка в ${st.util.toFixed(1)} раза выше мощности — часть запросов отбрасывается`,
          `“${n.label}” is overloaded: load is ${st.util.toFixed(1)}× capacity, so some requests are dropped`,
          `“${n.label}”过载：负载是处理能力的 ${st.util.toFixed(1)} 倍，部分请求会被丢弃`,
        ),
      })
    else if (st.util > HOT)
      items.push({
        tone: 'warn',
        text: tr(
          `«${n.label}» загружен на ${Math.round(st.util * 100)}% — пик сверх расчёта уронит его, а латентность уже растёт`,
          `“${n.label}” is at ${Math.round(st.util * 100)}% load: an unexpected peak will bring it down, and latency is already rising`,
          `“${n.label}”负载已达 ${Math.round(st.util * 100)}%：一旦出现意外的峰值就会被压垮，而且延迟已经在上升`,
        ),
      })
    else if (n.instances > 1 && st.util < IDLE) {
      const need = Math.max(1, Math.ceil((st.util * n.instances) / 0.7))
      if (need < n.instances)
        items.push({
          tone: 'warn',
          text: tr(
            `«${n.label}»: ${n.instances} экз. загружены на ${Math.round(st.util * 100)}% — хватит ${need}, экономия $${Math.round((nodeCost(n) / n.instances) * (n.instances - need))}`,
            `“${n.label}”: ${n.instances} instances at ${Math.round(st.util * 100)}% load; ${need} would be enough, saving $${Math.round((nodeCost(n) / n.instances) * (n.instances - need))}`,
            `“${n.label}”：${n.instances} 个实例的负载仅为 ${Math.round(st.util * 100)}%；${need} 个就够了，可节省 $${Math.round((nodeCost(n) / n.instances) * (n.instances - need))}`,
          ),
        })
    }
    if (st.deadEnd) items.push({ tone: 'warn', text: tr(`«${n.label}» — тупик: запросам некуда идти дальше`, `“${n.label}” is a dead end: requests have nowhere to go next`, `“${n.label}”是死胡同：请求无处可去`) })
    // запись упирается в primary: реплики тут не помогут
    if (isStorage(n.kind) && !KINDS[n.kind].writeScales && st.writes > 0) {
      const wUtil = st.writes / writeCapacity(n)
      if (wUtil > HOT)
        items.push({
          tone: 'warn',
          text: tr(
            `«${n.label}»: запись упирается в primary (${Math.round(wUtil * 100)}% его ёмкости). Реплики масштабируют только чтение — нужны шарды, машина крупнее или очередь, которая выровняет пик`,
            `“${n.label}”: writes hit the primary’s limit (${Math.round(wUtil * 100)}% of its capacity). Replicas scale reads only; you need shards, a bigger machine or a queue that levels the peak`,
            `“${n.label}”：写入已触及 primary（主节点）的上限（占其容量的 ${Math.round(wUtil * 100)}%）。副本只能扩展读取；你需要分片、更大的机器，或者一个能削平峰值的队列`,
          ),
        })
      else if (n.instances > 1 && st.writes / Math.max(1, st.in) > 0.9)
        items.push({
          tone: 'warn',
          text: tr(
            `«${n.label}»: почти весь поток — запись, а реплики для чтения простаивают ($${Math.round((nodeCost(n) / n.instances) * (n.instances - 1))} впустую)`,
            `“${n.label}”: almost all traffic is writes, so the read replicas sit idle ($${Math.round((nodeCost(n) / n.instances) * (n.instances - 1))} wasted)`,
            `“${n.label}”：几乎所有流量都是写入，读副本处于闲置状态（白白浪费 $${Math.round((nodeCost(n) / n.instances) * (n.instances - 1))}）`,
          ),
        })
    }
    // хранилище не по назначению
    if (isStorage(n.kind)) {
      for (const w of Object.keys(st.vec) as Workload[]) {
        const f = fitOf(n.kind, w)
        if (st.vec[w] > 0 && f > 0 && f < 0.5)
          items.push({
            tone: 'warn',
            text: tr(
              `«${n.label}» обрабатывает «${WORKLOADS[w].short}» с эффективностью ×${f} — для этого есть специализированное хранилище`,
              `“${n.label}” handles “${WORKLOADS[w].short}” at ×${f} efficiency; there is a specialized storage for this`,
              `“${n.label}”处理“${WORKLOADS[w].short}”的效率只有 ×${f}；这类负载有专门的存储`,
            ),
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
  // состав эталона раскрываем только после решения — иначе оценка превращается в подсказку «возьми вот это»
  if (!goalsOk)
    items.push({
      tone: 'info',
      text: tr('Сравнение с эталоном по набору компонентов откроется, когда цели будут выполнены', 'The component comparison with the reference unlocks once the goals are met', '目标全部达成后，即可查看与参考答案的组件对比'),
    })
  else {
    if (missing.length) items.push({ tone: 'info', text: tr(`В эталоне есть: ${missing.join(', ')}`, `The reference also has: ${missing.join(', ')}`, `参考答案中还有：${missing.join(', ')}`) })
    if (extra.length) items.push({ tone: 'info', text: tr(`Эталон обходится без: ${extra.join(', ')}`, `The reference does without: ${extra.join(', ')}`, `参考答案中没有用到：${extra.join(', ')}`) })
    if (!missing.length && !extra.length) items.push({ tone: 'ok', text: tr('Набор компонентов совпадает с эталоном', 'Component set matches the reference', '组件组合与参考答案一致') })
  }

  return grade(goalsOk, ratio, items)
}
