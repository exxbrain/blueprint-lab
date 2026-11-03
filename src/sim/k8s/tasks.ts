/**
 * Задачи по Kubernetes: инцидент, несколько полей манифеста на выбор, цели по итогам прогона.
 * У каждой задачи есть эталон; npm run check перебирает все комбинации.
 */
import { tr } from '../../i18n'
import { simulate, type AppSpec, type K8sRun, type NodeSpec, type Scenario, type Totals } from './engine'

export type K8sConfig = Record<string, string>

export interface K8sOption {
  key: string
  label: string
  /** Как поле выглядит в манифесте — показывается рядом */
  yaml: string
  choices: { value: string; label: string }[]
}

export interface K8sTask {
  id: string
  title: string
  level: 1 | 2 | 3 | 4
  brief: string[]
  options: K8sOption[]
  start: K8sConfig
  solution: K8sConfig
  build: (cfg: K8sConfig) => { app: AppSpec; sc: Scenario }
  goals: { text: string; check: (t: Totals, cfg: K8sConfig) => boolean }[]
  hints: string[]
  debrief: string[]
}

export function runTask(t: K8sTask, cfg: K8sConfig): K8sRun {
  const { app, sc } = t.build(cfg)
  return simulate(app, sc)
}

const app = (over: Partial<AppSpec>): AppSpec => ({
  replicas: 3,
  cpuReq: 500,
  cpuLimit: null,
  memReq: 512,
  memLimit: 512,
  readiness: 'http',
  liveness: 'none',
  hpa: null,
  strategy: 'rolling',
  maxSurge: 1,
  maxUnavailable: 0,
  canaryAnalysis: false,
  pdbMin: null,
  spread: 'host',
  ...over,
})

const nodes = (n: number, cpu = 4000, mem = 8192, zone = 'a'): NodeSpec[] =>
  Array.from({ length: n }, (_, i) => ({ id: `node-${i + 1}`, zone, cpu, mem }))

const flat = (rps: number) => () => rps
const pct = (x: number) => `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`
const errorsBelow = (limit: number) => ({
  text: tr(`Ошибок у клиентов меньше ${pct(limit)}`, `Client errors below ${pct(limit)}`),
  check: (t: Totals) => t.errorRate < limit,
})

// ---------------- Младший ----------------

const oom: K8sTask = {
  id: 'pod-restarts',
  title: tr('Под падает каждые пару минут', 'The pod keeps dying'),
  level: 1,
  brief: [
    tr(
      'Сервис на Java после переезда в Kubernetes постоянно перезапускается: в `kubectl get pods` растёт счётчик RESTARTS, а статус мигает `OOMKilled`. Приложению на деле нужно около **420 MiB** памяти.',
      'A Java service keeps restarting after moving to Kubernetes: the RESTARTS counter in `kubectl get pods` grows and the status flickers `OOMKilled`. The application actually needs about **420 MiB** of memory.',
    ),
    tr(
      'Подберите `resources` так, чтобы под жил, а кластер не держал под него лишнюю память впустую.',
      'Choose `resources` so the pod survives and the cluster does not reserve memory for it for nothing.',
    ),
  ],
  options: [
    {
      key: 'memLimit',
      label: tr('Лимит памяти', 'Memory limit'),
      yaml: 'resources.limits.memory',
      choices: ['256', '512', '2048'].map((v) => ({ value: v, label: `${v}Mi` })),
    },
    {
      key: 'memReq',
      label: tr('Запрос памяти', 'Memory request'),
      yaml: 'resources.requests.memory',
      choices: ['128', '512', '2048'].map((v) => ({ value: v, label: `${v}Mi` })),
    },
  ],
  start: { memLimit: '256', memReq: '128' },
  solution: { memLimit: '512', memReq: '512' },
  build: (c) => ({
    app: app({ memLimit: +c.memLimit, memReq: +c.memReq }),
    sc: { duration: 90, nodes: nodes(3), rps: flat(300), podRps: 200, podCpu: 400, startup: 10, portOpens: 2, versions: { v1: { mem: 420 }, v2: { mem: 420 } }, events: [] },
  }),
  goals: [
    { text: tr('Манифест валиден: request не больше limit', 'The manifest is valid: request is not above limit'), check: (_t, c) => +c.memReq <= +c.memLimit },
    { text: tr('Нет OOMKilled', 'No OOMKilled'), check: (t) => t.oomKills === 0 },
    errorsBelow(0.01),
    {
      text: tr('Request не меньше реального потребления, limit не больше 1 GiB', 'Request is at least the real usage, limit is at most 1 GiB'),
      check: (_t, c) => +c.memReq >= 420 && +c.memLimit <= 1024,
    },
  ],
  hints: [
    tr('limit — потолок: процесс, который за него вышел, ядро убивает (OOMKilled).', 'The limit is a ceiling: the kernel kills a process that goes above it (OOMKilled).'),
    tr('request — то, что планировщик резервирует на ноде. Меньше реального потребления — нода окажется переполненной.', 'The request is what the scheduler reserves on a node. Below the real usage and the node ends up overcommitted.'),
  ],
  debrief: [
    tr(
      'Для памяти правило простое: request = limit = реальное потребление с запасом. Память, в отличие от CPU, нельзя «притормозить»: превысил limit — процесс убит. А request ниже потребления даёт переполненные ноды и выселения под нагрузкой.',
      'For memory the rule is simple: request = limit = real usage plus headroom. Unlike CPU, memory cannot be throttled: exceed the limit and the process is killed. A request below the usage leads to overcommitted nodes and evictions under load.',
    ),
  ],
}

