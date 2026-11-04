/**
 * Проверка решаемости: каждая задача должна решаться своим эталоном в своём бюджете
 * и не должна считаться решённой в исходном состоянии.
 * Запуск: npm run check
 */
import { rmSync } from 'node:fs'
import { PROJECTS } from '../src/sim/monolith/projects'
import { computeMetrics, evaluate, initialState, solutionState, stateCost } from '../src/sim/monolith/model'
import { reviewMission } from '../src/sim/monolith/review'
import { recommendedOrder, replay, reviewOrder } from '../src/sim/monolith/order'
import { builderChallenges, estimateOk, sandboxStart } from '../src/sim/builder/challenges'
import { KINDS, WORKLOADS, linkProblem, reaches, simulate, type BEdge, type BNode, type NodeKind, type Workload } from '../src/sim/builder/model'
import { reviewBuilder } from '../src/sim/builder/review'
import { BOARD_H, BOARD_W, NODE_H, NODE_W } from '../src/sim/builder/layout'
import { C4_EXERCISES } from '../src/sim/c4/exercises'
import { CANVAS, EL_H, EL_W, reviewDiagram } from '../src/sim/c4/model'
import { CAP_TASKS, runCap } from '../src/sim/cap/model'
import { STRESS_TESTS } from '../src/sim/monolith/patterns'
import { ES_TASKS } from '../src/sim/es/model'
import { domainOf, emulateRequest, pickClient } from '../src/sim/builder/emulate'
import { DDD_STAGES } from '../src/sim/ddd/tasks'
import { COMPONENT_REF, PATTERN_REF, findRef, refKey } from '../src/content/reference'
import { diagnose } from '../src/sim/builder/diagnose'
import { emulateMono } from '../src/sim/monolith/emulate'
import { K8S_TASKS, runTask } from '../src/sim/k8s/tasks'
import { MAP_PATTERNS, misplacedCards, partitionSolved, referenceState, reviewPartition, scoreMap } from '../src/sim/ddd/model'
// Worker перед сайтом на Cloudflare: вход по логину и паролю
import worker, { guard } from '../worker/index.js'

let failed = 0
// проход упал (ошибка проверки или исключение) — запуск прерван, подписи его проходов больше не понадобятся
process.on('exit', (code) => {
  const run = process.env.BLUEPRINT_RUN
  if (!code || !run) return
  for (const l of ['ru', 'en', 'zh']) rmSync(new URL(`../.check-sig-${run}-${l}.txt`, import.meta.url), { force: true })
})
/** Подпись разбора, не зависящая от языка: сравнивается между проходами ru, en и zh */
const signature: string[] = []
const fail = (msg: string) => {
  failed++
  console.log('  ✗ ' + msg)
}

console.log('Распил монолита')
for (const p of PROJECTS) {
  for (const m of p.missions) {
    const s = solutionState(p, m.solution)
    const cost = stateCost(p, s)
    const e = evaluate(p, s, cost, m.budget)
    console.log(`- ${p.title} / ${m.title}: эталон ${cost} из ${m.budget} млн ₽`)
    if (cost > m.budget) fail(`эталон дороже бюджета`)
    for (const g of m.goals) if (!g.check(e)) fail(`эталон не выполняет цель «${g.text}»`)
    const rv = reviewMission(p, m, s, cost)
    const warns = rv.items.filter((i) => i.tone === 'warn' || i.tone === 'bad')
    if (rv.stars !== 3 || warns.length) fail(`эталон оценён на ${rv.stars}★ (${rv.score}): ${warns.map((w) => w.text).join('; ')}`)
    // рекомендуемый порядок: ни одного сломанного или рискованного спринта, итог = эталон
    const steps = recommendedOrder(p, m)
    const states = replay(p, steps)
    const ord = reviewOrder(p, states, steps.map((x) => x.label))
    const bad = ord.timeline.filter((t) => t.status !== 'ok')
    if (bad.length) fail(`рекомендуемый порядок ломает прод: спринт ${bad[0].sprint} «${bad[0].action}» — ${bad[0].problems[0]}`)
    if (stateCost(p, states[states.length - 1]) !== cost) fail('рекомендуемый порядок приходит не к эталону')
    const ow = ord.review.items.filter((i) => i.tone === 'warn' || i.tone === 'bad')
    if (ord.review.stars !== 3 || ow.length) fail(`порядок оценён на ${ord.review.stars}★: ${ow.map((w) => w.text).join('; ')}`)
    console.log(`  порядок: ${steps.length} спринтов, ${ord.review.score}/100`)
    const start = evaluate(p, initialState(p), 0, m.budget)
    if (m.goals.every((g) => g.check(start))) fail('миссия решена уже в исходном состоянии')
  }
}

// плохой порядок: вынос до фасада, БД отделена раньше, чем чтение переведено на API
{
  const bank = PROJECTS.find((x) => x.id === 'bank')!
  const s0 = initialState(bank)
  const s1 = { ...s0, extracted: { ...s0.extracted, antifraud: true } }
  const s2 = { ...s1, ownDb: { ...s1.ownDb, antifraud: true } }
  const s3 = { ...s2, modes: { 'antifraud-documents': 'api' as const } }
  const s4 = { ...s3, infra: { ...s3.infra, gateway: true } }
  const ord = reviewOrder(bank, [s0, s1, s2, s3, s4], ['вынос', 'своя БД', 'API', 'фасад'])
  const broken = ord.timeline.filter((t) => t.status === 'broken').length
  console.log(`- плохой порядок «Антифрод отдельно»: сломанных спринтов ${broken}, ${ord.review.score}/100, ${ord.review.stars}★`)
  if (broken < 3 || ord.review.stars > 1) fail('плохой порядок оценён слишком мягко')
}

console.log('\nКонструктор архитектуры')
const lockedChanged: string[] = []
for (const c of builderChallenges) {
  const { nodes, edges } = c.solution
  const r = simulate(nodes, edges)
  const lat = Object.fromEntries(nodes.filter((x) => x.kind === 'client').map((x) => [x.label, Math.round(r.nodes[x.id].latency)]))
  console.log(`- ${c.title}: эталон $${r.cost} из $${c.budget}, успех ${(r.clientSuccess * 100).toFixed(2)}%, латентность ${JSON.stringify(lat)}, бэклог ${r.backlogGrowth.toFixed(0)}`)
  if (r.cost > c.budget) fail('эталон дороже бюджета')
  for (const g of c.goals) if (!g.check(r)) fail(`эталон не выполняет цель «${g.text}»`)
  for (const pth of c.paths) if (!reaches(edges, pth.from, pth.to)) fail(`эталон нарушает путь «${pth.text}»`)
  for (const id of c.locked) if (!nodes.some((x) => x.id === id)) fail(`в эталоне нет обязательного узла ${id}`)
  // у заблокированного блока редактор меняет только масштаб (экземпляры, размер, шарды): тип и профиль сервиса — нет,
  // поэтому эталон не может требовать их смены
  for (const id of c.locked) {
    const a = c.nodes.find((x) => x.id === id)
    const b = nodes.find((x) => x.id === id)
    if (!a || !b || a.kind === 'client') continue
    if (a.kind !== b.kind || (a.kind === 'service' && (a.capacity !== b.capacity || a.latency !== b.latency)) || a.hitRatio !== b.hitRatio)
      lockedChanged.push(`${c.id}/${id}`)
  }
  for (const x of c.nodes.filter((x) => x.kind === 'client')) {
    const sx = nodes.find((y) => y.id === x.id)
    if (!sx || sx.rps !== x.rps || sx.workload !== x.workload) fail(`клиент ${x.id} в эталоне отличается от исходного`)
  }
  for (const x of nodes) {
    if ((x.kind === 'cache' || x.kind === 'cdn') && x.hitRatio !== c.hitRatio[x.kind])
      fail(`у ${x.id} доля попаданий ${x.hitRatio}, а в задаче ${c.hitRatio[x.kind]}`)
  }
  if (c.estimate && !estimateOk(c.estimate, c.estimate.answer)) fail('ответ прикидки вне допуска')
  const rv = reviewBuilder(c, nodes, edges, r, true)
  const warns = rv.items.filter((i) => i.tone === 'warn' || i.tone === 'bad')
  if (rv.stars !== 3 || warns.length) fail(`эталон оценён на ${rv.stars}★ (${rv.score}): ${warns.map((w) => w.text).join('; ')}`)
  const start = simulate(c.nodes, c.edges)
  const startOk = c.goals.every((g) => g.check(start)) && c.paths.every((pth) => reaches(c.edges, pth.from, pth.to))
  if (startOk && start.cost <= c.budget) fail('задача решена уже в исходном состоянии')
}
{
  // Известная проблема старых задач: подсказки просят сделать заблокированный сервис лёгким, а выбора профиля
  // у заблокированных блоков нет. Решается отдельно (снять блокировку или показать выбор профиля); новых таких задач быть не должно
  const known = ['catalog-search/s1', 'profiles/s1', 'tickets/s1']
  for (const x of lockedChanged) if (!known.includes(x)) fail(`эталон меняет тип или профиль заблокированного блока ${x}: в редакторе это сделать нельзя`)
  for (const x of known) if (!lockedChanged.includes(x)) fail(`${x} больше не меняет заблокированный блок — уберите его из списка известных`)
  console.log(`- эталоны не меняют тип и профиль заблокированных блоков (известные исключения: ${known.join(', ')})`)
}

