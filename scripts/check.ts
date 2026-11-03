/**
 * Проверка решаемости: каждая задача должна решаться своим эталоном в своём бюджете
 * и не должна считаться решённой в исходном состоянии.
 * Запуск: npm run check
 */
import { PROJECTS } from '../src/sim/monolith/projects'
import { computeMetrics, evaluate, initialState, solutionState, stateCost } from '../src/sim/monolith/model'
import { reviewMission } from '../src/sim/monolith/review'
import { recommendedOrder, replay, reviewOrder } from '../src/sim/monolith/order'
import { builderChallenges, estimateOk } from '../src/sim/builder/challenges'
import { reaches, simulate } from '../src/sim/builder/model'
import { reviewBuilder } from '../src/sim/builder/review'
import { C4_EXERCISES } from '../src/sim/c4/exercises'
import { CANVAS, EL_H, EL_W, reviewDiagram } from '../src/sim/c4/model'
import { CAP_TASKS, runCap } from '../src/sim/cap/model'
import { STRESS_TESTS } from '../src/sim/monolith/patterns'
import { ES_TASKS } from '../src/sim/es/model'
import { emulateRequest, pickClient } from '../src/sim/builder/emulate'
import { DDD_STAGES } from '../src/sim/ddd/tasks'
import { emulateMono } from '../src/sim/monolith/emulate'
import { MAP_PATTERNS, partitionSolved, referenceState, reviewPartition, scoreMap } from '../src/sim/ddd/model'

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

// ловушки: обходные пути, которые не должны решать задачи
console.log('\nЛовушки конструктора')
{
  type N = (typeof builderChallenges)[number]['solution']['nodes']
  type E = (typeof builderChallenges)[number]['solution']['edges']
  const trap = (id: string, name: string, patch: (n: N, e: E) => [N, E]) => {
    const c = builderChallenges.find((x) => x.id === id)!
    const [nodes, edges] = patch(structuredClone(c.solution.nodes), structuredClone(c.solution.edges))
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
  trap('olap', 'без ClickHouse, PG×5', (n, e) => {
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
  trap('tickets', 'воркеров 8 — очередь растёт', (n, e) => [set(n, 'w1', { instances: 8 }), e])
  trap('tool-clickhouse', 'Elasticsearch вместо ClickHouse', (n, e) => [n.map((x) => (x.id === 'ch' ? { ...x, kind: 'elastic' as const } : x)), e])
  trap('tool-cassandra', 'MongoDB вместо Cassandra', (n, e) => [n.map((x) => (x.id === 'cs' ? { ...x, kind: 'mongo' as const, instances: 6 } : x)), e])
  trap('tool-cdn', 'S3 ×3 вместо CDN', (n) => [
    n.filter((x) => x.id !== 'cdn').map((x) => (x.id === 's3' ? { ...x, instances: 3 } : x)),
    [{ id: 'e1', from: 'c1', to: 's3' }],
  ])
  trap('tickets', 'Cassandra вместо PostgreSQL', (n, e) => [n.map((x) => (x.id === 'd1' ? { ...x, kind: 'cassandra' as const } : x)), e])
  console.log('- 13 ловушек не решают свои задачи')
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

// подсказки должны вести к решению через свойства, а не называть инструмент или паттерн
console.log('\nПодсказки без названий инструментов и паттернов')
{
  const tools = /redis|kafka|\bcdn\b|elasticsearch|clickhouse|cassandra|mongo|\bs3\b|кэш|кеш|\bcache|очеред|\bqueue|поисков\w* движ|search engine|колоночн|columnar|объектн\w* хранилищ|object storage|балансировщик|load balancer/i
  const patterns = /cqrs|event-driven|fan-out|\bsaga|\bсаг[аиуеой]|outbox|\bcdc\b|circuit|bulkhead|backoff|jitter|idempoten|идемпотент|canary|blue-green|tracing|трассировк|\bmtls\b|\bjwt\b|access token|\bbff\b|backend for frontend|service mesh|discovery|rate limit|anti-corruption|contract|контракт|event sourcing|cache-aside|read-through/i
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

if (failed) {
  console.log(`\nНерешаемых или сломанных задач: ${failed}`)
  process.exit(1)
}
console.log('\nВсе задачи решаемы')