const readiness: K8sTask = {
  id: 'deploy-503',
  title: tr('503 на каждом деплое', '503s on every deploy'),
  level: 1,
  brief: [
    tr(
      'Каждый релиз пользователи ловят ошибки: Kubernetes отправляет запросы в новые поды, а приложению после старта нужно **20 секунд** на прогрев (кэши, пул соединений). Порт при этом открывается уже через 2 секунды.',
      'Users hit errors on every release: Kubernetes sends requests to new pods, but the application needs **20 seconds** after start to warm up (caches, connection pool). The port, however, opens after just 2 seconds.',
    ),
    tr('Выберите readiness-пробу.', 'Choose a readiness probe.'),
  ],
  options: [
    {
      key: 'readiness',
      label: 'readinessProbe',
      yaml: 'containers[].readinessProbe',
      choices: [
        { value: 'none', label: tr('нет пробы', 'no probe') },
        { value: 'tcp', label: 'tcpSocket: 8080' },
        { value: 'http', label: 'httpGet: /ready' },
      ],
    },
  ],
  start: { readiness: 'none' },
  solution: { readiness: 'http' },
  build: (c) => ({
    app: app({ replicas: 4, readiness: c.readiness as AppSpec['readiness'], maxSurge: 1, maxUnavailable: 1 }),
    sc: { duration: 150, nodes: nodes(6), rps: flat(400), podRps: 200, podCpu: 400, startup: 20, portOpens: 2, versions: { v1: { mem: 400 }, v2: { mem: 400 } }, events: [{ t: 20, type: 'deploy' }] },
  }),
  goals: [errorsBelow(0.005), { text: tr('Новая версия выкачена полностью', 'The new version is fully rolled out'), check: (t) => t.rolloutDone && t.finalVersion === 'v2' }],
  hints: [
    tr('Без readiness-пробы под считается готовым, как только запущен контейнер.', 'Without a readiness probe a pod counts as ready as soon as its container starts.'),
    tr('Открытый порт ещё не значит, что приложение может отвечать.', 'An open port does not yet mean the application can respond.'),
  ],
  debrief: [
    tr(
      'Readiness-проба решает, получает ли под трафик. Проверять надо то, что действительно означает «готов»: отдельный эндпоинт `/ready`, который отвечает 200 только после прогрева. TCP-проба лишь видит открытый порт.',
      'The readiness probe decides whether a pod receives traffic. Check what truly means “ready”: a dedicated `/ready` endpoint that returns 200 only after warm-up. A TCP probe only sees an open port.',
    ),
  ],
}

const crashloop: K8sTask = {
  id: 'release-down',
  title: tr('Выкатили — всё лежит', 'Deployed, and everything is down'),
  level: 1,
  brief: [
    tr(
      'В новой версии опечатка в конфиге: контейнер падает через 3 секунды после старта, и под уходит в `CrashLoopBackOff`. Вы этого пока не знаете — релиз запускается на 20-й секунде. Нагрузка — **450 rps**, один под держит 200.',
      'The new version has a config typo: the container crashes 3 seconds after start and the pod goes into `CrashLoopBackOff`. You do not know this yet; the release starts at second 20. Load is **450 rps**, one pod handles 200.',
    ),
    tr('Настройте стратегию выкатки так, чтобы неудачный релиз не уронил сервис.', 'Configure the rollout strategy so a bad release does not take the service down.'),
  ],
  options: [
    {
      key: 'strategy',
      label: tr('Стратегия', 'Strategy'),
      yaml: 'strategy.type',
      choices: [
        { value: 'recreate', label: 'Recreate' },
        { value: 'rolling', label: 'RollingUpdate' },
      ],
    },
    {
      key: 'maxUnavailable',
      label: 'maxUnavailable',
      yaml: 'strategy.rollingUpdate.maxUnavailable',
      choices: ['0', '1', '3'].map((v) => ({ value: v, label: v })),
    },
  ],
  start: { strategy: 'recreate', maxUnavailable: '1' },
  solution: { strategy: 'rolling', maxUnavailable: '0' },
  build: (c) => ({
    app: app({ strategy: c.strategy as AppSpec['strategy'], maxSurge: 1, maxUnavailable: +c.maxUnavailable }),
    sc: { duration: 120, nodes: nodes(4), rps: flat(450), podRps: 200, podCpu: 400, startup: 10, portOpens: 2, versions: { v1: { mem: 400 }, v2: { mem: 400, crash: true } }, events: [{ t: 20, type: 'deploy' }] },
  }),
  goals: [errorsBelow(0.01), { text: tr('Старые поды продолжают обслуживать клиентов', 'The old pods keep serving clients'), check: (t) => t.readyAtEnd >= 3 }],
  hints: [
    tr('Recreate сначала убивает все старые поды и только потом поднимает новые.', 'Recreate kills all old pods first and only then starts new ones.'),
    tr('Сколько старых подов можно потерять, пока новые не готовы? Трём подам и так впритык.', 'How many old pods can you lose while the new ones are not ready? Three pods are already barely enough.'),
  ],
  debrief: [
    tr(
      'RollingUpdate с `maxUnavailable: 0` не трогает старые поды, пока новые не прошли readiness. Сломанный релиз просто застревает (`ProgressDeadlineExceeded`), а сервис живёт на старой версии. Дальше — `kubectl rollout undo deployment/api`.',
      'RollingUpdate with `maxUnavailable: 0` does not touch old pods until new ones pass readiness. A broken release simply gets stuck (`ProgressDeadlineExceeded`), and the service keeps running the old version. Next step: `kubectl rollout undo deployment/api`.',
    ),
  ],
}