// ловушки: обходные пути, которые не должны решать задачи
console.log('\nЛовушки конструктора')
{
  type N = (typeof builderChallenges)[number]['solution']['nodes']
  type E = (typeof builderChallenges)[number]['solution']['edges']
  let traps = 0
  const trap = (id: string, name: string, patch: (n: N, e: E) => [N, E]) => {
    traps++
    const c = builderChallenges.find((x) => x.id === id)!
    const [nodes, edges] = patch(structuredClone(c.solution.nodes), structuredClone(c.solution.edges))
    // ловушка — то, что игрок может собрать: только возможные связи
    const by = Object.fromEntries(nodes.map((x) => [x.id, x]))
    for (const e of edges) {
      const why = linkProblem(by[e.from].kind, by[e.to].kind)
      if (why) fail(`ловушка «${c.title} / ${name}»: связь ${by[e.from].label} → ${by[e.to].label} невозможна`)
    }
    const r = simulate(nodes, edges)
    const passes = c.goals.every((g) => g.check(r)) && r.cost <= c.budget && c.paths.every((pth) => reaches(edges, pth.from, pth.to))
    if (passes) fail(`ловушка «${c.title} / ${name}» решает задачу`)
  }
  const set = (nodes: N, id: string, p: Partial<N[number]>) => nodes.map((x) => (x.id === id ? { ...x, ...p } : x))
  const drop = (nodes: N, edges: E, id: string): [N, E] => [nodes.filter((x) => x.id !== id), edges.filter((e) => e.from !== id && e.to !== id)]
  trap('catalog-search', 'без Elasticsearch', (n, e) => drop(n, e, 'es'))
  trap('catalog-search', 'без кэша', (n, e) => drop(n, e, 'k1'))
  trap('catalog-search', 'без кэша, ES×2, PG×4', (n, e) => {
    const [a, b] = drop(n, e, 'k1')
    return [set(set(a, 'es', { instances: 2 }), 'd1', { instances: 4 }), b]
  })
  trap('reports-db', 'без ClickHouse, PG×5', (n, e) => {
    const [a, b] = drop(n, e, 'ch')
    return [set(a, 'd1', { instances: 5 }), b]
  })
  trap('profiles', 'без кэша, PG×5', (n, e) => {
    const [a, b] = drop(n, e, 'k1')
    return [set(a, 'd1', { instances: 5 }), b]
  })
  trap('profiles', 'кэш, PG×3', (n, e) => [set(n, 'd1', { instances: 3 }), e])
  trap('tickets', 'без очереди', (n) => [
    n.filter((x) => x.id !== 'q1' && x.id !== 'w1'),
    [
      { id: 'e1', from: 'c1', to: 'g1' },
      { id: 'e2', from: 'g1', to: 's1' },
      { id: 'e3', from: 's1', to: 'd1' },
    ],
  ])
  trap('tickets', 'воркеров 20 — перегрев БД', (n, e) => [set(n, 'w1', { instances: 20 }), e])
  trap('tickets', 'Redis вместо очереди', (n) => [
    [...n.filter((x) => x.id !== 'q1' && x.id !== 'w1'), { id: 'k9', kind: 'cache', label: 'Redis', x: 600, y: 240, instances: 3, hitRatio: 0.8 }],
    [
      { id: 'e1', from: 'c1', to: 'g1' },
      { id: 'e2', from: 'g1', to: 's1' },
      // Redis рядом с сервисом (cache-aside): записи билетов он не берёт на себя — они всё равно идут в базу
      { id: 'e3', from: 's1', to: 'k9' },
      { id: 'e4', from: 's1', to: 'd1' },
    ],
  ])
  trap('tickets', 'без очереди, PostgreSQL на 8 шардах', (n) => [
    set(n.filter((x) => x.id !== 'q1' && x.id !== 'w1'), 'd1', { shards: 8 }),
    [
      { id: 'e1', from: 'c1', to: 'g1' },
      { id: 'e2', from: 'g1', to: 's1' },
      { id: 'e3', from: 's1', to: 'd1' },
    ],
  ])
  trap('feed', 'fan-out синхронно из Post API', (n, e) => [
    n.filter((x) => x.id !== 'q1' && x.id !== 's3'),
    [...e.filter((x) => !['s2', 'q1', 's3'].includes(x.from) || (x.from === 's2' && x.to === 'd2')), { id: 'z1', from: 's2', to: 'd1' }],
  ])
  trap('feed', 'Cassandra на одной ноде', (n, e) => [set(n, 'd1', { instances: 1 }), e])
  trap('feed', 'ленты в PostgreSQL постов', (n, e) => [n.filter((x) => x.id !== 'd1'), e.map((x) => (x.to === 'd1' ? { ...x, to: 'd2' } : x)).filter((x) => x.from !== 'k1')])
  trap('tickets', 'воркеров 8 — очередь растёт', (n, e) => [set(n, 'w1', { instances: 8 }), e])
  trap('revenue-dashboard', 'Elasticsearch вместо ClickHouse', (n, e) => [n.map((x) => (x.id === 'ch' ? { ...x, kind: 'elastic' as const } : x)), e])
  trap('sensor-stream', 'MongoDB вместо Cassandra', (n, e) => [n.map((x) => (x.id === 'cs' ? { ...x, kind: 'mongo' as const, instances: 6 } : x)), e])
  trap('slow-images', 'S3 ×3 вместо CDN', (n) => [
    n.filter((x) => x.id !== 'cdn').map((x) => (x.id === 's3' ? { ...x, instances: 3 } : x)),
    [{ id: 'e1', from: 'c1', to: 's3' }],
  ])
  trap('tickets', 'Cassandra вместо PostgreSQL', (n, e) => [n.map((x) => (x.id === 'd1' ? { ...x, kind: 'cassandra' as const } : x)), e])
  // по мотивам System Design Primer
  const edge = (from: string, to: string) => ({ id: `t-${from}-${to}`, from, to })
  const relink = (edges: E, from: string, oldTo: string, newTo: string) => edges.map((x) => (x.from === from && x.to === oldTo ? edge(from, newTo) : x))
  trap('growth-1', 'статика через веб-сервер ×6', (n, e) => [set(n, 's1', { instances: 6 }), [...e.filter((x) => x.from !== 'c2'), edge('c2', 's1'), edge('s1', 's3')]])
  trap('growth-1', 'машина крупнее, статика в базе', (n, e) => {
    const [a, b] = drop(n, e, 's3')
    return [set(set(a, 's1', { instances: 4 }), 'd1', { size: 4 }), [...b, edge('c2', 's1')]]
  })
  trap('growth-2', 'без CDN', (n, e) => {
    const [a, b] = drop(n, e, 'cdn')
    return [a, [...b, edge('c2', 's3')]]
  })
  trap('growth-2', 'реплик меньше: PostgreSQL ×2', (n, e) => [set(n, 'd1', { instances: 2 }), e])
  trap('growth-3', 'обычные веб-серверы ×40', (n, e) => [set(n, 's1', { capacity: 300, latency: 20, instances: 40 }), e])
  trap('growth-3', 'без кэша, реплик 5', (n, e) => {
    const [a, b] = drop(n, e, 'k1')
    return [set(a, 'd1', { instances: 5 }), b]
  })
  trap('growth-3', 'превью никуда не сохраняются', (n, e) => [n, e.filter((x) => !(x.from === 'pv' && x.to === 's3'))])
  // клиент делит поток поровну между связями: вторая связь в обход отправляет мимо нужного блока половину запросов (приёмка, раунд 3)
  const bypass = (id: string, extra: N[number], extraEdges: E, scale: [string, number][]) =>
    trap(id, 'половина потока в обход', (n, e) => [
      [...n.map((x) => scale.find(([sid]) => sid === x.id) ? { ...x, instances: scale.find(([sid]) => sid === x.id)![1] } : x), extra],
      [...e, ...extraEdges],
    ])
  const light = (id: string) => ({ id, kind: 'service' as const, label: id, x: 0, y: 0, instances: 1, capacity: 1000, latency: 5 })
  bypass('finance', light('bp'), [edge('c1', 'bp'), edge('bp', 'd1')], [['w1', 3]])
  bypass('crawler', light('bp'), [edge('c2', 'bp'), edge('bp', 'es')], [['w1', 4]])
  // поток дошёл, но потерялся дальше: посредник за очередью прячет перегрузку рабочего блока (приёмка, раунд 4)
  const svcNode = (id: string, instances: number, capacity: number, latency: number) => ({ id, kind: 'service' as const, label: id, x: 0, y: 0, instances, capacity, latency })
  const middle = (id: string, queue: string, worker: string, sizes: Record<string, Partial<N[number]>>) =>
    trap(id, 'посредник после очереди', (n, e) => [
      [...n.map((x) => (sizes[x.id] ? { ...x, ...sizes[x.id] } : x)), svcNode('mid', 2, 1000, 5)],
      [...e.filter((x) => !(x.from === queue && x.to === worker)), edge(queue, 'mid'), edge('mid', worker)],
    ])
  middle('finance', 'q1', 'w1', { w1: { instances: 1 }, d1: { shards: 1 } })
  middle('growth-3', 'q1', 'pv', { pv: { instances: 1 } })
  middle('crawler', 'q1', 'w1', { w1: { instances: 1 } })
  // экран бюджета пишет и читает через ту же очередь приёма, PostgreSQL ×1 за категоризацией (схема приёмки, раунд 4)
  trap('finance', 'категоризация впритык, PostgreSQL ×1 за очередью', (n, e) => [
    n.map((x) => (x.id === 'd1' ? { ...x, shards: 1 } : x)),
    e.map((x) => (x.from === 's2' && x.to === 'd1' ? edge('s2', 'q1') : x)),
  ])
  // потеря за второй очередью: «принято» ещё не значит «обработано» (приёмка, раунд 5)
  const second = (id: string, worker: string, store: string, sizes: Record<string, Partial<N[number]>>, last: [number, number, number]) =>
    trap(id, 'вторая очередь за рабочим блоком', (n, e) => [
      [...n.map((x) => (sizes[x.id] ? { ...x, ...sizes[x.id] } : x)), { id: 'q8', kind: 'queue' as const, label: 'q8', x: 0, y: 0, instances: 1 }, svcNode('mid', 2, 1000, 5), svcNode('lst', ...last)],
      [...e.filter((x) => !(x.from === worker && x.to === store)), edge(worker, 'q8'), edge('q8', 'mid'), edge('mid', 'lst'), edge('lst', store)],
    ])
  second('finance', 'w1', 'd1', { d1: { shards: 1 } }, [1, 300, 20])
  second('crawler', 'w1', 'es', { w1: { instances: 7 }, es: { instances: 1 } }, [1, 100, 120])
  // экран бюджета и отчёты читают через очередь приёма: ответа на чтение никто не ждёт (приёмка, раунд 5)
  trap('finance', 'экран бюджета и отчёты через очередь приёма', (n, e) => [
    n.filter((x) => x.id !== 's2' && x.id !== 's3').map((x) => (x.id === 'd1' ? { ...x, shards: 1, size: 2 } : x)),
    [...e.filter((x) => !['s2', 's3'].includes(x.from) && !['s2', 's3'].includes(x.to)), edge('c2', 's1'), edge('c3', 's1'), edge('w1', 'ch')],
  ])
  // обойдённые страницы не попадают в индекс: обходчики никуда не пишут (приёмка, раунд 5)
  trap('crawler', 'страницы пишет в индекс фронтир, а не обходчики', (n, e) => [
    n.map((x) => (x.id === 's2' ? { ...x, instances: 2 } : x.id === 'w1' ? { ...x, instances: 7 } : x)),
    [...e.filter((x) => !(x.from === 'w1' && x.to === 'es')), edge('s2', 'es')],
  ])
  // приёмка, раунд 6: страницы пишутся не туда, где ищут пользователи, или вовсе не обходчиками; половина чтений — через очередь
  trap('crawler', 'отдельный индекс для обходчиков', (n, e) => [
    [...n.map((x) => (x.id === 'es' ? { ...x, instances: 1 } : x)), { id: 'es2', kind: 'elastic' as const, label: 'es2', x: 0, y: 0, instances: 1 }],
    e.map((x) => (x.from === 'w1' && x.to === 'es' ? edge('w1', 'es2') : x)),
  ])
  trap('crawler', 'очередь ссылок кормит поиск, обходчики никуда не пишут', (n, e) => [
    n.map((x) => (x.id === 'w1' ? { ...x, instances: 7 } : x)),
    [...e.filter((x) => !(x.from === 'w1' && x.to === 'es')), edge('q1', 's1'), edge('s3', 'es')],
  ])
  trap('finance', 'половина экрана бюджета через очередь приёма', (n, e) => [
    n.map((x) => (x.id === 'd1' ? { ...x, shards: 2 } : x.id === 'w1' ? { ...x, instances: 5 } : x.id === 's3' ? { ...x, instances: 1 } : x)),
    [...e, edge('c2', 's1')],
  ])
  // приёмка, раунд 7: исходный файл не сохраняется до ответа; экран бюджета читает базу, куда операции не попадают
  trap('growth-3', 'загрузка только через очередь', (n, e) => [n, e.filter((x) => !(x.from === 'up' && x.to === 's3'))])
  for (const [shards, size, w1, s3] of [[2, 1, 6, 2], [1, 2, 5, 1]] as const)
    trap('finance', `экран бюджета читает отдельную базу (PostgreSQL ${shards} шард., размер ×${size})`, (n, e) => [
      [...n.map((x) => (x.id === 'd1' ? { ...x, shards, size } : x.id === 'w1' ? { ...x, instances: w1 } : x.id === 's3' ? { ...x, instances: s3 } : x)), { id: 'd9', kind: 'postgres' as const, label: 'd9', x: 0, y: 0, instances: 1 }],
      e.map((x) => (x.from === 's2' && x.to === 'd1' ? edge('s2', 'd9') : x)),
    ])
  // приёмка, раунд 8: половина потока в обход новых целей
  trap('crawler', 'половина поиска — по пустому отдельному индексу', (n, e) => [
    [
      ...n.map((x) => (x.id === 's1' ? { ...x, instances: 3 } : x.id === 'es' ? { ...x, instances: 1 } : x.id === 'w1' ? { ...x, instances: 7 } : x)),
      svcNode('lx', 3, 1000, 5),
      { id: 'k2', kind: 'cache' as const, label: 'k2', x: 0, y: 0, instances: 1, hitRatio: 0.7 },
      { id: 'es2', kind: 'elastic' as const, label: 'es2', x: 0, y: 0, instances: 1 },
    ],
    [...e, edge('c1', 'lx'), edge('lx', 'k2'), edge('lx', 'es2')],
  ])
  trap('finance', 'половина экрана бюджета читает отдельную базу', (n, e) => [
    [...n.map((x) => (x.id === 'd1' ? { ...x, shards: 1, size: 2 } : x.id === 'w1' ? { ...x, instances: 5 } : x.id === 's3' ? { ...x, instances: 1 } : x)), svcNode('b2', 1, 300, 20), { id: 'd9', kind: 'postgres' as const, label: 'd9', x: 0, y: 0, instances: 1 }],
    [...e, edge('c2', 'b2'), edge('b2', 'd9')],
  ])
  trap('growth-3', 'половина загрузок только в очередь', (n, e) => [
    [...n.map((x) => (x.id === 'up' ? { ...x, instances: 1 } : x)), svcNode('u2', 1, 300, 20)],
    [...e, edge('c3', 'u2'), edge('u2', 'q1')],
  ])
  // приёмка, раунд 9: половина запросов — во внешний API, у которого данных нет
  trap('finance', 'половина отчётов во внешний API', (n, e) => [
    [...n.map((x) => (x.id === 'd1' ? { ...x, shards: 1, size: 2 } : x.id === 'w1' ? { ...x, instances: 5 } : x.id === 's3' ? { ...x, instances: 1 } : x)), svcNode('ext', 2, 100, 300)],
    [...e, edge('c3', 'ext')],
  ])
  trap('sales-rank', 'половина пересчёта во внешний API', (n, e) => [[...n, svcNode('ext', 1, 100, 300)], [...e, edge('c3', 'ext')]])
  // приёмка, раунд 10: половина потока в обход, а другая — через рабочий блок дважды (объём сходится, запросы — нет)
  trap('crawler', 'половина ссылок в обход, другая обходится дважды', (n, e) => [
    [...n.map((x) => (x.id === 's1' ? { ...x, instances: 6 } : x)), svcNode('lx', 1, 1000, 5), svcNode('ly', 1, 1000, 5)],
    [...e, edge('c2', 'lx'), edge('lx', 'es'), edge('s2', 'ly'), edge('ly', 'q1')],
  ])
  trap('growth-3', 'половина файлов без превью, другая — с двумя', (n, e) => [
    [...n.map((x) => (x.id === 'up' ? { ...x, capacity: 1000, latency: 5, instances: 1 } : x)), svcNode('lx', 1, 1000, 5), svcNode('ly', 1, 1000, 5)],
    [...e, edge('c3', 'lx'), edge('lx', 's3'), edge('up', 'ly'), edge('ly', 'q1')],
  ])
  trap('social-graph', 'новые дружбы — в отдельную Cassandra', (n, e) => [
    [...n.map((x) => (x.id === 'd1' ? { ...x, instances: 1 } : x)), svcNode('lw', 1, 1000, 5), { id: 'cs2', kind: 'cassandra' as const, label: 'cs2', x: 0, y: 0, instances: 1 }],
    [...e.filter((x) => !(x.from === 'c2' && x.to === 'l1')), edge('c2', 'lw'), edge('lw', 'cs2')],
  ])
  // приёмка, раунд 11: отдельное хранилище и связь без единого запроса в общее — пустая связь не делает хранилище общим
  trap('crawler', 'отдельный индекс и пустые связи в отпечатки', (n, e) => [
    [
      ...n.map((x) => (x.id === 's1' ? { ...x, instances: 6 } : x.id === 'w1' ? { ...x, instances: 7 } : x.id === 'es' ? { ...x, instances: 1 } : x)),
      { id: 'es2', kind: 'elastic' as const, label: 'es2', x: 0, y: 0, instances: 1 },
    ],
    [...e.map((x) => (x.from === 'w1' && x.to === 'es' ? edge('w1', 'es2') : x)), edge('s1', 'cs'), edge('w1', 'cs')],
  ])
  trap('finance', 'экран бюджета читает отдельную базу, пустые связи в колоночную', (n, e) => [
    [
      ...n.map((x) => (x.id === 'd1' ? { ...x, shards: 1, size: 2 } : x.id === 'w1' ? { ...x, instances: 5 } : x.id === 's3' ? { ...x, instances: 1 } : x)),
      { id: 'd9', kind: 'postgres' as const, label: 'd9', x: 0, y: 0, instances: 1 },
    ],
    [...e.map((x) => (x.from === 's2' && x.to === 'd1' ? edge('s2', 'd9') : x)), edge('s2', 'ch'), edge('w1', 'ch')],
  ])
  trap('social-graph', 'дружбы в отдельную PostgreSQL, пустая связь от Graph API', (n, e) => [
    [...n.map((x) => (x.id === 'd1' ? { ...x, instances: 1 } : x)), svcNode('lw', 1, 1000, 5), { id: 'pg9', kind: 'postgres' as const, label: 'pg9', x: 0, y: 0, instances: 1 }],
    [...e.filter((x) => !(x.from === 'c2' && x.to === 'l1')), edge('c2', 'lw'), edge('lw', 'pg9'), edge('s1', 'pg9')],
  ])
  trap('finance', 'половина отчётов через очередь приёма', (n, e) => [n.map((x) => (x.id === 'd1' ? { ...x, shards: 1, size: 2 } : x)), [...e, edge('c3', 's1'), edge('w1', 'ch')]])
  trap('crawler', 'обходчики никуда не пишут, в индекс пишет сервис рядом с фронтиром', (n, e) => [
    [...n.map((x) => (x.id === 'es' ? { ...x, instances: 1 } : x)), { id: 'l9', kind: 'lb' as const, label: 'l9', x: 0, y: 0, instances: 1 }, svcNode('lx', 1, 1000, 5)],
    [...e.filter((x) => !(x.from === 'w1' && x.to === 'es') && !(x.from === 'c2' && x.to === 's2')), edge('c2', 'l9'), edge('l9', 's2'), edge('l9', 'lx'), edge('lx', 'es'), edge('lx', 'q1')],
  ])
  trap('crawler', 'страницы теряются за обходчиками', (n, e) => [
    [...n.map((x) => (x.id === 'w1' ? { ...x, instances: 7 } : x.id === 'es' ? { ...x, instances: 1 } : x)), svcNode('hv', 1, 100, 120)],
    [...e.filter((x) => !(x.from === 'w1' && x.to === 'es')), edge('w1', 'hv'), edge('hv', 'es')],
  ])
  // чтение через очередь: ответ «принят» быстрый, а списки друзей копятся необработанными
  trap('social-graph', 'списки друзей через очередь', (n, e) => {
    const [a, b] = drop(n, e, 'k1')
    return [
      [...a.map((x) => (x.id === 'd1' ? { ...x, instances: 1 } : x)), { id: 'q9', kind: 'queue' as const, label: 'Kafka', x: 0, y: 0, instances: 1 }, svcNode('hv', 1, 100, 120)],
      [...b.filter((x) => !(x.from === 's1' && x.to === 'd1')), edge('s1', 'q9'), edge('q9', 'hv'), edge('hv', 'd1')],
    ]
  })
  // «Рост» 1–2: заблокированный веб-сервер без трафика, рядом новый лёгкий сервис
  trap('growth-1', 'веб-сервер без трафика, рядом лёгкий сервис', (n, e) => [
    [...n.map((x) => (x.id === 's1' ? { ...x, instances: 1 } : x)), svcNode('lw', 1, 1000, 5)],
    [...e.filter((x) => !(x.from === 'c1' && x.to === 's1')), edge('c1', 'lw'), edge('lw', 'd1')],
  ])
  trap('growth-2', 'веб-сервер без трафика, рядом лёгкий сервис', (n, e) => [
    [...n.map((x) => (x.id === 's1' ? { ...x, instances: 1 } : x)), svcNode('lw', 3, 1000, 5)],
    [...e.filter((x) => !(x.from === 'l1' && x.to === 's1')), edge('l1', 'lw'), edge('lw', 'd1')],
  ])
  trap('growth-3', 'половина файлов в S3 напрямую', (n, e) => [n.map((x) => (x.id === 'pv' ? { ...x, instances: 2 } : x.id === 'up' ? { ...x, instances: 1 } : x)), [...e, edge('c3', 's3')]])
  trap('growth-3', 'превью синхронно', (n, e) => {
    const [a, b] = drop(n, e, 'q1')
    return [a, [...b, edge('up', 'pv')]]
  })
  trap('sales-rank', 'без кэша, PostgreSQL ×5', (n, e) => {
    const [a, b] = drop(n, e, 'k1')
    return [set(a, 'd1', { instances: 5 }), b]
  })
  trap('sales-rank', 'журнал и пересчёт в PostgreSQL', (n, e) => {
    const [a, b] = drop(n, e, 'ch')
    return [a, [...b, edge('s2', 'd1')]]
  })
  trap('sales-rank', 'рейтинг из ClickHouse', (n, e) => {
    const [a, b] = drop(n, e, 'd1')
    return [a, [...b, edge('s1', 'ch')]]
  })
  trap('finance', 'реплики вместо шардов', (n, e) => [set(n, 'd1', { shards: 1, instances: 5 }), e])
  trap('finance', 'без очереди', (n, e) => {
    const [a, b] = drop(n, e, 'q1')
    return [a, [...b, edge('s1', 'w1')]]
  })
  trap('finance', 'отчёты по PostgreSQL', (n, e) => {
    const [a, b] = drop(n, e, 'ch')
    return [a, [...b, edge('s3', 'd1')]]
  })
  // агрегаты — родной профиль только колоночной базы: на одном узле другие хранилища не тянут, на двух — не по бюджету
  for (const [kind, name] of [['cassandra', 'Cassandra'], ['elastic', 'Elasticsearch']] as const)
    for (const instances of [1, 2]) {
      trap('finance', `отчёты в ${name} ×${instances}`, (n, e) => [n.map((x) => (x.id === 'ch' ? { ...x, kind, instances } : x)), e])
      trap('sales-rank', `журнал и пересчёт в ${name} ×${instances}`, (n, e) => [n.map((x) => (x.id === 'ch' ? { ...x, kind, instances } : x)), e])
    }
  // схемы, которые экономят на остальном и проходят по деньгам (приёмка, раунд 2): агрегаты не в родном хранилище — не засчитываются
  trap('sales-rank', 'рейтинг, журнал и пересчёт в одной Cassandra ×2', (n, e) => {
    const nodes = [...n.filter((x) => x.id !== 'd1' && x.id !== 'ch'), { id: 'cs', kind: 'cassandra' as const, label: 'Cassandra', x: 700, y: 240, instances: 2 }]
    const edges = [...e.filter((x) => x.to !== 'd1' && x.to !== 'ch'), edge('s1', 'cs'), edge('s2', 'cs'), edge('s3', 'cs')]
    return [nodes, edges]
  })
  for (const [kind, name] of [['cassandra', 'Cassandra'], ['elastic', 'Elasticsearch']] as const) {
    trap('finance', `PostgreSQL ×2 по размеру, отчёты в ${name} ×2`, (n, e) => [
      n.map((x) => (x.id === 'd1' ? { ...x, shards: 1, size: 2 } : x.id === 'ch' ? { ...x, kind, instances: 2 } : x.id === 'w1' ? { ...x, instances: 5 } : x)),
      e,
    ])
    trap('finance', `один сервис для бюджета и отчётов, отчёты в ${name} ×2`, (n, e) => [
      n.filter((x) => x.id !== 's3').map((x) => (x.id === 'd1' ? { ...x, shards: 1, size: 2 } : x.id === 'ch' ? { ...x, kind, instances: 2 } : x.id === 's2' ? { ...x, instances: 2 } : x)),
      [...e.filter((x) => x.from !== 's3' && x.to !== 's3'), edge('c3', 's2'), edge('s2', 'ch')],
    ])
  }
  trap('finance', 'операции в Cassandra', (n, e) => [n.map((x) => (x.id === 'd1' ? { ...x, kind: 'cassandra' as const, shards: undefined } : x)), e])
  trap('social-graph', 'Cassandra на одной ноде', (n, e) => [set(n, 'd1', { instances: 1 }), e])
  trap('social-graph', 'PostgreSQL ×5 вместо Cassandra', (n, e) => [n.map((x) => (x.id === 'd1' ? { ...x, kind: 'postgres' as const, instances: 5 } : x)), e])
  trap('social-graph', 'без кэша, Cassandra ×4', (n, e) => {
    const [a, b] = drop(n, e, 'k1')
    return [set(a, 'd1', { instances: 4 }), b]
  })
  trap('crawler', 'без очереди', (n, e) => {
    const [a, b] = drop(n, e, 'q1')
    return [a, [...b, edge('s2', 'w1')]]
  })
  trap('crawler', 'индекс на одной ноде', (n, e) => [set(n, 'es', { instances: 1 }), e])
  trap('crawler', 'отпечатки в PostgreSQL ×2', (n, e) => [n.map((x) => (x.id === 'cs' ? { ...x, kind: 'postgres' as const, instances: 2 } : x)), e])
  trap('crawler', 'без кэша, индекс ×3', (n, e) => {
    const [a, b] = drop(n, e, 'k1')
    return [set(a, 'es', { instances: 3 }), b]
  })
  trap('crawler', 'отпечатки через кэш поиска', (n, e) => [n, relink(e, 's3', 'cs', 'k1')])
  console.log(`- ловушек проверено: ${traps}`)
  // и обратное: законные альтернативы эталону (дешевле или иначе собранные) решают задачу — цели не слишком строгие
  let legits = 0
  const legit = (id: string, name: string, patch: (n: N, e: E) => [N, E]) => {
    legits++
    const c = builderChallenges.find((x) => x.id === id)!
    const [nodes, edges] = patch(structuredClone(c.solution.nodes), structuredClone(c.solution.edges))
    const by = Object.fromEntries(nodes.map((x) => [x.id, x]))
    for (const e of edges) if (linkProblem(by[e.from].kind, by[e.to].kind)) fail(`законный вариант «${c.title} / ${name}»: связь ${by[e.from].label} → ${by[e.to].label} невозможна`)
    const r = simulate(nodes, edges)
    const missed = [...c.goals.filter((g) => !g.check(r)).map((g) => g.text), ...c.paths.filter((pth) => !reaches(edges, pth.from, pth.to)).map((pth) => pth.text)]
    if (r.cost > c.budget) missed.push(`бюджет $${r.cost} > $${c.budget}`)
    if (missed.length) fail(`законный вариант «${c.title} / ${name}» не решает задачу: ${missed.join('; ')}`)
  }
  legit('growth-2', 'кэш вместо реплик', (n, e) => [
    [...n.map((x) => (x.id === 'd1' ? { ...x, instances: 1 } : x)), { id: 'k9', kind: 'cache' as const, label: 'Redis', x: 0, y: 0, instances: 1, hitRatio: 0.8 }],
    [...e, edge('s1', 'k9')],
  ])
  legit('growth-2', 'без балансировщика', (n, e) => {
    const [a, b] = drop(n, e, 'l1')
    return [a, [...b, edge('c1', 's1')]]
  })
  legit('growth-3', 'лёгкий Upload API ×1', (n, e) => [n.map((x) => (x.id === 'up' ? { ...x, capacity: 1000, latency: 5, instances: 1 } : x)), e])
  legit('growth-3', 'загрузка через CDN перед S3 и Upload API', (n, e) => [
    [...n.map((x) => (x.id === 'up' ? { ...x, capacity: 1000, latency: 5, instances: 1 } : x)), { id: 'cd9', kind: 'cdn' as const, label: 'CDN', x: 0, y: 0, instances: 1, hitRatio: 0.9 }],
    [...e.filter((x) => x.from !== 'c3' && !(x.from === 'up' && x.to === 's3')), edge('c3', 'cd9'), edge('cd9', 's3'), edge('cd9', 'up')],
  ])
  legit('finance', 'PostgreSQL ×2 по размеру вместо шардов', (n, e) => [n.map((x) => (x.id === 'd1' ? { ...x, shards: 1, size: 2 } : x)), e])
  legit('finance', 'PostgreSQL ×2 по размеру, категоризация ×5, Reports API ×1', (n, e) => [
    n.map((x) => (x.id === 'd1' ? { ...x, shards: 1, size: 2 } : x.id === 'w1' ? { ...x, instances: 5 } : x.id === 's3' ? { ...x, instances: 1 } : x)),
    e,
  ])
  legit('crawler', 'Search API ×6, обходчики ×7', (n, e) => [n.map((x) => (x.id === 's1' ? { ...x, instances: 6 } : x.id === 'w1' ? { ...x, instances: 7 } : x)), e])
  // связь без трафика поиска, естественная по условию: обходчики сами сверяют отпечатки — правило «куда идёт профиль» её не ломает
  legit('crawler', 'обходчики ещё и сверяют отпечатки', (n, e) => [n.map((x) => (x.id === 's1' ? { ...x, instances: 6 } : x.id === 'w1' ? { ...x, instances: 7 } : x)), [...e, edge('w1', 'cs')]])
  legit('social-graph', 'без балансировщика, Graph API ×14', (n, e) => {
    const [a, b] = drop(n, e, 'l1')
    return [a.map((x) => (x.id === 's1' ? { ...x, instances: 14 } : x)), [...b, edge('c1', 's1'), edge('c2', 's1')]]
  })
  console.log(`- законных вариантов проверено: ${legits}`)
  // задачи на инструмент: без него задача не решается
  for (const c of builderChallenges.filter((x) => x.tool)) {
    const nodes = c.solution.nodes.filter((x) => x.kind !== c.tool)
    const ids = new Set(nodes.map((x) => x.id))
    const edges = c.solution.edges.filter((e) => ids.has(e.from) && ids.has(e.to))
    const r = simulate(nodes, edges)
    if (c.goals.every((g) => g.check(r)) && r.cost <= c.budget && c.paths.every((pth) => reaches(edges, pth.from, pth.to)))
      fail(`«${c.title}» решается и без ${c.tool}`)
  }
  console.log(`- ${builderChallenges.filter((x) => x.tool).length} задач на инструмент не решаются без своего инструмента`)
}

