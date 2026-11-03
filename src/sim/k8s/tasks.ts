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
  text: tr(`Ошибок у клиентов меньше ${pct(limit)}`, `Client errors below ${pct(limit)}`, `客户端错误率低于 ${pct(limit)}`),
  check: (t: Totals) => t.errorRate < limit,
})

// ---------------- Младший ----------------

const oom: K8sTask = {
  id: 'pod-restarts',
  title: tr('Под падает каждые пару минут', 'The pod keeps dying', 'Pod 反复挂掉'),
  level: 1,
  brief: [
    tr(
      'Сервис на Java после переезда в Kubernetes постоянно перезапускается: в `kubectl get pods` растёт счётчик RESTARTS, а статус мигает `OOMKilled`. Приложению на деле нужно около **420 MiB** памяти.',
      'A Java service keeps restarting after moving to Kubernetes: the RESTARTS counter in `kubectl get pods` grows and the status flickers `OOMKilled`. The application actually needs about **420 MiB** of memory.',
      '一个 Java 服务迁移到 Kubernetes 后不停地重启：`kubectl get pods` 里的 RESTARTS 计数不断增长，状态时不时闪现 `OOMKilled`。应用实际需要大约 **420 MiB** 内存。',
    ),
    tr(
      'Подберите `resources` так, чтобы под жил, а кластер не держал под него лишнюю память впустую.',
      'Choose `resources` so the pod survives and the cluster does not reserve memory for it for nothing.',
      '请选择合适的 `resources`，让 Pod 能活下来，同时集群也不会白白为它预留内存。',
    ),
  ],
  options: [
    {
      key: 'memLimit',
      label: tr('Лимит памяти', 'Memory limit', '内存 limit'),
      yaml: 'resources.limits.memory',
      choices: ['256', '512', '2048'].map((v) => ({ value: v, label: `${v}Mi` })),
    },
    {
      key: 'memReq',
      label: tr('Запрос памяти', 'Memory request', '内存 request'),
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
    { text: tr('Манифест валиден: request не больше limit', 'The manifest is valid: request is not above limit', '清单有效：request 不大于 limit'), check: (_t, c) => +c.memReq <= +c.memLimit },
    { text: tr('Нет OOMKilled', 'No OOMKilled', '没有 OOMKilled'), check: (t) => t.oomKills === 0 },
    errorsBelow(0.01),
    {
      text: tr('Request не меньше реального потребления, limit не больше 1 GiB', 'Request is at least the real usage, limit is at most 1 GiB', 'request 不低于实际用量，limit 不超过 1 GiB'),
      check: (_t, c) => +c.memReq >= 420 && +c.memLimit <= 1024,
    },
  ],
  hints: [
    tr('limit — потолок: процесс, который за него вышел, ядро убивает (OOMKilled).', 'The limit is a ceiling: the kernel kills a process that goes above it (OOMKilled).', 'limit 是上限：进程一旦超过它，就会被内核杀掉（OOMKilled）。'),
    tr('request — то, что планировщик резервирует на ноде. Меньше реального потребления — нода окажется переполненной.', 'The request is what the scheduler reserves on a node. Below the real usage and the node ends up overcommitted.', 'request 是调度器在 Node 上预留的量。低于实际用量，Node 就会被超额分配（overcommit）。'),
  ],
  debrief: [
    tr(
      'Для памяти правило простое: request = limit = реальное потребление с запасом. Память, в отличие от CPU, нельзя «притормозить»: превысил limit — процесс убит. А request ниже потребления даёт переполненные ноды и выселения под нагрузкой.',
      'For memory the rule is simple: request = limit = real usage plus headroom. Unlike CPU, memory cannot be throttled: exceed the limit and the process is killed. A request below the usage leads to overcommitted nodes and evictions under load.',
      '内存的规则很简单：request = limit = 实际用量再加一些余量。与 CPU 不同，内存无法被限流：一旦超过 limit，进程就会被杀掉。而 request 低于实际用量，会导致 Node 超额分配，并在负载高时发生驱逐。',
    ),
  ],
}

const readiness: K8sTask = {
  id: 'deploy-503',
  title: tr('503 на каждом деплое', '503s on every deploy', '每次部署都报 503'),
  level: 1,
  brief: [
    tr(
      'Каждый релиз пользователи ловят ошибки: Kubernetes отправляет запросы в новые поды, а приложению после старта нужно **20 секунд** на прогрев (кэши, пул соединений). Порт при этом открывается уже через 2 секунды.',
      'Users hit errors on every release: Kubernetes sends requests to new pods, but the application needs **20 seconds** after start to warm up (caches, connection pool). The port, however, opens after just 2 seconds.',
      '每次发布用户都会遇到错误：Kubernetes 把请求发给新 Pod，但应用启动后需要 **20 秒**预热（缓存、连接池）。而端口在 2 秒后就已经打开了。',
    ),
    tr('Выберите readiness-пробу.', 'Choose a readiness probe.', '选择一个 readiness 探针。'),
  ],
  options: [
    {
      key: 'readiness',
      label: 'readinessProbe',
      yaml: 'containers[].readinessProbe',
      choices: [
        { value: 'none', label: tr('нет пробы', 'no probe', '不设探针') },
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
  goals: [errorsBelow(0.005), { text: tr('Новая версия выкачена полностью', 'The new version is fully rolled out', '新版本已全部发布完成'), check: (t) => t.rolloutDone && t.finalVersion === 'v2' }],
  hints: [
    tr('Без readiness-пробы под считается готовым, как только запущен контейнер.', 'Without a readiness probe a pod counts as ready as soon as its container starts.', '没有 readiness 探针时，只要容器一启动，Pod 就被视为就绪。'),
    tr('Открытый порт ещё не значит, что приложение может отвечать.', 'An open port does not yet mean the application can respond.', '端口打开并不代表应用已经能响应请求。'),
  ],
  debrief: [
    tr(
      'Readiness-проба решает, получает ли под трафик. Проверять надо то, что действительно означает «готов»: отдельный эндпоинт `/ready`, который отвечает 200 только после прогрева. TCP-проба лишь видит открытый порт.',
      'The readiness probe decides whether a pod receives traffic. Check what truly means “ready”: a dedicated `/ready` endpoint that returns 200 only after warm-up. A TCP probe only sees an open port.',
      'readiness 探针决定 Pod 是否接收流量。要检查真正代表“就绪”的东西：一个专门的 `/ready` 端点，只有在预热完成后才返回 200。TCP 探针只能看到端口是否打开。',
    ),
  ],
}

const crashloop: K8sTask = {
  id: 'release-down',
  title: tr('Выкатили — всё лежит', 'Deployed, and everything is down', '一发布，全挂了'),
  level: 1,
  brief: [
    tr(
      'В новой версии опечатка в конфиге: контейнер падает через 3 секунды после старта, и под уходит в `CrashLoopBackOff`. Вы этого пока не знаете — релиз запускается на 20-й секунде. Нагрузка — **450 rps**, один под держит 200.',
      'The new version has a config typo: the container crashes 3 seconds after start and the pod goes into `CrashLoopBackOff`. You do not know this yet; the release starts at second 20. Load is **450 rps**, one pod handles 200.',
      '新版本的配置里有个拼写错误：容器启动 3 秒后崩溃，Pod 进入 `CrashLoopBackOff`。你现在还不知道这一点；发布在第 20 秒开始。负载是 **450 rps**，一个 Pod 能扛 200。',
    ),
    tr('Настройте стратегию выкатки так, чтобы неудачный релиз не уронил сервис.', 'Configure the rollout strategy so a bad release does not take the service down.', '配置发布策略，让失败的发布不会把服务搞垮。'),
  ],
  options: [
    {
      key: 'strategy',
      label: tr('Стратегия', 'Strategy', '策略'),
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
  goals: [errorsBelow(0.01), { text: tr('Старые поды продолжают обслуживать клиентов', 'The old pods keep serving clients', '旧 Pod 继续为客户端提供服务'), check: (t) => t.readyAtEnd >= 3 }],
  hints: [
    tr('Recreate сначала убивает все старые поды и только потом поднимает новые.', 'Recreate kills all old pods first and only then starts new ones.', 'Recreate 会先杀掉所有旧 Pod，然后才启动新的。'),
    tr('Сколько старых подов можно потерять, пока новые не готовы? Трём подам и так впритык.', 'How many old pods can you lose while the new ones are not ready? Three pods are already barely enough.', '在新 Pod 就绪之前，你能失去几个旧 Pod？三个 Pod 本来就刚刚够用。'),
  ],
  debrief: [
    tr(
      'RollingUpdate с `maxUnavailable: 0` не трогает старые поды, пока новые не прошли readiness. Сломанный релиз просто застревает (`ProgressDeadlineExceeded`), а сервис живёт на старой версии. Дальше — `kubectl rollout undo deployment/api`. В задаче `progressDeadlineSeconds` сокращён до 60 с, по умолчанию он 600.',
      'RollingUpdate with `maxUnavailable: 0` does not touch old pods until new ones pass readiness. A broken release simply gets stuck (`ProgressDeadlineExceeded`), and the service keeps running the old version. Next step: `kubectl rollout undo deployment/api`. In this task `progressDeadlineSeconds` is cut to 60 s; the default is 600.',
      '使用 `maxUnavailable: 0` 的 RollingUpdate，在新 Pod 通过 readiness 检查之前不会动旧 Pod。坏掉的发布只会卡住（`ProgressDeadlineExceeded`），服务继续运行旧版本。下一步：`kubectl rollout undo deployment/api`。本任务中 `progressDeadlineSeconds` 被缩短为 60 s，默认值是 600。',
    ),
  ],
}

// ---------------- Средний ----------------

const liveness: K8sTask = {
  id: 'hung-pod',
  title: tr('Под завис, но жив', 'The pod hung but is still alive', 'Pod 卡死了，却还“活着”'),
  level: 2,
  brief: [
    tr(
      'На 20-й секунде один из трёх подов попадает в дедлок: процесс жив, порт открыт, но на запросы он не отвечает. Kubernetes считает его здоровым и продолжает слать ему треть трафика.',
      'At second 20 one of three pods deadlocks: the process is alive and the port is open, but it does not answer requests. Kubernetes thinks it is healthy and keeps sending it a third of the traffic.',
      '第 20 秒时，三个 Pod 中的一个陷入死锁：进程活着、端口开着，但不响应请求。Kubernetes 认为它是健康的，继续把三分之一的流量发给它。',
    ),
    tr('Настройте пробы так, чтобы клиенты почти не заметили сбой, а под вернулся в строй сам.', 'Configure probes so clients barely notice and the pod recovers on its own.', '配置探针，让客户端几乎察觉不到故障，并且 Pod 能自己恢复。'),
  ],
  options: [
    {
      key: 'readiness',
      label: 'readinessProbe',
      yaml: 'containers[].readinessProbe',
      choices: [
        { value: 'none', label: tr('нет', 'none', '无') },
        { value: 'http', label: 'httpGet: /ready' },
      ],
    },
    {
      key: 'liveness',
      label: 'livenessProbe',
      yaml: 'containers[].livenessProbe',
      choices: [
        { value: 'none', label: tr('нет', 'none', '无') },
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
    { text: tr('К концу все три реплики снова обслуживают трафик', 'By the end all three replicas serve traffic again', '到结束时，三个副本都重新开始处理流量'), check: (t) => t.readyAtEnd >= 3 },
  ],
  hints: [
    tr('Readiness убирает под из балансировки, но не лечит его. Liveness перезапускает.', 'Readiness removes a pod from load balancing but does not heal it. Liveness restarts it.', 'readiness 会把 Pod 从负载均衡中摘除，但不会治好它。liveness 会重启它。'),
    tr('Зависшее приложение держит порт открытым.', 'A hung application keeps its port open.', '卡死的应用依然开着端口。'),
  ],
  debrief: [
    tr(
      'Две пробы — две разные задачи. Readiness быстро выводит под из трафика, liveness перезапускает зависший процесс. Проверять надо поведение приложения (HTTP), а не открытый порт. И не делайте liveness тяжёлой: если она ходит в базу, падение базы перезапустит все поды разом.',
      'Two probes, two different jobs. Readiness quickly takes a pod out of traffic; liveness restarts a hung process. Check the application’s behaviour (HTTP), not an open port. And keep liveness light: if it touches the database, a database outage restarts every pod at once.',
      '两个探针，两种不同的职责。readiness 迅速把 Pod 从流量中摘除；liveness 重启卡死的进程。要检查应用的行为（HTTP），而不是端口是否打开。另外，liveness 要保持轻量：如果它会访问数据库，数据库一出故障，所有 Pod 就会同时被重启。',
    ),
  ],
}

const hpaRps = (t: number) => (t < 30 ? 300 : t < 90 ? 300 + ((t - 30) / 60) * 1100 : t < 160 ? 1400 : 300)

const hpa: K8sTask = {
  id: 'evening-peak',
  title: tr('Вечерний пик', 'The evening peak', '晚高峰'),
  level: 2,
  brief: [
    tr(
      'Днём хватает трёх подов, а вечером за минуту нагрузка вырастает с **300 до 1400 rps** и держится час. Один под выдерживает 200 rps. Держать десять подов круглые сутки дорого.',
      'Three pods are enough during the day, but in the evening the load grows from **300 to 1400 rps** within a minute and stays there for an hour. One pod handles 200 rps. Keeping ten pods around the clock is expensive.',
      '白天三个 Pod 就够了，但到了晚上，负载会在一分钟内从 **300 涨到 1400 rps**，并持续一个小时。一个 Pod 能扛 200 rps。全天候保留十个 Pod 太贵了。',
    ),
  ],
  options: [
    {
      key: 'replicas',
      label: tr('Реплик', 'Replicas', '副本数'),
      yaml: 'spec.replicas',
      choices: ['3', '10'].map((v) => ({ value: v, label: v })),
    },
    {
      key: 'hpa',
      label: 'HorizontalPodAutoscaler',
      yaml: 'autoscaling/v2 HPA',
      choices: [
        { value: 'off', label: tr('нет', 'none', '无') },
        { value: 'on', label: tr('min 3, max 10, CPU 70%', 'min 3, max 10, CPU 70%', 'min 3, max 10, CPU 70%') },
      ],
    },
  ],
  start: { replicas: '3', hpa: 'off' },
  solution: { replicas: '3', hpa: 'on' },
  build: (c) => ({
    app: app({ replicas: +c.replicas, spread: 'none', hpa: c.hpa === 'on' ? { min: 3, max: 10, target: 0.7 } : null }),
    sc: { duration: 240, nodes: nodes(4), rps: hpaRps, podRps: 200, podCpu: 400, startup: 10, portOpens: 2, versions: { v1: { mem: 400 }, v2: { mem: 400 } }, events: [] },
  }),
  goals: [errorsBelow(0.04), { text: tr('В среднем не больше 8 подов', 'No more than 8 pods on average', '平均不超过 8 个 Pod'), check: (t) => t.avgPods <= 8 }],
  hints: [tr('Нагрузка меняется в течение дня — пусть и число подов меняется.', 'The load changes during the day, so let the pod count change too.', '负载在一天中不断变化——那就让 Pod 数量也跟着变化。')],
  debrief: [
    tr(
      'HPA раз в 15 секунд сравнивает загрузку CPU с целью и меняет число реплик. Цель 70%, а не 100%: новым подам нужно время на старт, запас покрывает рост, пока они поднимаются. Вниз HPA масштабирует осторожно — после пяти минут низкой нагрузки (окно стабилизации).',
      'Every 15 seconds the HPA compares CPU utilisation with the target and changes the replica count. The target is 70%, not 100%: new pods need time to start, and the headroom covers growth while they come up. The HPA scales down cautiously, after five minutes of low load (the stabilization window).',
      'HPA 每 15 秒把 CPU 利用率与目标值比较一次，并调整副本数。目标是 70% 而不是 100%：新 Pod 启动需要时间，这部分余量可以在它们启动期间扛住增长。HPA 缩容很谨慎：要在低负载持续五分钟之后（稳定窗口）才会缩容。',
    ),
  ],
}

const pending: K8sTask = {
  id: 'stuck-pods',
  title: tr('Поды висят в Pending', 'Pods stuck in Pending', 'Pod 卡在 Pending'),
  level: 2,
  brief: [
    tr(
      'Нужно 6 реплик на 1000 rps, но половина висит в `Pending`: «Insufficient cpu». На нодах по 3 ядра, и на каждой уже работает сервис соседней команды с request **1000m**, который при пиках съедает почти всё ядро. Ваш под на деле тратит около **400m** CPU.',
      'You need 6 replicas for 1000 rps, but half are stuck in `Pending`: “Insufficient cpu”. Nodes have 3 cores, and each already runs another team’s service with a **1000m** request that eats almost all the CPU at peaks. Your pod actually uses about **400m** CPU.',
      '1000 rps 需要 6 个副本，但有一半卡在 `Pending`：“Insufficient cpu”。每个 Node 有 3 个核，并且每个 Node 上都已经运行着另一个团队的服务，它的 request 是 **1000m**，高峰时几乎吃光所有 CPU。你的 Pod 实际大约使用 **400m** CPU。',
    ),
  ],
  options: [
    {
      key: 'cpuReq',
      label: tr('Запрос CPU', 'CPU request', 'CPU request'),
      yaml: 'resources.requests.cpu',
      choices: ['2000', '500', '100'].map((v) => ({ value: v, label: `${v}m` })),
    },
    {
      key: 'cpuLimit',
      label: tr('Лимит CPU', 'CPU limit', 'CPU limit'),
      yaml: 'resources.limits.cpu',
      choices: [
        { value: 'none', label: tr('нет', 'none', '无') },
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
    { text: tr('Манифест валиден: request не больше limit', 'The manifest is valid: request is not above limit', '清单有效：request 不大于 limit'), check: (_t, c) => c.cpuLimit === 'none' || +c.cpuReq <= +c.cpuLimit },
    { text: tr('Все поды запланированы', 'All pods are scheduled', '所有 Pod 都已调度'), check: (t) => t.pendingMax === 0 },
    errorsBelow(0.01),
    { text: tr('p95 задержки меньше 200 мс', 'p95 latency below 200 ms', 'p95 延迟低于 200 ms'), check: (t) => t.p95 < 200 },
  ],
  hints: [
    tr('Планировщик смотрит только на requests, а не на реальное потребление.', 'The scheduler looks only at requests, not at real usage.', '调度器只看 requests，不看实际用量。'),
    tr('Когда процессора не хватает всем, ядро делит его пропорционально requests.', 'When there is not enough CPU for everyone, the kernel divides it in proportion to requests.', '当 CPU 不够所有人用时，内核按 requests 的比例来分配。'),
    tr('Лимит ниже реальной потребности — это троттлинг.', 'A limit below the real need means throttling.', 'limit 低于实际需求，就意味着限流（throttling）。'),
  ],
  debrief: [
    tr(
      'Request CPU — это и место на ноде, и гарантированная доля процессора при конкуренции. Завышенный request оставляет поды в Pending, заниженный — отдаёт процессор соседу в пик. Лимит ниже реального потребления троттлит под даже на свободной ноде, поэтому многие команды для CPU лимит не ставят вовсе.',
      'A CPU request is both space on a node and a guaranteed share of CPU under contention. An inflated request leaves pods Pending; a deflated one gives the CPU away to a neighbour at peak. A limit below real usage throttles the pod even on an idle node, which is why many teams set no CPU limit at all.',
      'CPU request 既是 Node 上的占位，也是资源争抢时有保证的 CPU 份额。request 设得过高，Pod 会停在 Pending；设得过低，高峰时 CPU 就会让给邻居。limit 低于实际用量时，即使 Node 空闲，Pod 也会被限流，所以很多团队干脆不给 CPU 设 limit。',
    ),
  ],
}

const rolling: K8sTask = {
  id: 'zero-downtime',
  title: tr('Релиз без простоя', 'A zero-downtime release', '零停机发布'),
  level: 2,
  brief: [
    tr(
      'Четыре пода загружены на 80% (640 rps, под держит 200). Новая версия исправна, стартует 15 секунд, readiness настроена. Выкатите её так, чтобы никто не заметил, но не раздувая кластер больше чем на 2 пода сверх обычного.',
      'Four pods run at 80% (640 rps, a pod handles 200). The new version is fine, starts in 15 seconds, and readiness is configured. Roll it out so nobody notices, without growing the cluster by more than 2 pods above normal.',
      '四个 Pod 的负载为 80%（640 rps，一个 Pod 能扛 200）。新版本没有问题，启动需要 15 秒，readiness 也已配置好。把它发布上线，既不能让任何人察觉，也不能让集群比平时多出 2 个以上的 Pod。',
    ),
  ],
  options: [
    {
      key: 'strategy',
      label: tr('Стратегия', 'Strategy', '策略'),
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
      text: tr('Манифест валиден: maxSurge и maxUnavailable не оба нули', 'The manifest is valid: maxSurge and maxUnavailable are not both zero', '清单有效：maxSurge 和 maxUnavailable 不能同时为 0'),
      check: (_t, c) => c.strategy !== 'rolling' || +c.maxSurge + +c.maxUnavailable > 0,
    },
    errorsBelow(0.005),
    { text: tr('Новая версия выкачена полностью', 'The new version is fully rolled out', '新版本已全部发布完成'), check: (t) => t.rolloutDone && t.finalVersion === 'v2' },
    { text: tr('Не больше 6 подов одновременно', 'No more than 6 pods at once', '同时不超过 6 个 Pod'), check: (t) => t.maxPods <= 6 },
  ],
  hints: [
    tr('maxUnavailable — сколько готовых подов можно потерять во время выкатки. Запаса у вас 20%.', 'maxUnavailable is how many ready pods you may lose during the rollout. You have 20% headroom.', 'maxUnavailable 表示发布期间最多可以失去多少个就绪的 Pod。你只有 20% 的余量。'),
    tr('maxSurge — сколько лишних подов можно поднять заранее.', 'maxSurge is how many extra pods may be started ahead of time.', 'maxSurge 表示可以提前多启动多少个 Pod。'),
  ],
  debrief: [
    tr(
      'Когда запаса мощности нет, выкатывают «сначала поднять, потом убрать»: `maxSurge: 1`, `maxUnavailable: 0`. Это медленнее, зато ёмкость не падает ни на секунду. `maxUnavailable` больше нуля подходит, когда у сервиса есть свободная мощность.',
      'When there is no spare capacity, roll out “start first, remove later”: `maxSurge: 1`, `maxUnavailable: 0`. It is slower, but capacity never drops for a second. `maxUnavailable` above zero is fine when the service has spare capacity.',
      '没有富余容量时，就按“先启动、再移除”的方式发布：`maxSurge: 1`、`maxUnavailable: 0`。这样更慢，但容量一秒钟都不会下降。当服务有富余容量时，`maxUnavailable` 大于 0 也没问题。',
    ),
  ],
}

// ---------------- Старший ----------------

const nodeFailure: K8sTask = {
  id: 'node-died',
  title: tr('Упала нода', 'A node died', '一个 Node 挂了'),
  level: 3,
  brief: [
    tr(
      'Кластер настроен упаковывать поды плотнее, чтобы экономить ноды, и все три реплики оказались на `node-1`. На 20-й секунде у неё сгорает блок питания. Нагрузка — 300 rps, под держит 200.',
      'The cluster is configured to pack pods tightly to save nodes, and all three replicas ended up on `node-1`. At second 20 its power supply burns out. Load is 300 rps, a pod handles 200.',
      '集群被配置为尽量紧凑地放置 Pod 以节省 Node，结果三个副本全都落在了 `node-1` 上。第 20 秒，它的电源烧了。负载是 300 rps，一个 Pod 能扛 200。',
    ),
  ],
  options: [
    {
      key: 'spread',
      label: tr('Размещение', 'Placement', '放置'),
      yaml: 'affinity.podAntiAffinity',
      choices: [
        { value: 'none', label: tr('без правил', 'no rules', '不设规则') },
        { value: 'host', label: tr('разные ноды (hostname)', 'different nodes (hostname)', '不同的 Node（hostname）') },
      ],
    },
    { key: 'replicas', label: tr('Реплик', 'Replicas', '副本数'), yaml: 'spec.replicas', choices: ['3', '6'].map((v) => ({ value: v, label: v })) },
  ],
  start: { spread: 'none', replicas: '3' },
  solution: { spread: 'host', replicas: '3' },
  build: (c) => ({
    app: app({ replicas: +c.replicas, spread: c.spread as AppSpec['spread'] }),
    sc: {
      duration: 400,
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
  goals: [errorsBelow(0.05), { text: tr('Не больше 4 реплик', 'No more than 4 replicas', '不超过 4 个副本'), check: (_t, c) => +c.replicas <= 4 }],
  hints: [
    tr('Kubernetes замечает мёртвую ноду через 40 секунд, а выселяет её поды только через 5 минут — всё это время замены нет.', 'Kubernetes notices a dead node after 40 seconds and evicts its pods only after 5 minutes; there is no replacement all that time.', 'Kubernetes 在 40 秒后才发现 Node 挂了，5 分钟后才会驱逐它上面的 Pod；在这段时间里没有任何替补。'),
    tr('Больше реплик на той же ноде не помогут.', 'More replicas on the same node will not help.', '在同一个 Node 上加更多副本没有用。'),
  ],
  debrief: [
    tr(
      'Реплики защищают от падения пода, но не ноды, если все они на одной машине. `podAntiAffinity` по `kubernetes.io/hostname` (или `topologySpreadConstraints`) разносит реплики по нодам. Отказ ноды Kubernetes замечает через 40 секунд (`node-monitor-grace-period`) — до этого треть запросов уходит в мёртвые поды, — а замену создаёт только через 5 минут (`tolerationSeconds: 300`). Поэтому реплик должно хватать на N−1: оставшиеся поды несут всю нагрузку эти минуты.',
      'Replicas protect against a pod failure, but not a node failure if they all sit on one machine. `podAntiAffinity` on `kubernetes.io/hostname` (or `topologySpreadConstraints`) spreads replicas across nodes. Kubernetes notices a node failure after 40 seconds (`node-monitor-grace-period`), and until then a third of requests go to dead pods; it creates replacements only after 5 minutes (`tolerationSeconds: 300`). So you need enough replicas for N−1: the remaining pods carry the whole load for those minutes.',
      '副本能防住 Pod 故障，但如果它们都在同一台机器上，就防不住 Node 故障。基于 `kubernetes.io/hostname` 的 `podAntiAffinity`（或 `topologySpreadConstraints`）会把副本分散到不同的 Node 上。Kubernetes 在 40 秒后才会发现 Node 故障（`node-monitor-grace-period`），在此之前三分之一的请求会发往已经死掉的 Pod；而替补要到 5 分钟后才会创建（`tolerationSeconds: 300`）。所以副本数要按 N−1 来准备：在这几分钟里，剩下的 Pod 要扛住全部负载。',
    ),
  ],
}

const drain: K8sTask = {
  id: 'cluster-upgrade',
  title: tr('Обновление кластера', 'Cluster upgrade', '集群升级'),
  level: 3,
  brief: [
    tr(
      'Платформенная команда обновляет Kubernetes и выводит на обслуживание сразу **две ноды** (`kubectl drain node-1 node-2`). Реплики стоят на разных нодах. Нагрузка — 300 rps, под держит 200, есть свободные ноды под переезд.',
      'The platform team is upgrading Kubernetes and drains **two nodes** at once (`kubectl drain node-1 node-2`). Replicas sit on different nodes. Load is 300 rps, a pod handles 200, and there are free nodes to move to.',
      '平台团队正在升级 Kubernetes，并同时 drain **两个 Node**（`kubectl drain node-1 node-2`）。副本分布在不同的 Node 上。负载是 300 rps，一个 Pod 能扛 200，并且有空闲的 Node 可供迁移。',
    ),
    tr('Обслуживание должно завершиться, а клиенты — ничего не заметить.', 'The maintenance must complete, and clients must notice nothing.', '维护必须完成，而客户端必须毫无察觉。'),
  ],
  options: [
    { key: 'replicas', label: tr('Реплик', 'Replicas', '副本数'), yaml: 'spec.replicas', choices: ['2', '3'].map((v) => ({ value: v, label: v })) },
    {
      key: 'pdb',
      label: 'PodDisruptionBudget',
      yaml: 'policy/v1 PodDisruptionBudget',
      choices: [
        { value: 'none', label: tr('нет', 'none', '无') },
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
  goals: [errorsBelow(0.01), { text: tr('Обслуживание нод завершилось', 'Node maintenance completed', 'Node 维护已完成'), check: (t) => t.drainDone }],
  hints: [
    tr('Drain уважает PodDisruptionBudget: не выселяет под, если после этого готовых останется меньше minAvailable.', 'Drain respects a PodDisruptionBudget: it will not evict a pod if fewer than minAvailable ready pods would remain.', 'drain 会遵守 PodDisruptionBudget：如果驱逐某个 Pod 后就绪的 Pod 会少于 minAvailable，它就不会驱逐。'),
    tr('PDB, который нельзя соблюсти, блокирует обслуживание навсегда.', 'A PDB that cannot be satisfied blocks maintenance forever.', '无法满足的 PDB 会让维护永远卡住。'),
  ],
  debrief: [
    tr(
      'PodDisruptionBudget — договор с платформой: «добровольно можно выключить столько-то подов». С `minAvailable: 2` из трёх drain выселяет по одному и ждёт, пока замена станет готовой. А PDB, равный числу реплик, — частая ошибка: обновление кластера зависает, и платформенной команде приходится удалять поды вручную.',
      'A PodDisruptionBudget is a contract with the platform: “you may voluntarily shut down this many pods”. With `minAvailable: 2` out of three, drain evicts one at a time and waits for the replacement to become ready. A PDB equal to the replica count is a common mistake: the cluster upgrade hangs, and the platform team has to delete pods by hand.',
      'PodDisruptionBudget 是与平台的约定：“可以主动关闭这么多个 Pod”。三个副本配 `minAvailable: 2` 时，drain 会一个一个地驱逐，并等待替补就绪。而 PDB 等于副本数是常见错误：集群升级会卡住，平台团队只能手动删除 Pod。',
    ),
  ],
}

const noisy: K8sTask = {
  id: 'night-report',
  title: tr('Шумный сосед', 'A noisy neighbour', '吵闹的邻居'),
  level: 3,
  brief: [
    tr(
      'Ночью на тех же нодах запускается расчёт отчётов (request **1500m**, без лимита), и задержки API взлетают. Отчёт должен успеть досчитаться, а API — отвечать быстро. Под API на деле тратит около 300m CPU.',
      'At night a report job starts on the same nodes (request **1500m**, no limit), and API latency skyrockets. The report must finish in time, and the API must stay fast. An API pod actually uses about 300m CPU.',
      '夜间，同一批 Node 上会启动一个报表计算任务（request **1500m**，不设 limit），API 的延迟随之飙升。报表必须按时算完，API 也必须保持快速响应。一个 API Pod 实际大约使用 300m CPU。',
    ),
  ],
  options: [
    {
      key: 'apiReq',
      label: tr('Request CPU у API', 'API CPU request', 'API 的 CPU request'),
      yaml: 'api: resources.requests.cpu',
      choices: ['100', '500'].map((v) => ({ value: v, label: `${v}m` })),
    },
    {
      key: 'jobLimit',
      label: tr('Лимит CPU у отчёта', 'Report CPU limit', '报表任务的 CPU limit'),
      yaml: 'report-job: resources.limits.cpu',
      choices: [
        { value: 'none', label: tr('нет', 'none', '无') },
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
    { text: tr('p95 задержки API меньше 200 мс', 'API p95 latency below 200 ms', 'API 的 p95 延迟低于 200 ms'), check: (t) => t.p95 < 200 },
    { text: tr('Отчёт досчитался', 'The report finished', '报表已算完'), check: (t) => t.neighborDone },
  ],
  hints: [
    tr('Когда процессора не хватает, ядро делит его пропорционально requests.', 'When CPU is scarce, the kernel divides it in proportion to requests.', 'CPU 紧张时，内核按 requests 的比例来分配。'),
    tr('Лимит соседа защищает вас, но слишком жёсткий не даст ему закончить работу.', 'A limit on the neighbour protects you, but one that is too tight will not let it finish.', '给邻居设 limit 能保护你，但设得太紧，它就完不成任务。'),
  ],
  debrief: [
    tr(
      'Изоляция в Kubernetes держится на requests и limits. Request даёт API гарантированную долю CPU, лимит на пакетную задачу не даёт ей съесть ноду целиком — здесь хватает любой из двух мер, а надёжнее обе. Ещё лучше — отдельный пул нод для пакетных задач (taints и tolerations).',
      'Isolation in Kubernetes relies on requests and limits. A request gives the API a guaranteed CPU share; a limit on the batch job keeps it from eating the whole node. Either measure is enough here, and both together are safer. Better still is a separate node pool for batch jobs (taints and tolerations).',
      'Kubernetes 中的隔离依靠 requests 和 limits。request 给 API 一份有保证的 CPU 份额；给批处理任务设 limit，能防止它吃掉整个 Node。这里任选其一就够了，两者都用更稳妥。更好的做法是为批处理任务单独准备一个 Node 池（taints 和 tolerations）。',
    ),
  ],
}

// ---------------- Архитектор ----------------

const canary: K8sTask = {
  id: 'live-check',
  title: tr('Релиз с проверкой на живых пользователях', 'A release checked on live users', '在真实用户身上验证的发布'),
  level: 4,
  brief: [
    tr(
      'В новой версии баг, который не поймали тесты: **5% запросов** падают только на реальном трафике. Поды стартуют и проходят пробы нормально. Релиз на 20-й секунде.',
      'The new version has a bug the tests missed: **5% of requests** fail, but only on real traffic. Pods start and pass probes normally. The release starts at second 20.',
      '新版本有一个测试没发现的 bug：**5% 的请求**会失败，但只在真实流量下出现。Pod 能正常启动并通过探针。发布在第 20 秒开始。',
    ),
    tr('Выберите стратегию так, чтобы плохая версия не дошла до всех пользователей.', 'Choose a strategy so the bad version never reaches all users.', '选择一种策略，让有问题的版本不会触达所有用户。'),
  ],
  options: [
    {
      key: 'strategy',
      label: tr('Стратегия', 'Strategy', '策略'),
      yaml: 'strategy',
      choices: [
        { value: 'rolling', label: 'RollingUpdate' },
        { value: 'canary', label: tr('Canary 10% (Argo Rollouts)', 'Canary 10% (Argo Rollouts)', 'Canary 10%（Argo Rollouts）') },
      ],
    },
    {
      key: 'analysis',
      label: tr('Анализ метрик', 'Metric analysis', '指标分析'),
      yaml: 'analysis.templates',
      choices: [
        { value: 'off', label: tr('нет, просто пауза', 'none, just a pause', '无，只暂停') },
        { value: 'on', label: tr('доля ошибок < 1%, иначе откат', 'error rate < 1%, else roll back', '错误率 < 1%，否则回滚') },
      ],
    },
  ],
  start: { strategy: 'rolling', analysis: 'off' },
  solution: { strategy: 'canary', analysis: 'on' },
  build: (c) => ({
    app: app({ replicas: 4, strategy: c.strategy as AppSpec['strategy'], canaryAnalysis: c.analysis === 'on' }),
    sc: { duration: 150, nodes: nodes(6), rps: flat(400), podRps: 200, podCpu: 400, startup: 10, portOpens: 2, versions: { v1: { mem: 400 }, v2: { mem: 400, errorRate: 0.05 } }, events: [{ t: 20, type: 'deploy' }] },
  }),
  goals: [errorsBelow(0.01), { text: tr('Плохая версия не осталась в продакшене', 'The bad version did not stay in production', '有问题的版本没有留在生产环境'), check: (t) => t.finalVersion === 'v1' }],
  hints: [
    tr('Пробы такой баг не видят: под жив и отвечает, просто иногда ошибкой.', 'Probes cannot see this bug: the pod is alive and responding, just sometimes with an error.', '探针看不到这种 bug：Pod 活着也能响应，只是偶尔返回错误。'),
    tr('Canary без автоматической проверки — это та же выкатка, только медленнее.', 'A canary without an automatic check is the same rollout, just slower.', '没有自动检查的 Canary，只是更慢的普通发布而已。'),
  ],
  debrief: [
    tr(
      'Canary отправляет на новую версию малую долю трафика, а анализ метрик (доля ошибок, задержки) сам решает: продвигать или откатывать. Ценность не в доле трафика, а в автоматическом решении — человек на графиках не успеет.',
      'A canary sends a small share of traffic to the new version, and metric analysis (error rate, latency) decides on its own whether to promote or roll back. The value is not in the traffic share but in the automatic decision; a human watching dashboards will not be fast enough.',
      'Canary（金丝雀发布）把一小部分流量发给新版本，由指标分析（错误率、延迟）自动决定是继续推进还是回滚。价值不在于流量比例，而在于自动决策：盯着监控面板的人是来不及反应的。',
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
  title: tr('Отказ зоны доступности', 'An availability zone outage', '可用区故障'),
  level: 4,
  brief: [
    tr(
      'Кластер растянут на три зоны облака: в зоне **a** две ноды, в **b** и **c** — по одной. Планировщик настроен упаковывать поды плотнее (MostAllocated), чтобы экономить ноды. На 30-й секунде зона **a** целиком пропадает. Нагрузка — 360 rps, под держит 200. Бюджет — не больше 3 подов в среднем.',
      'The cluster spans three cloud zones: zone **a** has two nodes, **b** and **c** have one each. The scheduler is configured to pack pods tightly (MostAllocated) to save nodes. At second 30 zone **a** disappears entirely. Load is 360 rps, a pod handles 200. Budget: no more than 3 pods on average.',
      '集群横跨云上的三个可用区：可用区 **a** 有两个 Node，**b** 和 **c** 各有一个。调度器被配置为尽量紧凑地放置 Pod（MostAllocated）以节省 Node。第 30 秒，可用区 **a** 整个消失了。负载是 360 rps，一个 Pod 能扛 200。预算：平均不超过 3 个 Pod。',
    ),
  ],
  options: [
    {
      key: 'spread',
      label: tr('Размещение', 'Placement', '放置'),
      yaml: 'topologySpreadConstraints',
      choices: [
        { value: 'none', label: tr('без правил', 'no rules', '不设规则') },
        { value: 'host', label: tr('по нодам (hostname)', 'by node (hostname)', '按 Node（hostname）') },
        { value: 'zone', label: tr('по зонам (topology.kubernetes.io/zone)', 'by zone (topology.kubernetes.io/zone)', '按可用区（topology.kubernetes.io/zone）') },
      ],
    },
    { key: 'replicas', label: tr('Реплик', 'Replicas', '副本数'), yaml: 'spec.replicas', choices: ['3', '4'].map((v) => ({ value: v, label: v })) },
  ],
  start: { spread: 'none', replicas: '3' },
  solution: { spread: 'zone', replicas: '3' },
  build: (c) => ({
    app: app({ replicas: +c.replicas, spread: c.spread as AppSpec['spread'] }),
    sc: { duration: 400, nodes: zoneNodes, rps: flat(360), podRps: 200, podCpu: 400, startup: 10, portOpens: 2, versions: { v1: { mem: 400 }, v2: { mem: 400 } }, events: [{ t: 30, type: 'zone-down', zone: 'a' }] },
  }),
  goals: [errorsBelow(0.05), { text: tr('В среднем не больше 3 подов', 'No more than 3 pods on average', '平均不超过 3 个 Pod'), check: (t) => t.avgPods <= 3.2 }],
  hints: [
    tr('Разнести по нодам — не то же самое, что разнести по зонам: в одной зоне может быть несколько нод.', 'Spreading across nodes is not the same as spreading across zones: one zone can hold several nodes.', '分散到不同 Node 不等于分散到不同可用区：一个可用区里可能有好几个 Node。'),
  ],
  debrief: [
    tr(
      'Зона — домен отказа крупнее ноды: общая сеть, питание, иногда целый дата-центр. `topologySpreadConstraints` по `topology.kubernetes.io/zone` держит реплики равномерно по зонам, и потеря зоны стоит трети мощности. Считайте ёмкость на случай N−1 зоны: оставшиеся реплики должны выдержать нагрузку.',
      'A zone is a failure domain larger than a node: shared network, power, sometimes a whole data centre. `topologySpreadConstraints` on `topology.kubernetes.io/zone` keeps replicas evenly across zones, and losing a zone costs a third of capacity. Plan capacity for N−1 zones: the remaining replicas must carry the load.',
      '可用区是比 Node 更大的故障域：共享网络、供电，有时是整个数据中心。基于 `topology.kubernetes.io/zone` 的 `topologySpreadConstraints` 让副本在各可用区间均匀分布，失去一个可用区只损失三分之一的容量。按 N−1 个可用区来规划容量：剩下的副本必须扛得住负载。',
    ),
  ],
}

export const K8S_TASKS: K8sTask[] = [oom, readiness, crashloop, liveness, hpa, pending, rolling, nodeFailure, drain, noisy, canary, zones]