// ---------------- Средний ----------------

const liveness: K8sTask = {
  id: 'hung-pod',
  title: tr('Под завис, но жив', 'The pod hung but is still alive'),
  level: 2,
  brief: [
    tr(
      'На 20-й секунде один из трёх подов попадает в дедлок: процесс жив, порт открыт, но на запросы он не отвечает. Kubernetes считает его здоровым и продолжает слать ему треть трафика.',
      'At second 20 one of three pods deadlocks: the process is alive and the port is open, but it does not answer requests. Kubernetes thinks it is healthy and keeps sending it a third of the traffic.',
    ),
    tr('Настройте пробы так, чтобы клиенты почти не заметили сбой, а под вернулся в строй сам.', 'Configure probes so clients barely notice and the pod recovers on its own.'),
  ],
  options: [
    {
      key: 'readiness',
      label: 'readinessProbe',
      yaml: 'containers[].readinessProbe',
      choices: [
        { value: 'none', label: tr('нет', 'none') },
        { value: 'http', label: 'httpGet: /ready' },
      ],
    },
    {
      key: 'liveness',
      label: 'livenessProbe',
      yaml: 'containers[].livenessProbe',
      choices: [
        { value: 'none', label: tr('нет', 'none') },
        { value: 'tcp', label: 'tcpSocket: 8080' },
        { value: 'http', label: 'httpGet: /health' },
      ],
    },
  ],
  start: { readiness: 'none', liveness: 'none' },
  solution: { readiness: 'http', liveness: 'http' },
  build: (c) => ({
    app: app({ readiness: c.readiness as AppSpec['readiness'], liveness: c.liveness as AppSpec['liveness'] }),
    sc: { duration: 120, nodes: nodes(3), rps: flat(300), podRps: 200, podCpu: 400, startup: 10, portOpens: 2, versions: { v1: { mem: 400 }, v2: { mem: 400 } }, events: [{ t: 20, type: 'hang', count: 1 }] },
  }),
  goals: [
    errorsBelow(0.02),
    { text: tr('К концу все три реплики снова обслуживают трафик', 'By the end all three replicas serve traffic again'), check: (t) => t.readyAtEnd >= 3 },
  ],
  hints: [
    tr('Readiness убирает под из балансировки, но не лечит его. Liveness перезапускает.', 'Readiness removes a pod from load balancing but does not heal it. Liveness restarts it.'),
    tr('Зависшее приложение держит порт открытым.', 'A hung application keeps its port open.'),
  ],
  debrief: [
    tr(
      'Две пробы — две разные задачи. Readiness быстро выводит под из трафика, liveness перезапускает зависший процесс. Проверять надо поведение приложения (HTTP), а не открытый порт. И не делайте liveness тяжёлой: если она ходит в базу, падение базы перезапустит все поды разом.',
      'Two probes, two different jobs. Readiness quickly takes a pod out of traffic; liveness restarts a hung process. Check the application’s behaviour (HTTP), not an open port. And keep liveness light: if it touches the database, a database outage restarts every pod at once.',
    ),
  ],
}

const hpaRps = (t: number) => (t < 30 ? 300 : t < 90 ? 300 + ((t - 30) / 60) * 1100 : t < 160 ? 1400 : 300)