// связи, которых не бывает (Redis → база, очередь → база, клиент → база…), нельзя провести в редакторе —
// и ни старт, ни эталон задачи их не содержат
console.log('\nТолько возможные связи')
{
  let n = 0
  const states: [string, { nodes: BNode[]; edges: BEdge[] }][] = [['песочница', sandboxStart]]
  for (const c of builderChallenges) states.push([`${c.title} (старт)`, c], [`${c.title} (эталон)`, c.solution])
  for (const [name, g] of states) {
    const by = Object.fromEntries(g.nodes.map((x) => [x.id, x]))
    for (const e of g.edges) {
      n++
      const why = linkProblem(by[e.from].kind, by[e.to].kind)
      if (why) fail(`${name}: связь ${by[e.from].label} → ${by[e.to].label} невозможна: ${why}`)
    }
  }
  const no: [NodeKind, NodeKind][] = [['cache', 'postgres'], ['cache', 'cassandra'], ['queue', 'postgres'], ['client', 'postgres'], ['client', 'cache'], ['client', 'queue'], ['lb', 'postgres'], ['gateway', 'cache'], ['cdn', 'postgres'], ['service', 'gateway'], ['service', 'cdn'], ['postgres', 'service'], ['service', 'client']]
  const yes: [NodeKind, NodeKind][] = [['client', 's3'], ['cdn', 's3'], ['service', 'cache'], ['service', 'postgres'], ['queue', 'service'], ['gateway', 'lb'], ['lb', 'service'], ['service', 'service']]
  for (const [a, b] of no) if (!linkProblem(a, b)) fail(`связь ${a} → ${b} должна быть запрещена`)
  for (const [a, b] of yes) if (linkProblem(a, b)) fail(`связь ${a} → ${b} должна быть разрешена`)
  console.log(`- связей в стартах и эталонах проверено: ${n}; запрещённых пар: ${no.length}, разрешённых: ${yes.length}`)
}

