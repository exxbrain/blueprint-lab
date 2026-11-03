/**
 * Посекундная модель кластера Kubernetes для одного Deployment «api».
 * Планировщик, жизненный цикл подов, пробы, контроллер Deployment (rolling, recreate, canary),
 * HPA, отказ ноды и зоны, drain с PodDisruptionBudget, конкуренция за CPU с соседом.
 * События пишутся в формате `kubectl get events`.
 */

export type Version = 'v1' | 'v2'
export type Probe = 'none' | 'tcp' | 'http'
export type Strategy = 'rolling' | 'recreate' | 'canary'
export type Spread = 'none' | 'host' | 'zone'

export interface AppSpec {
  replicas: number
  /** CPU, милликоры */
  cpuReq: number
  cpuLimit: number | null
  /** Память, MiB */
  memReq: number
  memLimit: number
  readiness: Probe
  liveness: Probe
  hpa: { min: number; max: number; target: number } | null
  strategy: Strategy
  maxSurge: number
  maxUnavailable: number
  /** Canary: автоматический анализ ошибок и откат */
  canaryAnalysis: boolean
  pdbMin: number | null
  spread: Spread
}

export interface NodeSpec {
  id: string
  zone: string
  cpu: number
  mem: number
}

export interface VersionSpec {
  /** Падает при старте (ошибка конфигурации) */
  crash?: boolean
  /** Реальное потребление памяти, MiB */
  mem: number
  /** Доля ошибок в ответах этой версии */
  errorRate?: number
}

export type ClusterEvent =
  | { t: number; type: 'deploy' }
  | { t: number; type: 'node-down'; node: string }
  | { t: number; type: 'zone-down'; zone: string }
  | { t: number; type: 'drain'; nodes: string[] }
  | { t: number; type: 'hang'; count: number }

export interface Scenario {
  duration: number
  nodes: NodeSpec[]
  rps: (t: number) => number
  /** Сколько rps выдерживает готовый под при полном CPU */
  podRps: number
  /** Сколько CPU нужно поду при полной нагрузке, милликоры */
  podCpu: number
  /** Через сколько секунд после старта контейнера приложение готово отвечать */
  startup: number
  /** Через сколько секунд открывается порт (TCP-проба уже проходит, а приложение ещё прогревается) */
  portOpens: number
  versions: Record<Version, VersionSpec>
  events: ClusterEvent[]
  /** Исходные поды уже стоят на этих нодах (по кругу); иначе их расставляет планировщик */
  initialNodes?: string[]
  /** Сосед на каждой ноде: ночной пакетный расчёт */
  neighbor?: { cpuDemand: number; cpuReq: number; cpuLimit: number | null; work: number }
}

export type Phase = 'Pending' | 'ContainerCreating' | 'Running' | 'Ready' | 'CrashLoopBackOff' | 'Terminating' | 'Unknown'

export interface PodView {
  name: string
  version: Version
  node: string | null
  phase: Phase
  /** Получает ли трафик (в endpoints сервиса) */
  inService: boolean
  /** Отвечает ли на самом деле */
  healthy: boolean
  hung: boolean
  restarts: number
  reason?: string
}

export interface NodeView {
  id: string
  zone: string
  up: boolean
  cordoned: boolean
  cpu: number
  cpuReq: number
  mem: number
  memReq: number
}

export interface Frame {
  t: number
  pods: PodView[]
  nodes: NodeView[]
  rps: number
  ok: number
  failed: number
  latency: number
  desired: number
}

export interface KEvent {
  t: number
  type: 'Normal' | 'Warning'
  reason: string
  object: string
  message: string
}

export interface Totals {
  requests: number
  failed: number
  errorRate: number
  /** Секунд, когда падало больше половины запросов */
  downtime: number
  p95: number
  avgPods: number
  maxPods: number
  oomKills: number
  restarts: number
  /** Дольше всех под провисел в Pending, с */
  pendingMax: number
  rolloutDone: boolean
  finalVersion: Version | 'mixed'
  drainDone: boolean
  neighborDone: boolean
  readyAtEnd: number
  desiredAtEnd: number
  canaryAborted: boolean
}

export interface K8sRun {
  frames: Frame[]
  events: KEvent[]
  totals: Totals
}

interface Pod {
  name: string
  version: Version
  node: string | null
  phase: Phase
  /** Когда контейнер последний раз запущен */
  started: number
  created: number
  restarts: number
  nextRestart: number
  hung: boolean
  hungSince: number
  reason?: string
  terminateAt: number
  lostAt: number
  canary?: boolean
}