const hpa: K8sTask = {
  id: 'evening-peak',
  title: tr('Вечерний пик', 'The evening peak'),
  level: 2,
  brief: [
    tr(
      'Днём хватает трёх подов, а вечером за минуту нагрузка вырастает с **300 до 1400 rps** и держится час. Один под выдерживает 200 rps. Держать десять подов круглые сутки дорого.',
      'Three pods are enough during the day, but in the evening the load grows from **300 to 1400 rps** within a minute and stays there for an hour. One pod handles 200 rps. Keeping ten pods around the clock is expensive.',
    ),
  ],
  options: [
    {
      key: 'replicas',
      label: tr('Реплик', 'Replicas'),
      yaml: 'spec.replicas',
      choices: ['3', '10'].map((v) => ({ value: v, label: v })),
    },
    {
      key: 'hpa',
      label: 'HorizontalPodAutoscaler',
      yaml: 'autoscaling/v2 HPA',
      choices: [
        { value: 'off', label: tr('нет', 'none') },
        { value: 'on', label: tr('min 3, max 10, CPU 70%', 'min 3, max 10, CPU 70%') },
      ],
    },
  ],
  start: { replicas: '3', hpa: 'off' },
  solution: { replicas: '3', hpa: 'on' },
  build: (c) => ({
    app: app({ replicas: +c.replicas, spread: 'none', hpa: c.hpa === 'on' ? { min: 3, max: 10, target: 0.7 } : null }),
    sc: { duration: 240, nodes: nodes(4), rps: hpaRps, podRps: 200, podCpu: 400, startup: 10, portOpens: 2, versions: { v1: { mem: 400 }, v2: { mem: 400 } }, events: [] },
  }),
  goals: [errorsBelow(0.03), { text: tr('В среднем не больше 8 подов', 'No more than 8 pods on average'), check: (t) => t.avgPods <= 8 }],
  hints: [tr('Нагрузка меняется в течение дня — пусть и число подов меняется.', 'The load changes during the day, so let the pod count change too.')],
  debrief: [
    tr(
      'HPA раз в 15 секунд сравнивает загрузку CPU с целью и меняет число реплик. Цель 70%, а не 100%: новым подам нужно время на старт, запас покрывает рост, пока они поднимаются. Вниз HPA масштабирует осторожно — после нескольких минут низкой нагрузки.',
      'Every 15 seconds the HPA compares CPU utilisation with the target and changes the replica count. The target is 70%, not 100%: new pods need time to start, and the headroom covers growth while they come up. The HPA scales down cautiously, after several minutes of low load.',
    ),
  ],
}

const pending: K8sTask = {
  id: 'stuck-pods',
  title: tr('Поды висят в Pending', 'Pods stuck in Pending'),
  level: 2,
  brief: [
    tr(
      'Нужно 6 реплик на 1000 rps, но половина висит в `Pending`: «Insufficient cpu». На нодах по 3 ядра, и на каждой уже работает сервис соседней команды с request **1000m**, который при пиках съедает почти всё ядро. Ваш под на деле тратит около **400m** CPU.',
      'You need 6 replicas for 1000 rps, but half are stuck in `Pending`: “Insufficient cpu”. Nodes have 3 cores, and each already runs another team’s service with a **1000m** request that eats almost all the CPU at peaks. Your pod actually uses about **400m** CPU.',
    ),
  ],
  options: [
    {
      key: 'cpuReq',
      label: tr('Запрос CPU', 'CPU request'),
      yaml: 'resources.requests.cpu',
      choices: ['2000', '500', '100'].map((v) => ({ value: v, label: `${v}m` })),
    },
    {
      key: 'cpuLimit',
      label: tr('Лимит CPU', 'CPU limit'),
      yaml: 'resources.limits.cpu',
      choices: [
        { value: 'none', label: tr('нет', 'none') },
        { value: '500', label: '500m' },
        { value: '200', label: '200m' },
      ],
    },
  ],
  start: { cpuReq: '2000', cpuLimit: 'none' },
  solution: { cpuReq: '500', cpuLimit: '500' },
  build: (c) => ({
    app: app({ replicas: 6, spread: 'none', cpuReq: +c.cpuReq, cpuLimit: c.cpuLimit === 'none' ? null : +c.cpuLimit }),
    sc: {
      duration: 120,
      nodes: nodes(3, 3000),
      rps: flat(1000),
      podRps: 250,
      podCpu: 400,
      startup: 10,
      portOpens: 2,
      versions: { v1: { mem: 400 }, v2: { mem: 400 } },
      events: [],
      neighbor: { cpuDemand: 2800, cpuReq: 1000, cpuLimit: null, work: 1e12 },
    },
  }),
  goals: [
    { text: tr('Манифест валиден: request не больше limit', 'The manifest is valid: request is not above limit'), check: (_t, c) => c.cpuLimit === 'none' || +c.cpuReq <= +c.cpuLimit },
    { text: tr('Все поды запланированы', 'All pods are scheduled'), check: (t) => t.pendingMax === 0 },
    errorsBelow(0.01),
    { text: tr('p95 задержки меньше 200 мс', 'p95 latency below 200 ms'), check: (t) => t.p95 < 200 },
  ],
  hints: [
    tr('Планировщик смотрит только на requests, а не на реальное потребление.', 'The scheduler looks only at requests, not at real usage.'),
    tr('Когда процессора не хватает всем, ядро делит его пропорционально requests.', 'When there is not enough CPU for everyone, the kernel divides it in proportion to requests.'),
    tr('Лимит ниже реальной потребности — это троттлинг.', 'A limit below the real need means throttling.'),
  ],
  debrief: [
    tr(
      'Request CPU — это и место на ноде, и гарантированная доля процессора при конкуренции. Завышенный request оставляет поды в Pending, заниженный — отдаёт процессор соседу в пик. Лимит ниже реального потребления троттлит под даже на свободной ноде, поэтому многие команды для CPU лимит не ставят вовсе.',
      'A CPU request is both space on a node and a guaranteed share of CPU under contention. An inflated request leaves pods Pending; a deflated one gives the CPU away to a neighbour at peak. A limit below real usage throttles the pod even on an idle node, which is why many teams set no CPU limit at all.',
    ),
  ],
}