// у каждого вида конструктора — своя карточка в справочнике (ⓘ в меню «Добавить»), ключи записей не повторяются
console.log('\nСправочник')
{
  for (const k of Object.keys(KINDS) as NodeKind[]) if (!findRef(k, 'component')) fail(`у компонента «${k}» нет карточки в справочнике`)
  const keys = [...PATTERN_REF, ...COMPONENT_REF].map(refKey)
  const twice = keys.filter((k, i) => keys.indexOf(k) !== i)
  if (twice.length) fail(`ключи справочника повторяются: ${twice.join(', ')}`)
  console.log(`- карточек: паттернов ${PATTERN_REF.length}, компонентов ${COMPONENT_REF.length}; у каждого вида конструктора карточка есть`)
}

// все блоки старта и эталона — внутри поля и не накладываются: блок ниже края на компьютере не увидеть и не перетащить
console.log('\nБлоки внутри поля и не накладываются')
{
  let n = 0
  const states: [string, BNode[]][] = [['песочница', sandboxStart.nodes]]
  for (const c of builderChallenges) states.push([`${c.title} (старт)`, c.nodes], [`${c.title} (эталон)`, c.solution.nodes])
  for (const [name, nodes] of states) {
    for (const x of nodes) {
      n++
      if (x.x < 0 || x.y < 0 || x.x + NODE_W > BOARD_W || x.y + NODE_H > BOARD_H) fail(`${name}: «${x.label}» (${x.x}, ${x.y}) выходит за поле ${BOARD_W} × ${BOARD_H}`)
    }
    nodes.forEach((a, i) =>
      nodes.slice(i + 1).forEach((b) => {
        if (a.x < b.x + NODE_W && b.x < a.x + NODE_W && a.y < b.y + NODE_H && b.y < a.y + NODE_H) fail(`${name}: «${a.label}» и «${b.label}» накладываются`)
      }),
    )
  }
  console.log(`- блоков в стартах и эталонах проверено: ${n}`)
}

