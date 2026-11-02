/**
 * Проверка решаемости: каждая задача должна решаться своим эталоном в своём бюджете
 * и не должна считаться решённой в исходном состоянии.
 * Запуск: npm run check
 */
import { PROJECTS } from '../src/sim/monolith/projects'
import { evaluate, initialState, solutionState, stateCost } from '../src/sim/monolith/model'
import { reviewMission } from '../src/sim/monolith/review'
import { recommendedOrder, replay, reviewOrder } from '../src/sim/monolith/order'
import { builderChallenges, estimateOk } from '../src/sim/builder/challenges'
import { reaches, simulate } from '../src/sim/builder/model'
import { reviewBuilder } from '../src/sim/builder/review'

let failed = 0
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
for (const c of builderChallenges) {
  const { nodes, edges } = c.solution
  const r = simulate(nodes, edges)
  const lat = Object.fromEntries(nodes.filter((x) => x.kind === 'client').map((x) => [x.label, Math.round(r.nodes[x.id].latency)]))
  console.log(`- ${c.title}: эталон $${r.cost} из $${c.budget}, успех ${(r.clientSuccess * 100).toFixed(2)}%, латентность ${JSON.stringify(lat)}, бэклог ${r.backlogGrowth.toFixed(0)}`)
  if (r.cost > c.budget) fail('эталон дороже бюджета')
  for (const g of c.goals) if (!g.check(r)) fail(`эталон не выполняет цель «${g.text}»`)
  for (const pth of c.paths) if (!reaches(edges, pth.from, pth.to)) fail(`эталон нарушает путь «${pth.text}»`)
  for (const id of c.locked) if (!nodes.some((x) => x.id === id)) fail(`в эталоне нет обязательного узла ${id}`)
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
  if (Math.abs(cache.clientSuccess - 0.8) > 1e-9) fail(`кэш без источника отвечает ${cache.clientSuccess}, а не долей попаданий`)
  const q = leaf('queue')
  if (q.backlogGrowth < 99) fail(`очередь без потребителей не копит сообщения: ${q.backlogGrowth}`)
  // cache-aside: сервис → Redis и сервис → БД; в БД доходят только промахи
  const aside = simulate(
    [
      client,
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
  console.log(`- шлюз ${gw.clientSuccess}, балансировщик ${lb.clientSuccess}, кэш ${cache.clientSuccess}, рост очереди ${q.backlogGrowth}/с`)
}

if (failed) {
  console.log(`\nНерешаемых или сломанных задач: ${failed}`)
  process.exit(1)
}
console.log('\nВсе задачи решаемы')