const rolling: K8sTask = {
  id: 'zero-downtime',
  title: tr('Релиз без простоя', 'A zero-downtime release'),
  level: 2,
  brief: [
    tr(
      'Четыре пода загружены на 80% (640 rps, под держит 200). Новая версия исправна, стартует 15 секунд, readiness настроена. Выкатите её так, чтобы никто не заметил, но не раздувая кластер больше чем на 2 пода сверх обычного.',
      'Four pods run at 80% (640 rps, a pod handles 200). The new version is fine, starts in 15 seconds, and readiness is configured. Roll it out so nobody notices, without growing the cluster by more than 2 pods above normal.',
    ),
  ],
  options: [
    {
      key: 'strategy',
      label: tr('Стратегия', 'Strategy'),
      yaml: 'strategy.type',
      choices: [
        { value: 'recreate', label: 'Recreate' },
        { value: 'rolling', label: 'RollingUpdate' },
      ],
    },
    { key: 'maxSurge', label: 'maxSurge', yaml: 'strategy.rollingUpdate.maxSurge', choices: ['0', '1', '2'].map((v) => ({ value: v, label: v })) },
    { key: 'maxUnavailable', label: 'maxUnavailable', yaml: 'strategy.rollingUpdate.maxUnavailable', choices: ['0', '1', '2'].map((v) => ({ value: v, label: v })) },
  ],
  start: { strategy: 'recreate', maxSurge: '0', maxUnavailable: '1' },
  solution: { strategy: 'rolling', maxSurge: '1', maxUnavailable: '0' },
  build: (c) => ({
    app: app({ replicas: 4, strategy: c.strategy as AppSpec['strategy'], maxSurge: +c.maxSurge, maxUnavailable: +c.maxUnavailable }),
    sc: { duration: 150, nodes: nodes(6), rps: flat(640), podRps: 200, podCpu: 400, startup: 15, portOpens: 2, versions: { v1: { mem: 400 }, v2: { mem: 400 } }, events: [{ t: 20, type: 'deploy' }] },
  }),
  goals: [
    {
      text: tr('Манифест валиден: maxSurge и maxUnavailable не оба нули', 'The manifest is valid: maxSurge and maxUnavailable are not both zero'),
      check: (_t, c) => c.strategy !== 'rolling' || +c.maxSurge + +c.maxUnavailable > 0,
    },
    errorsBelow(0.005),
    { text: tr('Новая версия выкачена полностью', 'The new version is fully rolled out'), check: (t) => t.rolloutDone && t.finalVersion === 'v2' },
    { text: tr('Не больше 6 подов одновременно', 'No more than 6 pods at once'), check: (t) => t.maxPods <= 6 },
  ],
  hints: [
    tr('maxUnavailable — сколько готовых подов можно потерять во время выкатки. Запаса у вас 20%.', 'maxUnavailable is how many ready pods you may lose during the rollout. You have 20% headroom.'),
    tr('maxSurge — сколько лишних подов можно поднять заранее.', 'maxSurge is how many extra pods may be started ahead of time.'),
  ],
  debrief: [
    tr(
      'Когда запаса мощности нет, выкатывают «сначала поднять, потом убрать»: `maxSurge: 1`, `maxUnavailable: 0`. Это медленнее, зато ёмкость не падает ни на секунду. `maxUnavailable` больше нуля подходит, когда у сервиса есть свободная мощность.',
      'When there is no spare capacity, roll out “start first, remove later”: `maxSurge: 1`, `maxUnavailable: 0`. It is slower, but capacity never drops for a second. `maxUnavailable` above zero is fine when the service has spare capacity.',
    ),
  ],
}

// ---------------- Старший ----------------