// подсказки должны вести к решению через свойства, а не называть инструмент или паттерн
console.log('\nПодсказки без названий инструментов и паттернов')
{
  // и по-китайски: 缓存 (кэш), 队列 (очередь), 负载均衡 (балансировщик), 搜索引擎/全文检索 (поиск), 列式 (колоночная), 对象存储 (объектное хранилище)
  const tools = /redis|kafka|\bcdn\b|elasticsearch|clickhouse|cassandra|mongo|\bs3\b|кэш|кеш|\bcache|очеред|\bqueue|поисков\w* движ|search engine|колоночн|columnar|объектн\w* хранилищ|object storage|балансировщик|load balancer|缓存|队列|负载均衡|搜索引擎|全文检索|列式|对象存储/i
  const patterns = /熔断|断路器|退避|抖动|服务发现|契约|访问令牌|事件驱动|追踪|变更数据捕获|幂等|金丝雀|蓝绿|服务网格|限流|防腐层|事件溯源|扇出|cqrs|event-driven|fan-out|\bsaga|\bсаг[аиуеой]|outbox|\bcdc\b|circuit|bulkhead|backoff|jitter|idempoten|идемпотент|canary|blue-green|tracing|трассировк|\bmtls\b|\bjwt\b|access token|\bbff\b|backend for frontend|service mesh|discovery|rate limit|anti-corruption|contract|контракт|event sourcing|cache-aside|read-through/i
  let n = 0
  for (const c of builderChallenges)
    for (const h of c.hints) {
      n++
      const m = h.match(tools) ?? h.match(patterns)
      if (m) fail(`подсказка задачи «${c.title}» называет «${m[0]}»: ${h.slice(0, 80)}…`)
    }
  for (const c of builderChallenges)
    for (const g of [...c.goals.map((x) => x.text), ...c.paths.map((x) => x.text)]) {
      n++
      const m = g.match(tools) ?? g.match(patterns)
      if (m) fail(`цель задачи «${c.title}» называет «${m[0]}»: ${g}`)
    }
  // динамические подсказки на поле: тоже без названий инструментов (названия блоков в «ёлочках» — их ставил игрок)
  let nd = 0
  for (const c of builderChallenges) {
    // старт, эталон и эталон без каждой связи: так проход доходит до большинства сообщений разбора
    const states = [
      { name: 'старт', nodes: c.nodes, edges: c.edges },
      { name: 'эталон', nodes: c.solution.nodes, edges: c.solution.edges },
      ...c.solution.edges.map((e) => ({ name: `эталон без ${e.id}`, nodes: c.solution.nodes, edges: c.solution.edges.filter((x) => x !== e) })),
    ]
    for (const g of states) {
      const r = simulate(g.nodes, g.edges)
      const goals = [...c.paths.map((p) => ({ text: p.text, ok: reaches(g.edges, p.from, p.to) })), ...c.goals.map((x) => ({ text: x.text, ok: x.check(r) }))]
      const ds = diagnose({ nodes: g.nodes, edges: g.edges, result: r, goals, budget: c.budget })
      // подпись не зависит от языка: на всех трёх языках разбор должен быть одним и тем же
      signature.push(`${c.id} / ${g.name}: ${ds.map((d) => `${d.tone}:${d.rank}:${d.nodeId ?? '-'}`).join(' ')}`)
      for (const d of ds) {
        nd++
        const plain = d.text.replace(/«[^»]*»|“[^”]*”/g, '')
        const m = plain.match(tools) ?? plain.match(patterns)
        if (m) fail(`подсказка на поле в «${c.title}» называет «${m[0]}»: ${d.text}`)
      }
    }
  }
  console.log(`- подсказок на поле проверено: ${nd}`)
  for (const c of builderChallenges.filter((x) => x.tool)) {
    const m = c.title.match(tools)
    if (m) fail(`заголовок задачи на инструмент выдаёт ответ: «${c.title}»`)
  }
  for (const t of STRESS_TESTS) {
    n++
    const m = t.need.match(patterns)
    if (m) fail(`стресс-тест «${t.id}»: формулировка задачи называет паттерн «${m[0]}»`)
  }
  console.log(`- ${n} подсказок и формулировок проверено`)
}