const HASH: Record<Version, string> = { v1: '7d9f8c', v2: '5c6b4f' }
const NODE_GRACE = 30 // через сколько секунд поды с упавшей ноды выселяются
const ENDPOINT_LAG = 8 // через сколько секунд поды упавшей ноды пропадают из endpoints
const BASE_LATENCY = 40

function seeded(n: number) {
  let x = n >>> 0 || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return ((x >>> 0) % 100000) / 100000
  }
}

export function simulate(app: AppSpec, sc: Scenario): K8sRun {
  const rnd = seeded(42)
  const suffix = () => Array.from({ length: 5 }, () => 'bcdfghjklmnpqrstvwxz2456789'[Math.floor(rnd() * 27)]).join('')
  const events: KEvent[] = []
  const ev = (t: number, type: KEvent['type'], reason: string, object: string, message: string) => events.push({ t, type, reason, object, message })
  const frames: Frame[] = []

  const nodes = sc.nodes.map((n) => ({ ...n, up: true, cordoned: false, downAt: -1 }))
  const nodeById = (id: string) => nodes.find((n) => n.id === id)!
  let pods: Pod[] = []
  let target: Version = 'v1'
  let rollout: 'none' | 'rolling' | 'recreate' | 'canary' = 'none'
  let rolloutStart = 0
  let deadlineReported = false
  let canaryAborted = false
  let canaryUntil = 0
  let desired = app.hpa ? Math.max(app.hpa.min, app.replicas) : app.replicas
  let lowSince = -1
  const drainNodes = new Set<string>()
  let drainDone = true
  let lastPdbWarn = -100
  let neighborWork = 0
  const pendingSince = new Map<string, number>()
  let pendingMax = 0
  let oomKills = 0
  let restartsTotal = 0
  let requests = 0
  let failedTotal = 0
  let downtime = 0
  const lat: number[] = []
  let podSeconds = 0
  let maxPods = 0

  const newPod = (v: Version, t: number, canary = false): Pod => {
    const p: Pod = { name: `api-${HASH[v]}-${suffix()}`, version: v, node: null, phase: 'Pending', started: -1, created: t, restarts: 0, nextRestart: -1, hung: false, hungSince: -1, terminateAt: -1, lostAt: -1, canary }
    pods.push(p)
    return p
  }
  const alive = (p: Pod) => p.phase !== 'Terminating'
  const startContainer = (p: Pod, t: number) => {
    p.phase = 'Running'
    p.started = t
    p.hung = false
  }
  const terminate = (p: Pod, t: number, why = 'Stopping container api') => {
    if (p.phase === 'Terminating') return
    p.phase = 'Terminating'
    p.terminateAt = t + 2
    ev(t, 'Normal', 'Killing', `pod/${p.name}`, why)
  }

  // исходные поды
  for (let i = 0; i < desired; i++) {
    const p = newPod('v1', -60)
    if (sc.initialNodes?.length) {
      p.node = sc.initialNodes[i % sc.initialNodes.length]
    } else {
      p.node = schedule(p)
    }
    if (p.node) {
      startContainer(p, -60)
      p.phase = 'Ready'
    }
  }

  function nodeReq(id: string) {
    let cpu = sc.neighbor ? sc.neighbor.cpuReq : 0
    let mem = 0
    for (const p of pods) if (p.node === id && alive(p)) {
      cpu += app.cpuReq
      mem += app.memReq
    }
    return { cpu, mem }
  }

  function schedule(p: Pod): string | null {
    const fits = nodes.filter((n) => {
      if (!n.up || n.cordoned) return false
      const r = nodeReq(n.id)
      return r.cpu + app.cpuReq <= n.cpu && r.mem + app.memReq <= n.mem
    })
    if (!fits.length) return null
    const appOn = (id: string) => pods.filter((x) => x !== p && x.node === id && alive(x) && x.phase !== 'Unknown').length
    if (app.spread === 'host') {
      const free = fits.filter((n) => appOn(n.id) === 0)
      return free[0]?.id ?? null
    }
    if (app.spread === 'zone') {
      const zones = [...new Set(nodes.filter((n) => n.up).map((n) => n.zone))]
      const inZone = (z: string) => pods.filter((x) => x !== p && alive(x) && x.phase !== 'Unknown' && x.node && nodeById(x.node).zone === z).length
      const min = Math.min(...zones.map(inZone))
      const ok = fits.filter((n) => inZone(n.zone) <= min).sort((a, b) => appOn(a.id) - appOn(b.id))
      return ok[0]?.id ?? null
    }
    // без правил: упаковка на первую подходящую ноду (MostAllocated экономит ноды)
    return fits[0].id
  }

  const servesTraffic = (p: Pod, t: number) => {
    if (!p.node) return false
    const n = nodeById(p.node)
    if (p.phase === 'Unknown') return t - p.lostAt < ENDPOINT_LAG
    if (!n.up) return false
    if (p.phase === 'Ready') return !(app.readiness === 'http' && p.hung && t - p.hungSince >= 5)
    if (p.phase === 'Running') {
      if (app.readiness === 'none') return true
      if (app.readiness === 'tcp') return t - p.started >= sc.portOpens
      return false
    }
    return false
  }
  const healthy = (p: Pod) => p.phase === 'Ready' && !p.hung && !!p.node && nodeById(p.node).up

  for (let t = 0; t <= sc.duration; t++) {
    // ---- события сценария
    for (const e of sc.events.filter((x) => x.t === t)) {
      if (e.type === 'deploy') {
        target = 'v2'
        rolloutStart = t
        rollout = app.strategy
        ev(t, 'Normal', 'ScalingReplicaSet', 'deployment/api', `Scaled up replica set api-${HASH.v2} to ${app.strategy === 'canary' ? 1 : app.strategy === 'recreate' ? 0 : Math.min(desired, app.maxSurge || 1)}`)
        if (rollout === 'recreate') for (const p of pods.filter((x) => x.version === 'v1')) terminate(p, t)
        if (rollout === 'canary') {
          newPod('v2', t, true)
          canaryUntil = t + 35
        }
      }
      if (e.type === 'node-down' || e.type === 'zone-down') {
        const down = e.type === 'node-down' ? [nodeById(e.node)] : nodes.filter((n) => n.zone === e.zone)
        for (const n of down) {
          n.up = false
          n.downAt = t
          ev(t, 'Warning', 'NodeNotReady', `node/${n.id}`, `Node ${n.id} status is now: NodeNotReady`)
          for (const p of pods.filter((x) => x.node === n.id && alive(x))) {
            p.phase = 'Unknown'
            p.lostAt = t
          }
        }
      }
      if (e.type === 'drain') {
        for (const id of e.nodes) {
          drainNodes.add(id)
          nodeById(id).cordoned = true
          ev(t, 'Normal', 'NodeNotSchedulable', `node/${id}`, `Node ${id} status is now: NodeNotSchedulable`)
        }
        drainDone = false
      }
      if (e.type === 'hang') {
        const ready = pods.filter((p) => p.phase === 'Ready' && !p.hung).slice(0, e.count)
        for (const p of ready) {
          p.hung = true
          p.hungSince = t
        }
      }
    }

    // ---- выселение подов с упавших нод
    for (const p of pods.filter((x) => x.phase === 'Unknown' && t - x.lostAt >= NODE_GRACE)) {
      ev(t, 'Normal', 'TaintManagerEviction', `pod/${p.name}`, 'Marking for deletion Pod default/' + p.name)
      pods = pods.filter((x) => x !== p)
    }

    // ---- drain с учётом PDB
    if (drainNodes.size) {
      const onDrained = pods.filter((p) => p.node && drainNodes.has(p.node) && alive(p))
      if (!onDrained.length) {
        if (!drainDone) for (const id of drainNodes) ev(t, 'Normal', 'NodeDrained', `node/${id}`, `Node ${id} drained, ready for upgrade`)
        drainDone = true
        drainNodes.clear()
      } else {
        for (const p of onDrained) {
          const readyNow = pods.filter((x) => healthy(x)).length
          const allowed = app.pdbMin === null || readyNow - (healthy(p) ? 1 : 0) >= app.pdbMin
          if (allowed) {
            ev(t, 'Normal', 'Evicted', `pod/${p.name}`, `Evicting pod for node drain`)
            terminate(p, t, 'Stopping container api (evicted)')
          } else if (t - lastPdbWarn >= 10) {
            lastPdbWarn = t
            ev(t, 'Warning', 'EvictionBlocked', `pod/${p.name}`, "Cannot evict pod as it would violate the pod's disruption budget.")
          }
        }
      }
    }

    // ---- жизненный цикл подов
    for (const p of pods) {
      if (p.phase === 'Terminating' && t >= p.terminateAt) p.node = null
      if (p.phase === 'ContainerCreating' && t - p.created >= 2) {
        startContainer(p, t)
        ev(t, 'Normal', 'Started', `pod/${p.name}`, 'Started container api')
      }
      if (p.phase === 'CrashLoopBackOff' && t >= p.nextRestart) startContainer(p, t)
      if (p.phase === 'Running' || p.phase === 'Ready') {
        const vs = sc.versions[p.version]
        const up = t - p.started
        if (vs.crash && up >= 3) {
          p.phase = 'CrashLoopBackOff'
          p.reason = 'Error'
          p.restarts++
          restartsTotal++
          p.nextRestart = t + Math.min(10 * 2 ** (p.restarts - 1), 40)
          ev(t, 'Warning', 'BackOff', `pod/${p.name}`, `Back-off restarting failed container api in pod ${p.name}_default`)
          continue
        }
        if (vs.mem > app.memLimit && up >= 6) {
          p.phase = 'CrashLoopBackOff'
          p.reason = 'OOMKilled'
          p.restarts++
          restartsTotal++
          oomKills++
          p.nextRestart = t + Math.min(10 * 2 ** (p.restarts - 1), 40)
          ev(t, 'Warning', 'OOMKilling', `node/${p.node}`, `Memory cgroup out of memory: Killed process (java) total-vm:${vs.mem}MiB, limit ${app.memLimit}Mi`)
          continue
        }
        if (p.phase === 'Running' && up >= sc.startup) {
          p.phase = 'Ready'
          p.reason = undefined
        } else if (p.phase === 'Running' && app.readiness === 'http' && up >= 3 && up % 10 === 3) {
          ev(t, 'Warning', 'Unhealthy', `pod/${p.name}`, 'Readiness probe failed: HTTP probe failed with statuscode: 503')
        }
        if (p.hung) {
          const hungFor = t - p.hungSince
          if (app.readiness === 'http' && hungFor === 5) ev(t, 'Warning', 'Unhealthy', `pod/${p.name}`, `Readiness probe failed: Get "http://10.0.1.${10 + (p.name.charCodeAt(12) % 80)}:8080/ready": context deadline exceeded`)
          if (app.liveness === 'http' && hungFor >= 10) {
            ev(t, 'Warning', 'Unhealthy', `pod/${p.name}`, `Liveness probe failed: Get "http://10.0.1.${10 + (p.name.charCodeAt(12) % 80)}:8080/health": context deadline exceeded`)
            ev(t, 'Normal', 'Killing', `pod/${p.name}`, 'Container api failed liveness probe, will be restarted')
            p.restarts++
            restartsTotal++
            p.phase = 'CrashLoopBackOff'
            p.reason = 'Liveness'
            p.nextRestart = t + 1
            p.hung = false
          }
        }
      }
    }
    pods = pods.filter((p) => !(p.phase === 'Terminating' && p.node === null))

    // ---- HPA раз в 15 секунд
    const rps = sc.rps(t)
    if (app.hpa && t % 15 === 0 && t > 0) {
      const readyCount = Math.max(1, pods.filter((p) => healthy(p)).length)
      const util = rps / (readyCount * sc.podRps)
      const want = Math.min(app.hpa.max, Math.max(app.hpa.min, Math.ceil((readyCount * util) / app.hpa.target)))
      if (want > desired) {
        ev(t, 'Normal', 'SuccessfulRescale', 'horizontalpodautoscaler/api', `New size: ${want}; reason: cpu resource utilization (percentage of request) above target`)
        desired = want
        lowSince = -1
      } else if (want < desired) {
        if (lowSince < 0) lowSince = t
        if (t - lowSince >= 60) {
          ev(t, 'Normal', 'SuccessfulRescale', 'horizontalpodautoscaler/api', `New size: ${want}; reason: All metrics below target`)
          desired = want
          lowSince = -1
        }
      } else lowSince = -1
    }

    // ---- контроллер Deployment
    const live = pods.filter((p) => alive(p))
    const ofTarget = live.filter((p) => p.version === target && !p.canary)
    const old = live.filter((p) => p.version !== target)
    if (rollout === 'canary') {
      const canary = live.find((p) => p.canary)
      const v2 = sc.versions.v2
      if (canary && t >= canaryUntil) {
        const bad = v2.crash || (v2.errorRate ?? 0) > 0.01 || v2.mem > app.memLimit
        if (app.canaryAnalysis && bad) {
          ev(t, 'Warning', 'RolloutAborted', 'rollout/api', `Rollout aborted: analysis run failed (error rate ${Math.round((v2.errorRate ?? 1) * 100)}% > 1%), rolling back to api-${HASH.v1}`)
          terminate(canary, t)
          target = 'v1'
          rollout = 'none'
          canaryAborted = true
        } else {
          ev(t, 'Normal', 'RolloutStepCompleted', 'rollout/api', app.canaryAnalysis ? 'Analysis passed: promoting canary to 100%' : 'Canary pause elapsed: promoting to 100% (no analysis configured)')
          canary.canary = false
          rollout = 'rolling'
        }
      }
    } else if (rollout === 'recreate') {
      // Recreate ждёт, пока старые поды полностью остановятся
      if (!old.length && !pods.some((p) => p.phase === 'Terminating')) {
        if (ofTarget.length < desired) newPod(target, t)
        else {
          rollout = 'none'
          ev(t, 'Normal', 'ScalingReplicaSet', 'deployment/api', `Scaled up replica set api-${HASH[target]} to ${desired}`)
        }
      }
    } else if (rollout === 'rolling') {
      const surge = app.maxSurge
      const avail = live.filter((p) => healthy(p)).length
      if (ofTarget.length < desired && live.length < desired + surge) newPod(target, t)
      const oldVictim = old.find((p) => !healthy(p)) ?? old.find((p) => p.phase === 'Ready')
      const availAfter = avail - (oldVictim && healthy(oldVictim) ? 1 : 0)
      if (oldVictim && availAfter >= desired - app.maxUnavailable) {
        terminate(oldVictim, t)
        ev(t, 'Normal', 'ScalingReplicaSet', 'deployment/api', `Scaled down replica set api-${HASH[oldVictim.version]} to ${Math.max(0, old.length - 1)}`)
      }
      if (!old.length && ofTarget.filter(healthy).length >= desired) {
        rollout = 'none'
        ev(t, 'Normal', 'DeploymentRollout', 'deployment/api', `deployment "api" successfully rolled out`)
      } else if (!deadlineReported && t - rolloutStart >= 60) {
        deadlineReported = true
        ev(t, 'Warning', 'ProgressDeadlineExceeded', 'deployment/api', `ReplicaSet "api-${HASH[target]}" has timed out progressing.`)
      }
    } else {
      // обычный ReplicaSet: держать desired подов
      const mine = live.filter((p) => p.version === target)
      if (mine.length < desired) for (let i = mine.length; i < desired; i++) newPod(target, t)
      if (mine.length > desired) {
        const extra = [...mine].sort((a, b) => Number(healthy(a)) - Number(healthy(b))).slice(0, mine.length - desired)
        for (const p of extra) terminate(p, t)
      }
    }

    // ---- планировщик
    for (const p of pods.filter((x) => x.phase === 'Pending')) {
      const node = schedule(p)
      if (node) {
        p.node = node
        p.phase = 'ContainerCreating'
        p.created = t
        pendingSince.delete(p.name)
        ev(t, 'Normal', 'Scheduled', `pod/${p.name}`, `Successfully assigned default/${p.name} to ${node}`)
      } else {
        if (!pendingSince.has(p.name)) {
          pendingSince.set(p.name, t)
          const upNodes = nodes.filter((n) => n.up && !n.cordoned).length
          const reason =
            app.spread === 'host'
              ? `${nodes.length - upNodes} node(s) were unschedulable, ${upNodes} node(s) didn't match pod anti-affinity rules or had Insufficient cpu`
              : `${upNodes} Insufficient cpu`
          ev(t, 'Warning', 'FailedScheduling', `pod/${p.name}`, `0/${nodes.length} nodes are available: ${reason}.`)
        }
        pendingMax = Math.max(pendingMax, t - (pendingSince.get(p.name) ?? t))
      }
    }

    // ---- кто получает трафик — после решений контроллера и планировщика в эту секунду
    const serving = pods.filter((p) => servesTraffic(p, t))

    // ---- CPU на нодах: соседи и троттлинг
    const factor: Record<string, number> = {}
    let neighborAlloc = 0
    for (const n of nodes) {
      if (!n.up) continue
      const mine = pods.filter((p) => p.node === n.id && healthy(p))
      const perPodLoad = serving.length ? rps / serving.length : 0
      const util = Math.min(1, perPodLoad / sc.podRps)
      const apiDemand = mine.length * sc.podCpu * util
      const apiCap = app.cpuLimit === null ? Infinity : mine.length * app.cpuLimit
      const nb = sc.neighbor
      const nbDemand = nb && neighborWork < (nb.work ?? 0) ? Math.min(nb.cpuDemand, nb.cpuLimit ?? Infinity) : 0
      let apiAlloc = Math.min(apiDemand, apiCap)
      let nbAlloc = nbDemand
      if (apiAlloc + nbAlloc > n.cpu) {
        // CFS делит процессор пропорционально requests
        const wa = mine.length * app.cpuReq
        const wn = nb ? nb.cpuReq : 0
        let shareA = (n.cpu * wa) / Math.max(1, wa + wn)
        let shareN = n.cpu - shareA
        if (shareA > apiAlloc) {
          shareN += shareA - apiAlloc
          shareA = apiAlloc
        }
        if (shareN > nbAlloc) {
          shareA = Math.min(apiAlloc, shareA + shareN - nbAlloc)
          shareN = nbAlloc
        }
        apiAlloc = shareA
        nbAlloc = shareN
      }
      neighborAlloc += nbAlloc
      const need = Math.min(apiDemand, apiCap)
      // доля процессора, которую под реально получает при конкуренции с соседом
      factor[n.id] = Math.max(0.05, need > 0 ? Math.min(1, apiAlloc / need) : 1)
    }
    if (sc.neighbor) neighborWork += neighborAlloc / Math.max(1, nodes.filter((n) => n.up).length)

    // ---- трафик
    let ok = 0
    let failed = 0
    let latency = BASE_LATENCY
    if (rps > 0) {
      if (!serving.length) failed = rps
      else {
        // canary получает 10% трафика, остальное делится поровну
        const canaryPod = serving.find((p) => p.canary)
        const share = (p: Pod) => (canaryPod ? (p === canaryPod ? 0.1 : 0.9 / Math.max(1, serving.length - 1)) : 1 / serving.length)
        for (const p of serving) {
          const load = rps * share(p)
          if (!healthy(p)) {
            failed += load
            continue
          }
          const f = factor[p.node!] ?? 1
          // лимит CPU ниже потребности срезает пропускную способность пода (троттлинг)
          const limitFactor = app.cpuLimit === null ? 1 : Math.min(1, app.cpuLimit / sc.podCpu)
          const cap = sc.podRps * f * limitFactor
          const served = Math.min(load, cap)
          const errRate = sc.versions[p.version].errorRate ?? 0
          ok += served * (1 - errRate)
          failed += load - served + served * errRate
          latency = Math.max(latency, BASE_LATENCY / f / (1 - Math.min(load / cap, 0.95)))
        }
      }
    }
    requests += rps
    failedTotal += failed
    if (rps > 0 && failed / rps > 0.5) downtime++
    lat.push(latency)
    const live2 = pods.filter((p) => alive(p))
    podSeconds += live2.length
    maxPods = Math.max(maxPods, live2.length)

    frames.push({
      t,
      rps,
      ok,
      failed,
      latency,
      desired,
      pods: pods.map((p) => ({
        name: p.name,
        version: p.version,
        node: p.node,
        phase: p.phase,
        inService: servesTraffic(p, t),
        healthy: healthy(p),
        hung: p.hung,
        restarts: p.restarts,
        reason: p.reason,
      })),
      nodes: nodes.map((n) => {
        const r = nodeReq(n.id)
        return { id: n.id, zone: n.zone, up: n.up, cordoned: n.cordoned, cpu: n.cpu, cpuReq: r.cpu, mem: n.mem, memReq: r.mem }
      }),
    })
  }

  const sorted = [...lat].sort((a, b) => a - b)
  const last = frames[frames.length - 1]
  const versions = new Set(pods.filter((p) => alive(p)).map((p) => p.version))
  return {
    frames,
    events,
    totals: {
      requests,
      failed: failedTotal,
      errorRate: requests ? failedTotal / requests : 0,
      downtime,
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      avgPods: podSeconds / frames.length,
      maxPods,
      oomKills,
      restarts: restartsTotal,
      pendingMax,
      rolloutDone: rollout === 'none',
      finalVersion: versions.size === 1 ? [...versions][0] : 'mixed',
      drainDone: drainDone && !drainNodes.size,
      neighborDone: !sc.neighbor || neighborWork >= sc.neighbor.work,
      readyAtEnd: last.pods.filter((p) => p.healthy).length,
      desiredAtEnd: last.desired,
      canaryAborted,
    },
  }
}