const nodeFailure: K8sTask = {
  id: 'node-died',
  title: tr('Упала нода', 'A node died'),
  level: 3,
  brief: [
    tr(
      'Кластер настроен упаковывать поды плотнее, чтобы экономить ноды, и все три реплики оказались на `node-1`. На 20-й секунде у неё сгорает блок питания. Нагрузка — 300 rps, под держит 200.',
      'The cluster is configured to pack pods tightly to save nodes, and all three replicas ended up on `node-1`. At second 20 its power supply burns out. Load is 300 rps, a pod handles 200.',
    ),
  ],
  options: [
    {
      key: 'spread',
      label: tr('Размещение', 'Placement'),
      yaml: 'affinity.podAntiAffinity',
      choices: [
        { value: 'none', label: tr('без правил', 'no rules') },
        { value: 'host', label: tr('разные ноды (hostname)', 'different nodes (hostname)') },
      ],
    },
    { key: 'replicas', label: tr('Реплик', 'Replicas'), yaml: 'spec.replicas', choices: ['3', '6'].map((v) => ({ value: v, label: v })) },
  ],
  start: { spread: 'none', replicas: '3' },
  solution: { spread: 'host', replicas: '3' },
  build: (c) => ({
    app: app({ replicas: +c.replicas, spread: c.spread as AppSpec['spread'] }),
    sc: {
      duration: 120,
      nodes: nodes(4),
      rps: flat(300),
      podRps: 200,
      podCpu: 400,
      startup: 10,
      portOpens: 2,
      versions: { v1: { mem: 400 }, v2: { mem: 400 } },
      events: [{ t: 20, type: 'node-down', node: 'node-1' }],
      initialNodes: c.spread === 'none' ? ['node-1'] : undefined,
    },
  }),
  goals: [errorsBelow(0.03), { text: tr('Не больше 4 реплик', 'No more than 4 replicas'), check: (_t, c) => +c.replicas <= 4 }],
  hints: [
    tr('Kubernetes выселяет поды с мёртвой ноды не сразу, а примерно через полминуты.', 'Kubernetes does not evict pods from a dead node right away, only after about half a minute.'),
    tr('Больше реплик на той же ноде не помогут.', 'More replicas on the same node will not help.'),
  ],
  debrief: [
    tr(
      'Реплики защищают от падения пода, но не ноды, если все они на одной машине. `podAntiAffinity` по `kubernetes.io/hostname` (или `topologySpreadConstraints`) разносит реплики по нодам: падение одной стоит трети мощности на несколько секунд, а не полминуты простоя.',
      'Replicas protect against a pod failure, but not a node failure if they all sit on one machine. `podAntiAffinity` on `kubernetes.io/hostname` (or `topologySpreadConstraints`) spreads replicas across nodes: losing one costs a third of capacity for a few seconds, not half a minute of downtime.',
    ),
  ],
}

const drain: K8sTask = {
  id: 'cluster-upgrade',
  title: tr('Обновление кластера', 'Cluster upgrade'),
  level: 3,
  brief: [
    tr(
      'Платформенная команда обновляет Kubernetes и выводит на обслуживание сразу **две ноды** (`kubectl drain node-1 node-2`). Реплики стоят на разных нодах. Нагрузка — 300 rps, под держит 200, есть свободные ноды под переезд.',
      'The platform team is upgrading Kubernetes and drains **two nodes** at once (`kubectl drain node-1 node-2`). Replicas sit on different nodes. Load is 300 rps, a pod handles 200, and there are free nodes to move to.',
    ),
    tr('Обслуживание должно завершиться, а клиенты — ничего не заметить.', 'The maintenance must complete, and clients must notice nothing.'),
  ],
  options: [
    { key: 'replicas', label: tr('Реплик', 'Replicas'), yaml: 'spec.replicas', choices: ['2', '3'].map((v) => ({ value: v, label: v })) },
    {
      key: 'pdb',
      label: 'PodDisruptionBudget',
      yaml: 'policy/v1 PodDisruptionBudget',
      choices: [
        { value: 'none', label: tr('нет', 'none') },
        { value: '1', label: 'minAvailable: 1' },
        { value: '2', label: 'minAvailable: 2' },
      ],
    },
  ],
  start: { replicas: '2', pdb: 'none' },
  solution: { replicas: '3', pdb: '2' },
  build: (c) => ({
    app: app({ replicas: +c.replicas, pdbMin: c.pdb === 'none' ? null : +c.pdb }),
    sc: { duration: 120, nodes: nodes(5), rps: flat(300), podRps: 200, podCpu: 400, startup: 10, portOpens: 2, versions: { v1: { mem: 400 }, v2: { mem: 400 } }, events: [{ t: 20, type: 'drain', nodes: ['node-1', 'node-2'] }] },
  }),
  goals: [errorsBelow(0.01), { text: tr('Обслуживание нод завершилось', 'Node maintenance completed'), check: (t) => t.drainDone }],
  hints: [
    tr('Drain уважает PodDisruptionBudget: не выселяет под, если после этого готовых останется меньше minAvailable.', 'Drain respects a PodDisruptionBudget: it will not evict a pod if fewer than minAvailable ready pods would remain.'),
    tr('PDB, который нельзя соблюсти, блокирует обслуживание навсегда.', 'A PDB that cannot be satisfied blocks maintenance forever.'),
  ],
  debrief: [
    tr(
      'PodDisruptionBudget — договор с платформой: «добровольно можно выключить столько-то подов». С `minAvailable: 2` из трёх drain выселяет по одному и ждёт, пока замена станет готовой. А PDB, равный числу реплик, — частая ошибка: обновление кластера зависает, и платформенной команде приходится удалять поды вручную.',
      'A PodDisruptionBudget is a contract with the platform: “you may voluntarily shut down this many pods”. With `minAvailable: 2` out of three, drain evicts one at a time and waits for the replacement to become ready. A PDB equal to the replica count is a common mistake: the cluster upgrade hangs, and the platform team has to delete pods by hand.',
    ),
  ],
}