console.log('\nМодель конструктора: тупиковые блоки не обслуживают запросы')
{
  const client = { id: 'c', kind: 'client' as const, label: 'c', x: 0, y: 0, instances: 1, rps: 100, workload: 'kv' as const }
  const leaf = (kind: 'gateway' | 'lb' | 'cache' | 'queue', extra = {}) =>
    simulate([client, { id: 'x', kind, label: kind, x: 200, y: 0, instances: 1, ...extra }], [{ id: 'e', from: 'c', to: 'x' }])
  const gw = leaf('gateway')
  if (gw.clientSuccess !== 0) fail(`шлюз без потомков отвечает ${gw.clientSuccess}`)
  const lb = leaf('lb')
  if (lb.clientSuccess !== 0) fail(`балансировщик без потомков отвечает ${lb.clientSuccess}`)
  const cache = leaf('cache', { hitRatio: 0.8 })
  // кэш наполняется только из источника данных: без источника он пуст
  if (cache.clientSuccess !== 0) fail(`кэш без источника данных отвечает ${cache.clientSuccess}`)
  const svc = (extra: object) => ({ id: 's', kind: 'service' as const, label: 's', x: 200, y: 0, instances: 1, ...extra })
  const noDb = simulate([client, svc({ capacity: 300, latency: 20 })], [{ id: 'e', from: 'c', to: 's' }])
  if (noDb.clientSuccess !== 0) fail(`сервис без хранилища отвечает ${noDb.clientSuccess}`)
  const ext = simulate([client, svc({ capacity: 100, latency: 300 })], [{ id: 'e', from: 'c', to: 's' }])
  if (ext.clientSuccess !== 1) fail(`внешний API отвечает ${ext.clientSuccess}, а не 1`)
  const onlyRedis = simulate(
    [client, svc({ capacity: 300, latency: 20 }), { id: 'k', kind: 'cache', label: 'k', x: 400, y: 0, instances: 1, hitRatio: 0.8 }],
    [{ id: 'e1', from: 'c', to: 's' }, { id: 'e2', from: 's', to: 'k' }],
  )
  if (onlyRedis.clientSuccess !== 0) fail(`сервис только с кэшем, без БД, отвечает ${onlyRedis.clientSuccess}`)
  console.log(`- без базы: сервис ${noDb.clientSuccess}, сервис + кэш ${onlyRedis.clientSuccess}; внешний API ${ext.clientSuccess}`)
  const q = leaf('queue')
  if (q.backlogGrowth < 99) fail(`очередь без потребителей не копит сообщения: ${q.backlogGrowth}`)
  // cache-aside: сервис → Redis и сервис → БД; в БД доходят только промахи чтения
  const reader = { ...client, workload: 'oltp' as const, writeShare: 0 }
  const aside = simulate(
    [
      reader,
      { id: 's', kind: 'service', label: 's', x: 200, y: 0, instances: 1, capacity: 300, latency: 20 },
      { id: 'k', kind: 'cache', label: 'k', x: 400, y: 0, instances: 1, hitRatio: 0.8 },
      { id: 'd', kind: 'postgres', label: 'd', x: 400, y: 200, instances: 1 },
    ],
    [
      { id: 'e1', from: 'c', to: 's' },
      { id: 'e2', from: 's', to: 'k' },
      { id: 'e3', from: 's', to: 'd' },
    ],
  )
  if (Math.abs(aside.nodes.d.in - 20) > 1e-6) fail(`cache-aside: в БД дошло ${aside.nodes.d.in} rps вместо 20`)
  if (!aside.persisted.c) fail('cache-aside: данные клиента не доходят до хранилища')
  console.log(`- cache-aside: в БД ${Math.round(aside.nodes.d.in)} из 100 rps`)

  // запись: кэш её не закрывает, реплики не масштабируют, машина крупнее и шарды — масштабируют
  const db = (extra: object, rps: number, writeShare: number) =>
    simulate(
      [
        { ...client, workload: 'oltp' as const, rps, writeShare },
        { id: 's', kind: 'service', label: 's', x: 200, y: 0, instances: 40, capacity: 300, latency: 20 },
        { id: 'k', kind: 'cache', label: 'k', x: 400, y: 0, instances: 1, hitRatio: 0.8 },
        { id: 'd', kind: 'postgres', label: 'd', x: 400, y: 200, instances: 1, ...extra },
      ],
      [
        { id: 'e1', from: 'c', to: 's' },
        { id: 'e2', from: 's', to: 'k' },
        { id: 'e3', from: 's', to: 'd' },
      ],
    ).nodes.d
  const writesThrough = db({}, 100, 1)
  if (Math.abs(writesThrough.in - 100) > 1e-6) fail(`запись прошла мимо кэша не целиком: ${writesThrough.in} из 100`)
  const replicas = db({ instances: 5 }, 1500, 1)
  if (replicas.util < 1.4) fail(`реплики масштабируют запись: загрузка ${replicas.util.toFixed(2)} при 1500 записях и 5 узлах`)
  const bigger = db({ size: 2 }, 1500, 1)
  const sharded = db({ shards: 3 }, 1500, 1)
  if (bigger.util > 0.8 || sharded.util > 0.8) fail(`машина крупнее или шарды не масштабируют запись: ${bigger.util.toFixed(2)} / ${sharded.util.toFixed(2)}`)
  const readsOnReplicas = db({ instances: 5 }, 4000, 0)
  if (readsOnReplicas.util > 0.9) fail(`реплики не масштабируют чтение: ${readsOnReplicas.util.toFixed(2)}`)
  console.log(
    `- запись: 1500 rps на primary + 4 реплики → ${Math.round(replicas.util * 100)}%, машина ×2 → ${Math.round(bigger.util * 100)}%, 3 шарда → ${Math.round(sharded.util * 100)}%; чтение 4000 на 5 узлах → ${Math.round(readsOnReplicas.util * 100)}%`,
  )
  console.log(`- шлюз ${gw.clientSuccess}, балансировщик ${lb.clientSuccess}, кэш ${cache.clientSuccess}, рост очереди ${q.backlogGrowth}/с`)

  // раскладка постов: лишняя связь в кэш её не ломает; причина потери — перегрузка или конец пути
  const feed = builderChallenges.find((c) => c.id === 'feed')!
  const met = (nodes: typeof feed.solution.nodes, edges: typeof feed.solution.edges) => {
    const r = simulate(nodes, edges)
    return { r, ok: feed.goals.every((g) => g.check(r)) }
  }
  const withCache = met(feed.solution.nodes, [...feed.solution.edges, { id: 'zk', from: 's3', to: 'k1' }])
  if (!withCache.ok) fail('лента: связь воркера раскладки с кэшем ломает раскладку постов')
  const heavyNodes = feed.solution.nodes.map((x) => (x.id === 's3' ? { ...x, capacity: 100, latency: 120 } : x))
  const heavy = met(heavyNodes, feed.solution.edges)
  if (heavy.r.fanoutDelivered || heavy.r.fanoutLossAt?.nodeId !== 's3' || !heavy.r.fanoutLossAt.overload)
    fail(`лента: перегруженный воркер раскладки не назван причиной: ${JSON.stringify(heavy.r.fanoutLossAt)}`)
  // подсказка о потере постов на этом блоке (ранг 3) — без привязки к языку текста
  const heavyHint = diagnose({ nodes: heavyNodes, edges: feed.solution.edges, result: heavy.r }).find((d) => d.nodeId === 's3' && d.rank === 3 && d.tone === 'bad')
  if (!heavyHint) fail('лента: подсказка на поле не говорит, что воркер раскладки не справляется')
  const viaCache = feed.solution.edges.filter((x) => !(x.from === 's3' && x.to === 'd1')).concat({ id: 'zk', from: 's3', to: 'k1' })
  const lost = simulate(feed.solution.nodes, viaCache)
  if (lost.fanoutDelivered || lost.fanoutLossAt?.nodeId !== 's3' || lost.fanoutLossAt.overload) fail(`лента: путь поста через кэш без хранилища не назван: ${JSON.stringify(lost.fanoutLossAt)}`)
  console.log('- раскладка постов: лишняя связь в кэш не мешает; перегрузка и конец пути различаются')
}

