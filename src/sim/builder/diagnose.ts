/**
 * Динамические подсказки: что прямо сейчас мешает на поле и почему.
 * Описываем симптом и причину по модели — и не называем инструмент, который нужно поставить:
 * «одинаковые чтения повторяются тысячи раз», а не «поставьте кэш».
 */
import { tr } from '../../i18n'
import { KINDS, WORKLOADS, fitOfNode, isExternalApi, isStorage, nodeCost, writeCapacity, type BEdge, type BNode, type Result, type Workload } from './model'

export interface Diagnosis {
  tone: 'bad' | 'warn' | 'ok'
  text: string
  /** Блок, о котором речь — по клику его выделяем */
  nodeId?: string
  /** Чем меньше, тем важнее */
  rank: number
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const rps = (x: number) => (x >= 10000 ? `${Math.round(x / 1000)}k` : x >= 1000 ? `${(x / 1000).toFixed(1)}k` : `${Math.round(x)}`)
const name = (n: BNode) => tr(`«${n.label}»`, `“${n.label}”`, `“${n.label}”`)
/** Подпись блока для фразы: «Клиенты „X“» или «Блок „X“» — так согласуется с любым названием */
const who = (n: BNode) => (n.kind === 'client' ? tr(`Клиенты «${n.label}»`, `Clients “${n.label}”`, `客户端“${n.label}”`) : tr(`Блок «${n.label}»`, `Block “${n.label}”`, `组件“${n.label}”`))
/** Чтения, которые повторяются: одно и то же отдают тысячам */
const REPEATABLE: Workload[] = ['oltp', 'kv', 'search']

export function diagnose(input: {
  nodes: BNode[]
  edges: BEdge[]
  result: Result
  goals?: { text: string; ok: boolean }[]
  budget?: number
}): Diagnosis[] {
  const { nodes, edges, result: r, goals, budget } = input
  const out: Diagnosis[] = []
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const kids = (id: string) => edges.filter((e) => e.from === id).map((e) => byId[e.to]).filter(Boolean)
  const parents = (id: string) => edges.filter((e) => e.to === id).map((e) => byId[e.from]).filter(Boolean)
  const add = (d: Diagnosis) => out.push(d)

  if (r.cycle) {
    add({ tone: 'bad', rank: 0, text: tr('На схеме замкнутый круг связей: запрос бегал бы по нему бесконечно.', 'The diagram has a closed loop: a request would run around it forever.', '架构图中有闭环：请求会在里面无休止地绕圈。') })
    return out
  }

  if (goals?.length && goals.every((g) => g.ok)) return [{ tone: 'ok', rank: 9, text: tr('Все цели выполнены.', 'All goals are met.', '所有目标都已达成。') }]

  // хранение важно, если о нём есть невыполненная цель (по-русски «хран…» — и «сохраняются», и «хранятся»; Storefront — не про хранение), а в свободном режиме — если на поле есть хранилище
  const storageMatters = goals ? goals.some((g) => !g.ok && /хран|persist|\bstor(e|es|ed|ing|age)\b|存储|保存|存放|持久/i.test(g.text)) : nodes.some((n) => isStorage(n.kind) && n.kind !== 'cache')
  /** Узел только за очередью: перегрузка там — норма, о ней скажет рост очереди */
  const behindQueue = (id: string) => {
    const ins = edges.filter((e) => e.to === id)
    return ins.length > 0 && ins.every((e) => r.edges[e.id]?.async)
  }

  // ---- клиенты и обязательные связи
  for (const c of nodes.filter((n) => n.kind === 'client' && (n.rps ?? 0) > 0)) {
    if (!kids(c.id).length) add({ tone: 'bad', rank: 1, nodeId: c.id, text: tr(`${who(c)} ни к чему не подключены — их запросам некуда идти.`, `${who(c)} are not connected to anything: their requests have nowhere to go.`, `${who(c)}没有连接到任何东西：它们的请求无处可去。`) })
    else if (storageMatters && r.persisted[c.id] === false)
      add({
        tone: 'bad',
        rank: 3,
        nodeId: c.id,
        text: tr(
          `Запросы клиентов ${name(c)} («${WORKLOADS[c.workload ?? 'oltp'].short}») не доходят до хранилища, которое умеет такой тип — данные никуда не сохраняются.`,
          `Requests from clients ${name(c)} (“${WORKLOADS[c.workload ?? 'oltp'].short}”) never reach a storage that handles this type, so the data is not stored anywhere.`,
          `客户端${name(c)}的请求（“${WORKLOADS[c.workload ?? 'oltp'].short}”）始终到不了能处理这种类型的存储，所以数据没有保存到任何地方。`,
        ),
      })
  }
  if (!r.fanoutDelivered) {
    const at = r.fanoutLossAt && byId[r.fanoutLossAt.nodeId]
    add(
      at && r.fanoutLossAt?.overload
        ? {
            tone: 'bad',
            rank: 3,
            nodeId: at.id,
            text: tr(
              `Не все посты разложены по лентам подписчиков: ${name(at)} не справляется с потоком и теряет часть постов.`,
              `Not every post reaches followers’ feeds: ${name(at)} cannot keep up and loses some posts.`,
              `并非每条帖子都进入了关注者的信息流：${name(at)}处理不过来，丢掉了一部分帖子。`,
            ),
          }
        : at
          ? {
              tone: 'bad',
              rank: 3,
              nodeId: at.id,
              text: tr(
                `Посты не разложены по лентам подписчиков: их путь кончается на ${name(at)}, а он сам не пишет ни в одно хранилище для записей «ключ-значение».`,
                `Posts are not fanned out to followers’ feeds: their path ends at ${name(at)}, which itself writes to no key-value store.`,
                `帖子没有分发到关注者的信息流：它们的路径止于${name(at)}，而它自己并不写入任何键值存储。`,
              ),
            }
          : {
              tone: 'bad',
              rank: 3,
              text: tr(
                'Посты не разложены по лентам подписчиков: путь поста кончается там, где нет хранилища для записей «ключ-значение».',
                'Posts are not fanned out to followers’ feeds: the post’s path ends where there is no key-value store.',
                '帖子没有分发到关注者的信息流：帖子的路径在没有键值存储的地方就结束了。',
              ),
            },
    )
  }

  // ---- тупики и неподходящие хранилища
  for (const n of nodes) {
    const st = r.nodes[n.id]
    if (!st || n.kind === 'client') continue
    if (st.deadEnd) {
      const text =
        n.kind === 'cache'
          ? tr(`${name(n)} пуст: за ним нет источника данных, наполнить его нечем.`, `${name(n)} is empty: there is no data source behind it to fill it.`, `${name(n)}是空的：它后面没有数据源，没有东西可以填充它。`)
          : n.kind === 'cdn'
            ? tr(`${name(n)} пуст: за ним нет хранилища файлов, копировать нечего.`, `${name(n)} is empty: there is no file store behind it to copy from.`, `${name(n)}是空的：它后面没有文件存储，没有东西可以复制。`)
            : n.kind === 'service'
              ? tr(`${name(n)} ни к чему не подключён дальше: данных ему взять неоткуда.`, `${name(n)} is not connected to anything downstream: it has nowhere to get data.`, `${name(n)}的下游没有连接任何东西：它无处获取数据。`)
              : tr(`${name(n)} — тупик: запросам некуда идти дальше.`, `${name(n)} is a dead end: requests have nowhere to go next.`, `${name(n)}是死胡同：请求无处可去。`)
      add({ tone: 'bad', rank: 2, nodeId: n.id, text })
    }
    if (st.unsupported > 0) {
      const ws = (Object.keys(st.vec) as Workload[]).filter((w) => st.vec[w] > 0 && fitOfNode(n, w) === 0).map((w) => `«${WORKLOADS[w].short}»`)
      add({
        tone: 'bad',
        rank: 2,
        nodeId: n.id,
        text: tr(
          `${name(n)} не умеет запросы ${ws.join(', ')}: ${pct(st.unsupported)} таких запросов падают. Нужно хранилище, для которого это родной тип.`,
          `${name(n)} cannot handle ${ws.join(', ')} requests: ${pct(st.unsupported)} of them fail. You need a storage for which this is the native type.`,
          `${name(n)}处理不了 ${ws.join(', ')} 请求：其中 ${pct(st.unsupported)} 失败了。需要一种把这类请求当作原生类型的存储。`,
        ),
      })
    }
  }

  // ---- перегрузка: сначала самые перегруженные
  const inefficient = new Set<string>()
  const hot = nodes
    .filter((n) => n.kind !== 'client' && (r.nodes[n.id]?.util ?? 0) > 1 && !behindQueue(n.id))
    .sort((a, b) => r.nodes[b.id].util - r.nodes[a.id].util)
    .slice(0, 2)
  for (const n of hot) {
    const st = r.nodes[n.id]
    if (isStorage(n.kind) && n.kind !== 'cache') {
      const wUtil = st.writes / writeCapacity(n)
      const writeBound = !KINDS[n.kind].writeScales && st.writes > 0 && wUtil > 1
      if (writeBound) {
        add({
          tone: 'bad',
          rank: 4,
          nodeId: n.id,
          text: tr(
            `${who(n)}: запись (${rps(st.writes)}/с) упирается в primary — ${pct(wUtil)} его ёмкости. Реплики масштабируют только чтение. Можно ли писать быстрее, писать в разные места или не обязательно писать сразу?`,
            `${who(n)}: writes (${rps(st.writes)}/s) hit the primary’s limit at ${pct(wUtil)} of its capacity. Replicas scale reads only. Can you write faster, write to different places, or not write right away?`,
            `${who(n)}：写入（${rps(st.writes)}/s）撞上了 primary 的上限，已达其容量的 ${pct(wUtil)}。副本只能扩展读取。能不能写得更快、写到不同的地方，或者不必立刻写入？`,
          ),
        })
        continue
      }
      // какой тип запросов даёт основную нагрузку
      const share = (Object.keys(st.vec) as Workload[])
        .filter((w) => st.vec[w] > 0 && fitOfNode(n, w) > 0)
        .map((w) => ({ w, load: st.vec[w] / fitOfNode(n, w) }))
        .sort((a, b) => b.load - a.load)
      const totalLoad = share.reduce((s0, x) => s0 + x.load, 0)
      const top = share[0]
      if (top && fitOfNode(n, top.w) < 0.5 && top.load / totalLoad > 0.5) {
        inefficient.add(n.id)
        add({
          tone: 'bad',
          rank: 4,
          nodeId: n.id,
          text: tr(
            `${who(n)} перегружен (${pct(st.util)}): ${pct(top.load / totalLoad)} его нагрузки дают запросы «${WORKLOADS[top.w].short}», которые он выполняет с эффективностью ×${fitOfNode(n, top.w)}. Для такого типа есть хранилище, которое считает его родным.`,
            `${who(n)} is overloaded (${pct(st.util)}): ${pct(top.load / totalLoad)} of its load comes from “${WORKLOADS[top.w].short}” requests, which it runs at ×${fitOfNode(n, top.w)} efficiency. There is a storage for which this type is native.`,
            `${who(n)}过载（${pct(st.util)}）：其负载的 ${pct(top.load / totalLoad)} 来自“${WORKLOADS[top.w].short}”请求，而它处理这类请求的效率只有 ×${fitOfNode(n, top.w)}。有一种存储把这种类型当作原生类型。`,
          ),
        })
        continue
      }
      const repeatReads = (Object.keys(st.vec) as Workload[]).filter((w) => REPEATABLE.includes(w)).reduce((s0, w) => s0 + st.vec[w], 0) - st.writes
      // кэш рядом: у кого-то из вызывающих есть кэш (cache-aside)
      const shielded = parents(n.id).some((p) => kids(p.id).some((k) => k.kind === 'cache'))
      add({
        tone: 'bad',
        rank: 4,
        nodeId: n.id,
        text:
          repeatReads > st.in * 0.5 && !shielded
            ? tr(
                `${who(n)} перегружен: ${rps(st.in)} запросов в секунду при загрузке ${pct(st.util)}, и большинство — чтения. Многие из них одинаковые — обязательно ли каждый раз доставать ответ из базы?`,
                `${who(n)} is overloaded: ${rps(st.in)} requests per second at ${pct(st.util)} utilization, mostly reads. Many of them are identical; does every one have to fetch the answer from the database?`,
                `${who(n)}过载：每秒 ${rps(st.in)} 个请求，利用率 ${pct(st.util)}，大部分是读取。其中很多请求是一模一样的，难道每一个都得去数据库取答案吗？`,
              )
            : tr(
                `${who(n)} перегружен: загрузка ${pct(st.util)}, часть запросов отбрасывается. Хватает ли ему мощности?`,
                `${who(n)} is overloaded at ${pct(st.util)}, and some requests are dropped. Does it have enough capacity?`,
                `${who(n)}过载，利用率 ${pct(st.util)}，部分请求被丢弃。它的处理能力够吗？`,
              ),
      })
    } else {
      add({
        tone: 'bad',
        rank: 4,
        nodeId: n.id,
        text: tr(
          `${who(n)} перегружен: приходит ${rps(st.in)} rps, а держит около ${rps(st.in / st.util)} — ${pct(st.util)}. Не хватает экземпляров, или каждый запрос слишком тяжёлый?`,
          `${who(n)} is overloaded: ${rps(st.in)} rps arrive while it handles about ${rps(st.in / st.util)}, ${pct(st.util)}. Too few instances, or is each request too heavy?`,
          `${who(n)}过载：到达 ${rps(st.in)} rps，而它只能处理约 ${rps(st.in / st.util)}，利用率 ${pct(st.util)}。是实例太少，还是每个请求都太重？`,
        ),
      })
    }
  }

  // ---- на пределе: ещё не отказывает, но любой пик уронит
  for (const n of nodes) {
    const st = r.nodes[n.id]
    if (!st || n.kind === 'client' || behindQueue(n.id) || st.util <= 0.9 || st.util > 1) continue
    add({
      tone: 'warn',
      rank: 5,
      nodeId: n.id,
      text: tr(
        `${who(n)} на пределе: загрузка ${pct(st.util)}. Пока справляется, но любой пик сверх расчёта его уронит, а задержка уже растёт.`,
        `${who(n)} is at its limit: ${pct(st.util)} utilization. It copes for now, but any unexpected peak will bring it down, and latency is already rising.`,
        `${who(n)}已到极限：利用率 ${pct(st.util)}。目前还撑得住，但任何意料之外的峰值都会把它压垮，而且延迟已经在上升。`,
      ),
    })
  }

  // ---- хранилище не по профилю
  for (const n of nodes.filter((x) => isStorage(x.kind) && x.kind !== 'cache' && !inefficient.has(x.id))) {
    const st = r.nodes[n.id]
    if (!st) continue
    for (const w of Object.keys(st.vec) as Workload[]) {
      const f = fitOfNode(n, w)
      if (st.vec[w] > 0 && f > 0 && f < 0.5)
        add({
          tone: 'warn',
          rank: 5,
          nodeId: n.id,
          text: tr(
            `${name(n)} обрабатывает «${WORKLOADS[w].short}» с эффективностью ×${f}: для такого типа запросов есть хранилище, которое считает его родным.`,
            `${name(n)} handles “${WORKLOADS[w].short}” at ×${f} efficiency; there is a storage for which this request type is native.`,
            `${name(n)}处理“${WORKLOADS[w].short}”的效率只有 ×${f}：有一种存储把这类请求当作原生类型。`,
          ),
        })
    }
  }

  // ---- задержка: кто на пути ответа добавляет больше всего
  const latencyGoalFails = goals?.some((g) => !g.ok && /мс|ms\b|毫秒/.test(g.text))
  for (const c of nodes.filter((n) => n.kind === 'client' && (n.rps ?? 0) > 0)) {
    const cs = r.nodes[c.id]
    if (!cs || (!latencyGoalFails && cs.latency < 300)) continue
    let worst: { n: BNode; own: number } | null = null
    const seen = new Set<string>()
    const walk = (id: string) => {
      if (seen.has(id)) return
      seen.add(id)
      for (const e of edges.filter((x) => x.from === id)) {
        if (r.edges[e.id]?.async) continue
        const k = byId[e.to]
        const ks = r.nodes[e.to]
        if (!k || !ks) continue
        const childMax = Math.max(0, ...edges.filter((x) => x.from === k.id && !r.edges[x.id]?.async).map((x) => r.nodes[x.to]?.latency ?? 0))
        const own = ks.latency - childMax
        if (!worst || own > worst.own) worst = { n: k, own }
        walk(k.id)
      }
    }
    walk(c.id)
    const w = worst as { n: BNode; own: number } | null
    if (!w || w.own < 15) continue
    const ext = isExternalApi(w.n)
    add({
      tone: 'warn',
      rank: 6,
      nodeId: w.n.id,
      text: ext
        ? tr(
            `${who(c)} ждут ответа ${Math.round(cs.latency)} мс: ${name(w.n)} — медленный внешний вызов прямо на пути ответа. Обязательно ли клиенту ждать его результата?`,
            `${who(c)} wait ${Math.round(cs.latency)} ms for a response: ${name(w.n)} is a slow external call right on the response path. Does the client really have to wait for its result?`,
            `${who(c)}要等 ${Math.round(cs.latency)} ms 才能拿到响应：${name(w.n)}是一个缓慢的外部调用，正好位于响应路径上。客户端真的必须等它的结果吗？`,
          )
        : tr(
            `${who(c)} ждут ответа ${Math.round(cs.latency)} мс, больше всего добавляет ${name(w.n)} (~${Math.round(w.own)} мс${(r.nodes[w.n.id]?.util ?? 0) > 0.8 ? `, загрузка ${pct(r.nodes[w.n.id].util)}` : ''}).`,
            `${who(c)} wait ${Math.round(cs.latency)} ms for a response; ${name(w.n)} adds the most (~${Math.round(w.own)} ms${(r.nodes[w.n.id]?.util ?? 0) > 0.8 ? `, ${pct(r.nodes[w.n.id].util)} utilization` : ''}).`,
            `${who(c)}要等 ${Math.round(cs.latency)} ms 才能拿到响应，其中${name(w.n)}增加的延迟最多（约 ${Math.round(w.own)} ms${(r.nodes[w.n.id]?.util ?? 0) > 0.8 ? `，利用率 ${pct(r.nodes[w.n.id].util)}` : ''}）。`,
          ),
    })
  }

  // ---- асинхронная обработка не успевает
  for (const n of nodes.filter((x) => (r.nodes[x.id]?.backlogGrowth ?? 0) >= 1)) {
    const consumers = kids(n.id)
    add({
      tone: 'warn',
      rank: 6,
      nodeId: n.id,
      text: consumers.length
        ? tr(
            `${name(n)} копит ${rps(r.nodes[n.id].backlogGrowth)} необработанных сообщений в секунду: ${consumers.map(name).join(', ')} не успевают за потоком.`,
            `${name(n)} piles up ${rps(r.nodes[n.id].backlogGrowth)} unprocessed messages per second: ${consumers.map(name).join(', ')} cannot keep up.`,
            `${name(n)}每秒积压 ${rps(r.nodes[n.id].backlogGrowth)} 条未处理的消息：${consumers.map(name).join(', ')}跟不上消息的速度。`,
          )
        : tr(`${name(n)} копит сообщения: их никто не забирает.`, `${name(n)} piles up messages: nobody consumes them.`, `${name(n)}在积压消息：没有人取走它们。`),
    })
  }

  // ---- бюджет
  if (budget !== undefined && r.cost > budget) {
    const top = [...nodes].sort((a, b) => nodeCost(b) - nodeCost(a)).slice(0, 2)
    add({
      tone: 'warn',
      rank: 7,
      nodeId: top[0]?.id,
      text: tr(
        `Перерасход $${r.cost - budget} в месяц. Дороже всего: ${top.map((n) => `${name(n)} ($${nodeCost(n)})`).join(', ')}. Всё ли там нужно в таком количестве?`,
        `Over budget by $${r.cost - budget} a month. Most expensive: ${top.map((n) => `${name(n)} ($${nodeCost(n)})`).join(', ')}. Is all of that needed at this size?`,
        `每月超出预算 $${r.cost - budget}。最贵的是：${top.map((n) => `${name(n)} ($${nodeCost(n)})`).join(', ')}。这些真的都需要这么大的规模吗？`,
      ),
    })
  }

  // ---- цели, о которых модель не сказала ничего конкретного
  if (!out.length && goals?.length) {
    const left = goals.filter((g) => !g.ok)
    if (left.length) add({ tone: 'warn', rank: 8, text: tr(`Ещё не выполнено: ${left[0].text}.`, `Not met yet: ${left[0].text}.`, `尚未达成：${left[0].text}。`) })
    else add({ tone: 'ok', rank: 9, text: tr('Все цели выполнены.', 'All goals are met.', '所有目标都已达成。') })
  }
  if (!out.length) add({ tone: 'ok', rank: 9, text: tr('Схема справляется: все клиенты получают ответы.', 'The diagram copes: all clients get responses.', '当前方案撑得住：所有客户端都能收到响应。') })

  return out.sort((a, b) => a.rank - b.rank)
}