const noisy: K8sTask = {
  id: 'night-report',
  title: tr('Шумный сосед', 'A noisy neighbour'),
  level: 3,
  brief: [
    tr(
      'Ночью на тех же нодах запускается расчёт отчётов (request **1500m**, без лимита), и задержки API взлетают. Отчёт должен успеть досчитаться, а API — отвечать быстро. Под API на деле тратит около 300m CPU.',
      'At night a report job starts on the same nodes (request **1500m**, no limit), and API latency skyrockets. The report must finish in time, and the API must stay fast. An API pod actually uses about 300m CPU.',
    ),
  ],
  options: [
    {
      key: 'apiReq',
      label: tr('Request CPU у API', 'API CPU request'),
      yaml: 'api: resources.requests.cpu',
      choices: ['100', '500'].map((v) => ({ value: v, label: `${v}m` })),
    },
    {
      key: 'jobLimit',
      label: tr('Лимит CPU у отчёта', 'Report CPU limit'),
      yaml: 'report-job: resources.limits.cpu',
      choices: [
        { value: 'none', label: tr('нет', 'none') },
        { value: '2500', label: '2500m' },
        { value: '1500', label: '1500m' },
      ],
    },
  ],
  start: { apiReq: '100', jobLimit: 'none' },
  solution: { apiReq: '500', jobLimit: '2500' },
  build: (c) => ({
    app: app({ replicas: 3, cpuReq: +c.apiReq }),
    sc: {
      duration: 120,
      nodes: nodes(3),
      rps: flat(450),
      podRps: 200,
      podCpu: 400,
      startup: 10,
      portOpens: 2,
      versions: { v1: { mem: 400 }, v2: { mem: 400 } },
      events: [],
      neighbor: { cpuDemand: 3900, cpuReq: 1500, cpuLimit: c.jobLimit === 'none' ? null : +c.jobLimit, work: 200000 },
    },
  }),
  goals: [
    errorsBelow(0.01),
    { text: tr('p95 задержки API меньше 200 мс', 'API p95 latency below 200 ms'), check: (t) => t.p95 < 200 },
    { text: tr('Отчёт досчитался', 'The report finished'), check: (t) => t.neighborDone },
  ],
  hints: [
    tr('Когда процессора не хватает, ядро делит его пропорционально requests.', 'When CPU is scarce, the kernel divides it in proportion to requests.'),
    tr('Лимит соседа защищает вас, но слишком жёсткий не даст ему закончить работу.', 'A limit on the neighbour protects you, but one that is too tight will not let it finish.'),
  ],
  debrief: [
    tr(
      'Изоляция в Kubernetes держится на requests и limits. Request даёт API гарантированную долю CPU, лимит на пакетную задачу не даёт ей съесть ноду целиком. Ещё лучше — отдельный пул нод для пакетных задач (taints и tolerations).',
      'Isolation in Kubernetes relies on requests and limits. A request gives the API a guaranteed CPU share; a limit on the batch job keeps it from eating the whole node. Better still is a separate node pool for batch jobs (taints and tolerations).',
    ),
  ],
}

// ---------------- Архитектор ----------------

const canary: K8sTask = {
  id: 'live-check',
  title: tr('Релиз с проверкой на живых пользователях', 'A release checked on live users'),
  level: 4,
  brief: [
    tr(
      'В новой версии баг, который не поймали тесты: **5% запросов** падают только на реальном трафике. Поды стартуют и проходят пробы нормально. Релиз на 20-й секунде.',
      'The new version has a bug the tests missed: **5% of requests** fail, but only on real traffic. Pods start and pass probes normally. The release starts at second 20.',
    ),
    tr('Выберите стратегию так, чтобы плохая версия не дошла до всех пользователей.', 'Choose a strategy so the bad version never reaches all users.'),
  ],
  options: [
    {
      key: 'strategy',
      label: tr('Стратегия', 'Strategy'),
      yaml: 'strategy',
      choices: [
        { value: 'rolling', label: 'RollingUpdate' },
        { value: 'canary', label: tr('Canary 10% (Argo Rollouts)', 'Canary 10% (Argo Rollouts)') },
      ],
    },
    {
      key: 'analysis',
      label: tr('Анализ метрик', 'Metric analysis'),
      yaml: 'analysis.templates',
      choices: [
        { value: 'off', label: tr('нет, просто пауза', 'none, just a pause') },
        { value: 'on', label: tr('доля ошибок < 1%, иначе откат', 'error rate < 1%, else roll back') },
      ],
    },
  ],
  start: { strategy: 'rolling', analysis: 'off' },
  solution: { strategy: 'canary', analysis: 'on' },
  build: (c) => ({
    app: app({ replicas: 4, strategy: c.strategy as AppSpec['strategy'], canaryAnalysis: c.analysis === 'on' }),
    sc: { duration: 150, nodes: nodes(6), rps: flat(400), podRps: 200, podCpu: 400, startup: 10, portOpens: 2, versions: { v1: { mem: 400 }, v2: { mem: 400, errorRate: 0.05 } }, events: [{ t: 20, type: 'deploy' }] },
  }),
  goals: [errorsBelow(0.01), { text: tr('Плохая версия не осталась в продакшене', 'The bad version did not stay in production'), check: (t) => t.finalVersion === 'v1' }],
  hints: [
    tr('Пробы такой баг не видят: под жив и отвечает, просто иногда ошибкой.', 'Probes cannot see this bug: the pod is alive and responding, just sometimes with an error.'),
    tr('Canary без автоматической проверки — это та же выкатка, только медленнее.', 'A canary without an automatic check is the same rollout, just slower.'),
  ],
  debrief: [
    tr(
      'Canary отправляет на новую версию малую долю трафика, а анализ метрик (доля ошибок, задержки) сам решает: продвигать или откатывать. Ценность не в доле трафика, а в автоматическом решении — человек на графиках не успеет.',
      'A canary sends a small share of traffic to the new version, and metric analysis (error rate, latency) decides on its own whether to promote or roll back. The value is not in the traffic share but in the automatic decision; a human watching dashboards will not be fast enough.',
    ),
  ],
}