console.log('\nУпражнения C4')
for (const ex of C4_EXERCISES) {
  const rv = reviewDiagram(ex, ex.solution)
  const issues = rv.items.filter((i) => i.tone !== 'ok')
  console.log(`- ${ex.title}: эталон ${rv.score}/100`)
  if (!rv.solved || rv.score !== 100) fail(`эталон не принят: ${issues.map((i) => i.text).join('; ')}`)
  const ps = ex.solution.placed
  for (const p of ps) {
    if (p.x < 0 || p.y < 0 || p.x + EL_W > CANVAS.w || p.y + EL_H > CANVAS.h) fail(`«${p.card}» выходит за холст`)
    for (const q of ps)
      if (p !== q && Math.abs(p.x - q.x) < EL_W && Math.abs(p.y - q.y) < EL_H) fail(`«${p.card}» накладывается на «${q.card}»`)
  }
  const start = reviewDiagram(ex, ex.start ?? { placed: [], rels: [] })
  if (start.solved) fail('упражнение решено уже в исходном состоянии')
  if (ex.start) {
    const errs = start.items.filter((i) => i.tone === 'bad' || i.tone === 'warn')
    console.log(`  стартовая диаграмма: ${errs.length} замечаний`)
    for (const e of errs) console.log('    · ' + e.text)
  }
}

console.log('\nCAP и кворумы')
for (const t of CAP_TASKS) {
  const ok = (cfg: typeof t.start) => {
    const r = runCap(cfg, t.steps)
    return t.goals.every((g) => g.check(r, cfg))
  }
  console.log(`- ${t.title}: эталон N=${t.solution.n} W=${t.solution.w} R=${t.solution.r} ${t.solution.shortfall}/${t.solution.resolve}`)
  if (!ok(t.solution)) fail('эталон не выполняет цели')
  if (ok(t.start)) fail('задача решена уже в исходном состоянии')
  for (const [k, v] of Object.entries(t.fixed ?? {}))
    if ((t.solution as Record<string, unknown>)[k] !== v || (t.start as Record<string, unknown>)[k] !== v) fail(`эталон или старт нарушают фиксированное ${k}`)
}

console.log('\nEvent Sourcing')
for (const t of ES_TASKS) {
  const ok = (cfg: Record<string, string>) => {
    const r = t.run(cfg)
    return t.goals.every((g) => g.check(r, cfg))
  }
  // перебор всех комбинаций: сколько вариантов решают задачу
  const combos = t.options.reduce<Record<string, string>[]>(
    (acc, o) => acc.flatMap((c) => o.choices.map((ch) => ({ ...c, [o.key]: ch.value }))),
    [{}],
  )
  const solving = combos.filter(ok)
  console.log(`- ${t.title}: решают ${solving.length} из ${combos.length} вариантов`)
  if (!ok(t.solution)) fail('эталон не выполняет цели')
  if (ok(t.start)) fail('задача решена уже в исходном состоянии')
}

// границы контекстов: эталон решает задачу, а «всё в одну кучу» и «каждая карточка отдельно» — нет
console.log('\nГраницы контекстов и карта контекстов')
for (const [projectId, stages] of Object.entries(DDD_STAGES)) {
  const project = PROJECTS.find((p) => p.id === projectId)
  if (!project) fail(`${projectId}: нет проекта распила`)
  for (const t of stages) {
    if (t.type === 'partition') {
      const ids = new Set(t.contexts.map((c) => c.id))
      for (const c of t.cards) if (!ids.has(c.ctx)) fail(`${projectId}/${t.id}: карточка ${c.id} ссылается на неизвестный контекст ${c.ctx}`)
      for (const c of t.contexts) if (!t.cards.some((x) => x.ctx === c.id)) fail(`${projectId}/${t.id}: у контекста ${c.id} нет карточек`)
      const ref = referenceState(t)
      if (!partitionSolved(t, ref)) fail(`${projectId}/${t.id}: эталон не решает задачу`)
      if (reviewPartition(t, ref, 0).stars !== 3) fail(`${projectId}/${t.id}: эталон получает меньше трёх звёзд`)
      const one = { groups: [{ id: 'all', name: 'all' }], place: Object.fromEntries(t.cards.map((c) => [c.id, 'all'])) }
      if (partitionSolved(t, one)) fail(`${projectId}/${t.id}: всё в одном контексте считается решением`)
      const each = { groups: t.cards.map((c) => ({ id: c.id, name: c.id })), place: Object.fromEntries(t.cards.map((c) => [c.id, c.id])) }
      if (partitionSolved(t, each)) fail(`${projectId}/${t.id}: по контексту на карточку считается решением`)
      if (project && t.contexts.length !== project.modules.length) fail(`${projectId}/${t.id}: контекстов не столько же, сколько модулей`)
      // игрок назвал группу контекстом и подложил туда чужих стикеров больше, чем своих: «не на месте» — чужие,
      // и проверка не пишет «лежит в группе «X»… относится к «X»»
      for (const a of t.contexts) {
        const b = t.contexts.find((x) => x.id !== a.id && t.cards.filter((c) => c.ctx === x.id).length > t.cards.filter((c) => c.ctx === a.id).length)
        if (!b) continue
        const st = referenceState(t)
        for (const c of t.cards) if (c.ctx === b.id) st.place[c.id] = `g-${a.id}`
        st.groups = st.groups.filter((g) => g.id !== `g-${b.id}`)
        // wrong.has(a.id) — та самая несуразица «лежит в группе «X»… относится к «X»»: по данным, на любом языке
        const wrong = new Set(misplacedCards(t, st).map((c) => c.ctx))
        if (wrong.has(a.id) || !wrong.has(b.id)) fail(`${projectId}/${t.id}: в группе «${a.name}» не на месте названы не те стикеры`)
        break
      }
      // ложное узнавание: название упоминает контекст, но его стикеров в группе — меньшинство
      {
        const big = [...t.contexts].sort((x, y) => t.cards.filter((c) => c.ctx === y.id).length - t.cards.filter((c) => c.ctx === x.id).length)
        const [host, guest] = big
        const st = referenceState(t)
        const stray = t.cards.find((c) => c.ctx === guest.id)!
        st.place[stray.id] = `g-${host.id}`
        // как «Письма о заказах»: в названии — только чужой контекст, а его стикер в группе один
        st.groups = st.groups.map((g) => (g.id === `g-${host.id}` ? { ...g, name: `О: ${guest.name}` } : g))
        const wrong = misplacedCards(t, st).map((c) => c.id)
        if (wrong.length !== 1 || wrong[0] !== stray.id)
          fail(`${projectId}/${t.id}: группа «О: ${guest.name}» с одним стикером «${guest.name}» узнана по названию: не на месте ${wrong.length}`)
      }
      // лишнее слово в названии («Курьеры для заказов»): чужих стикеров даже больше трети, но группа — не их контекст
      {
        const big = [...t.contexts].sort((x, y) => t.cards.filter((c) => c.ctx === y.id).length - t.cards.filter((c) => c.ctx === x.id).length)
        const host = big[0]
        const guest = big.find((c) => c.id !== host.id && t.cards.filter((x) => x.ctx === c.id).length >= 2)
        if (guest && t.cards.filter((c) => c.ctx === host.id).length >= 3) {
          const st = referenceState(t)
          const moved = t.cards.filter((c) => c.ctx === guest.id).slice(0, 2)
          for (const c of moved) st.place[c.id] = `g-${host.id}`
          st.groups = st.groups.map((g) => (g.id === `g-${host.id}` ? { ...g, name: `Прочее ${guest.name}` } : g))
          const wrong = misplacedCards(t, st).map((c) => c.id).sort()
          if (wrong.join() !== moved.map((c) => c.id).sort().join())
            fail(`${projectId}/${t.id}: группа «Прочее ${guest.name}» узнана по названию: не на месте ${wrong.length}`)
        }
      }
      console.log(`- ${project?.title}: ${t.cards.length} карточек, ${t.contexts.length} контекстов`)
    } else {
      const ids = new Set(t.contexts.map((c) => c.id))
      for (const r of t.relations) if (!ids.has(r.upstream) || !ids.has(r.downstream)) fail(`${projectId}/${t.id}: связь ${r.id} ссылается на неизвестный контекст`)
      const answers = Object.fromEntries(t.relations.map((r) => [r.id, r.answer]))
      const sc = scoreMap(t, answers)
      if (sc.correct !== sc.total) fail(`${projectId}/${t.id}: эталон карты не сходится`)
      const used = new Set(t.relations.map((r) => r.answer))
      if (used.size !== Object.keys(MAP_PATTERNS).length) fail(`${projectId}/${t.id}: использованы не все паттерны (${used.size})`)
      console.log(`- ${project?.title}: карта контекстов, ${t.relations.length} связей`)
    }
  }
}

// Kubernetes: эталон решает, исходная конфигурация — нет; перебор всех комбинаций полей манифеста
console.log('\nKubernetes')
for (const t of K8S_TASKS) {
  const ok = (cfg: Record<string, string>) => {
    const r = runTask(t, cfg)
    return t.goals.every((g) => g.check(r.totals, cfg))
  }
  const combos = t.options.reduce<Record<string, string>[]>(
    (acc, o) => acc.flatMap((c) => o.choices.map((ch) => ({ ...c, [o.key]: ch.value }))),
    [{}],
  )
  const solving = combos.filter(ok)
  console.log(`- ${t.title}: решают ${solving.length} из ${combos.length} вариантов`)
  if (!ok(t.solution)) fail('эталон не выполняет цели')
  if (ok(t.start)) fail('задача решена уже в исходном состоянии')
  if (solving.length > combos.length / 2) fail('слишком много решений — задача не учит выбору')
}

// живой трафик распила: монолит без изменений работает без ошибок, эталоны миссий — почти без ошибок
console.log('\nЭмуляция трафика распила')
for (const p of PROJECTS) {
  const s0 = initialState(p)
  const m0 = computeMetrics(p, s0)
  let err0 = 0
  for (let i = 0; i < 300; i++) if (emulateMono(p, s0, m0).status === 'error') err0++
  if (err0) fail(`${p.title}: исходный монолит даёт ошибки (${err0} из 300)`)
  for (const mission of p.missions) {
    const s = solutionState(p, mission.solution)
    const m = computeMetrics(p, s)
    let err = 0
    for (let i = 0; i < 400; i++) {
      const t = emulateMono(p, s, m)
      if (t.status === 'error') err++
      if (t.spans.some((x) => !x.op)) fail(`${p.title} / ${mission.title}: спан без операции`)
    }
    if (err / 400 > 0.1) fail(`${p.title} / ${mission.title}: эталон даёт ${Math.round((err / 400) * 100)}% ошибок`)
  }
  console.log(`- ${p.title}: исходный монолит без ошибок, эталоны миссий стабильны`)
}