const zoneNodes: NodeSpec[] = [
  { id: 'node-a1', zone: 'a', cpu: 4000, mem: 8192 },
  { id: 'node-a2', zone: 'a', cpu: 4000, mem: 8192 },
  { id: 'node-b1', zone: 'b', cpu: 4000, mem: 8192 },
  { id: 'node-c1', zone: 'c', cpu: 4000, mem: 8192 },
]

const zones: K8sTask = {
  id: 'zone-outage',
  title: tr('Отказ зоны доступности', 'An availability zone outage'),
  level: 4,
  brief: [
    tr(
      'Кластер растянут на три зоны облака: в зоне **a** две ноды, в **b** и **c** — по одной. На 30-й секунде зона **a** целиком пропадает. Нагрузка — 360 rps, под держит 200. Бюджет — не больше 3 подов в среднем.',
      'The cluster spans three cloud zones: zone **a** has two nodes, **b** and **c** have one each. At second 30 zone **a** disappears entirely. Load is 360 rps, a pod handles 200. Budget: no more than 3 pods on average.',
    ),
  ],
  options: [
    {
      key: 'spread',
      label: tr('Размещение', 'Placement'),
      yaml: 'topologySpreadConstraints',
      choices: [
        { value: 'none', label: tr('без правил', 'no rules') },
        { value: 'host', label: tr('по нодам (hostname)', 'by node (hostname)') },
        { value: 'zone', label: tr('по зонам (topology.kubernetes.io/zone)', 'by zone (topology.kubernetes.io/zone)') },
      ],
    },
    { key: 'replicas', label: tr('Реплик', 'Replicas'), yaml: 'spec.replicas', choices: ['3', '4'].map((v) => ({ value: v, label: v })) },
  ],
  start: { spread: 'none', replicas: '3' },
  solution: { spread: 'zone', replicas: '3' },
  build: (c) => ({
    app: app({ replicas: +c.replicas, spread: c.spread as AppSpec['spread'] }),
    sc: { duration: 120, nodes: zoneNodes, rps: flat(360), podRps: 200, podCpu: 400, startup: 10, portOpens: 2, versions: { v1: { mem: 400 }, v2: { mem: 400 } }, events: [{ t: 30, type: 'zone-down', zone: 'a' }] },
  }),
  goals: [errorsBelow(0.03), { text: tr('В среднем не больше 3 подов', 'No more than 3 pods on average'), check: (t) => t.avgPods <= 3.2 }],
  hints: [
    tr('Разнести по нодам — не то же самое, что разнести по зонам: в одной зоне может быть несколько нод.', 'Spreading across nodes is not the same as spreading across zones: one zone can hold several nodes.'),
  ],
  debrief: [
    tr(
      'Зона — домен отказа крупнее ноды: общая сеть, питание, иногда целый дата-центр. `topologySpreadConstraints` по `topology.kubernetes.io/zone` держит реплики равномерно по зонам, и потеря зоны стоит трети мощности. Считайте ёмкость на случай N−1 зоны: оставшиеся реплики должны выдержать нагрузку.',
      'A zone is a failure domain larger than a node: shared network, power, sometimes a whole data centre. `topologySpreadConstraints` on `topology.kubernetes.io/zone` keeps replicas evenly across zones, and losing a zone costs a third of capacity. Plan capacity for N−1 zones: the remaining replicas must carry the load.',
    ),
  ],
}

export const K8S_TASKS: K8sTask[] = [oom, readiness, crashloop, liveness, hpa, pending, rolling, nodeFailure, drain, noisy, canary, zones]