// живой трафик должен показывать то же, что предсказывает модель: доля ошибок в эмуляции ≈ модельной
console.log('\nЭмуляция трафика конструктора')
// что делают запросы клиента в живом трафике, разбирается по его названию — на всех языках одинаково.
// В подпись идёт правило, а не розыгрыш: домен при крайних значениях случая (0 и 0.99) — у сработавшего ключевого
// слова они совпадают, у клиента без ключевых слов видна развилка по умолчанию
{
  const rule = (n: BNode, w: Workload) => `${domainOf(n, w, () => 0)}/${domainOf(n, w, () => 0.99)}`
  const clients = [
    ...sandboxStart.nodes.map((n) => ({ where: 'песочница', n })),
    ...builderChallenges.flatMap((ch) => [
      ...ch.nodes.map((n) => ({ where: `${ch.id} старт`, n })),
      ...ch.solution.nodes.map((n) => ({ where: `${ch.id} эталон`, n })),
    ]),
  ].filter((x) => x.n.kind === 'client')
  for (const { where, n } of clients) signature.push(`домен ${where} / ${n.id}: ${rule(n, n.workload ?? 'oltp')}`)
  // клиент из палитры — с названием по умолчанию, на каждом профиле нагрузки
  const any = clients[0].n
  for (const w of Object.keys(WORKLOADS) as Workload[]) signature.push(`домен палитры / ${w}: ${rule({ ...any, label: KINDS.client.title }, w)}`)
}
for (const ch of builderChallenges) {
  for (const [name, g] of [['исходная', ch], ['эталон', ch.solution]] as const) {
    const r = simulate(g.nodes, g.edges)
    let ok = 0
    const N = 600
    for (let i = 0; i < N; i++) {
      const c = pickClient(g.nodes)
      const t = c && emulateRequest(g.nodes, g.edges, r, c.id)
      if (!t) throw new Error('эмуляция не вернула запрос')
      if (t.status === 'ok') ok++
      if (t.spans.some((s) => !s.op)) fail(`${ch.title} (${name}): блок без операции`)
    }
    const diff = Math.abs(ok / N - r.clientSuccess)
    if (diff > 0.1) fail(`${ch.title} (${name}): эмуляция ${(ok / N).toFixed(2)}, модель ${r.clientSuccess.toFixed(2)}`)
  }
}
console.log('- доля успешных запросов совпадает с моделью во всех задачах')

// проверки выше пишут ошибки в failed; итог — только после всех, иначе ошибка не остановит сборку
// вход по логину и паролю на Cloudflare Workers (worker/index.js)
console.log('\nВход по логину и паролю')
{
  const env = { AUTH_USER: 'Guest ', AUTH_PASSWORD: 'пароль: с двоеточием' }
  const asset = () => new Response('<html>', { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } })
  const call = (auth: string | null, e: Record<string, string> = env) =>
    guard(new Request('https://x.workers.dev/', { headers: auth ? { Authorization: auth } : {} }), e, async () => asset()) as Promise<Response>
  const basic = (user: string, pass: string) => 'Basic ' + Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')
  const none = await call(null)
  if (none.status !== 401 || !none.headers.get('WWW-Authenticate')?.startsWith('Basic')) fail(`без входа: ${none.status}`)
  if ((await call(basic('guest', 'не тот'))).status !== 401) fail('неверный пароль пропущен')
  if ((await call(basic('admin', env.AUTH_PASSWORD))).status !== 401) fail('чужой логин пропущен')
  if ((await call('Basic !!!')).status !== 401) fail('битый заголовок пропущен')
  const ok = await call(basic(' GUEST', env.AUTH_PASSWORD))
  if (ok.status !== 200 || (await ok.text()) !== '<html>') fail(`верный вход не пропущен: ${ok.status}`)
  if (ok.headers.get('X-Robots-Tag') !== 'noindex, nofollow') fail('за паролем нет noindex')
  if (!/^private\b/.test(ok.headers.get('Cache-Control') ?? '')) fail(`за паролем кэш не private: ${ok.headers.get('Cache-Control')}`)
  if ((await call(basic('', ''), { AUTH_USER: '', AUTH_PASSWORD: '' })).status !== 503) fail('без настроек сайт не закрыт')
  if ((await call(basic('team', 'guest:x'), { AUTH_USER: 'team:guest', AUTH_PASSWORD: 'x' })).status !== 503) fail('логин с двоеточием не отвергнут как ошибка настройки')
  // сам Worker: без входа файлы сборки не отдаются, с входом — отдаются из привязки ASSETS
  const served: string[] = []
  const assets = { fetch: async (r: Request) => (served.push(new URL(r.url).pathname), asset()) }
  const req = (auth?: string) => new Request('https://x.workers.dev/assets/index.js', { headers: auth ? { Authorization: auth } : {} })
  if ((await worker.fetch(req(), { ...env, ASSETS: assets })).status !== 401 || served.length) fail('Worker отдал файл сборки без входа')
  if ((await worker.fetch(req(basic('guest', env.AUTH_PASSWORD)), { ...env, ASSETS: assets })).status !== 200 || served[0] !== '/assets/index.js') fail('Worker не отдал файл после входа')
  // конфигурация Worker'а: без run_worker_first Cloudflare отдаёт файлы мимо Worker'а, без адресов версий — старые версии закрыты
  const { readFileSync } = await import('node:fs')
  // JSONC: комментарии и висячие запятые убираем (строк с // внутри в конфиге нет)
  const jsonc = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"])\/\/.*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1')
  let cfg: { main?: string; preview_urls?: boolean; assets?: { directory?: string; binding?: string; run_worker_first?: unknown } } = {}
  try {
    cfg = JSON.parse(jsonc)
  } catch (err) {
    fail(`wrangler.jsonc не читается: ${(err as Error).message}`)
  }
  if (cfg.assets?.run_worker_first !== true) fail('wrangler.jsonc: нет assets.run_worker_first: true — файлы сайта отдаются без пароля')
  if (cfg.preview_urls !== false) fail('wrangler.jsonc: адреса версий не выключены (preview_urls: false)')
  if (cfg.main !== 'worker/index.js' || cfg.assets?.directory !== './dist' || cfg.assets?.binding !== 'ASSETS') fail('wrangler.jsonc: Worker, папка сборки или привязка ASSETS не те')
  console.log('- без входа, с чужим логином, неверным паролем и битым заголовком — 401; верный вход — 200, noindex, private; без настроек или с двоеточием в логине — 503')
}

// разбор текста — подсказки на поле (по тексту целей: хранение, задержка) и домены клиентов — должен давать одно и то же на всех языках:
// каждый проход пишет подпись, последний сравнивает её с остальными
{
  const { readFileSync, writeFileSync, existsSync, rmSync } = await import('node:fs')
  const lang = process.env.BLUEPRINT_LANG ?? 'ru'
  // номер запуска npm run check — в имени файла: подписи одного запуска сравниваются только между собой,
  // а два npm run check в одной папке (параллельные сессии) друг другу не мешают
  const run = process.env.BLUEPRINT_RUN
  const file = (l: string) => new URL(`../.check-sig-${run}-${l}.txt`, import.meta.url)
  if (!run) {
    if (lang === 'zh') console.log('\nРазбор одинаков на всех языках\n- сверка пропущена: отдельный проход — полная проверка: npm run check')
  } else {
    // подписи запусков, прерванных до установки обработчика выхода (ошибка загрузки, Ctrl+C), — старше 10 минут — убрать
    const { readdirSync, statSync } = await import('node:fs')
    const root = new URL('../', import.meta.url)
    for (const f of readdirSync(root))
      if (/^\.check-sig-.+\.txt$/.test(f) && !f.startsWith(`.check-sig-${run}-`)) {
        // файл мог исчезнуть между readdir и stat: параллельный запуск убрал свой
        const st = statSync(new URL(f, root), { throwIfNoEntry: false })
        if (st && Date.now() - st.mtimeMs > 10 * 60_000) rmSync(new URL(f, root), { force: true })
      }
    writeFileSync(file(lang), signature.join('\n') + '\n')
  }
  if (run && lang === 'zh') {
    console.log('\nРазбор одинаков на всех языках')
    for (const other of ['ru', 'en']) {
      // внутри npm run check сверка обязана состояться: пропуск — ошибка, а не строчка в логе
      if (!existsSync(file(other))) {
        fail(`сверка с ${other} не состоялась: нет подписи ${other} этого запуска (например, BLUEPRINT_LANG задан на весь npm run check)`)
        continue
      }
      const theirs = readFileSync(file(other), 'utf8').trimEnd().split('\n')
      if (theirs.length !== signature.length) {
        fail(`разбор на zh и ${other}: разное число строк подписи (${signature.length} и ${theirs.length})`)
        continue
      }
      const diff = signature.map((_, i) => i).filter((i) => signature[i] !== theirs[i])
      for (const i of diff.slice(0, 5)) fail(`разбор на zh и ${other} различается: ${signature[i]} ↔ ${theirs[i]}`)
      if (!diff.length) console.log(`- zh = ${other}: ${signature.length} строк (подсказки на поле, домены клиентов)`)
    }
    for (const l of ['ru', 'en', 'zh']) rmSync(file(l), { force: true })
  }
}

if (failed) {
  console.log(`\nОшибок проверки: ${failed}`)
  process.exit(1)
}
console.log('\nВсе задачи решаемы')
