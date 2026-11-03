import { tr } from '../../i18n'
/**
 * Учебная модель Kafka. Не претендует на точность до байта, но честно
 * воспроизводит ключевые механики: партиции и ключи, лидеров и фолловеров,
 * ISR, high watermark, acks, min.insync.replicas, unclean leader election,
 * consumer groups, ребалансировку, offsets, лаг, дубликаты и порядок событий.
 */

import type { Flight } from '../../components/FlightLayer'

export type KeyStrategy = 'none' | 'order' | 'customer'
export type Acks = 0 | 1 | 'all'

export interface ProducerConfig {
  rate: number // сообщений в секунду
  keyStrategy: KeyStrategy
  acks: Acks
}

export interface GroupConfig {
  name: string
  consumers: number
  consumerRate: number // сообщений в секунду на одного консьюмера
}

export interface KafkaConfig {
  brokers: number
  partitions: number
  replicationFactor: number
  minInsyncReplicas: number
  uncleanLeaderElection: boolean
  producers: ProducerConfig[]
  groups: GroupConfig[]
  slowBrokers?: number[]
  /** Задержка репликации на здоровом брокере, сек */
  replicaDelay?: number
}

export const ORDER_STAGES = tr<readonly string[]>(['создан', 'оплачен', 'отправлен'], ['created', 'paid', 'shipped'], ['已创建', '已支付', '已发货'])

export interface Msg {
  id: number
  offset: number
  partition: number
  key: string | null
  orderId: number
  seq: number // стадия заказа: 0 создан, 1 оплачен, 2 отправлен
  customer: string
  producedAt: number
  producerId: number
  acked: boolean
}

export interface Partition {
  id: number
  replicas: number[] // брокеры, первый — предпочтительный лидер
  leader: number | null
  isr: number[]
  leo: Record<number, number> // log end offset каждой реплики (у фолловеров дробный — догоняют)
  caughtUpAt: Record<number, number>
  log: Msg[] // лог лидера; log[i].offset === logStart + i
  logStart: number
  /** Входящий поток, сообщ./с (скользящее среднее) */
  inRate: number
  appended: number
}

export interface Broker {
  id: number
  alive: boolean
  slow: boolean
}

export interface Producer {
  id: number
  rate: number
  keyStrategy: KeyStrategy
  acks: Acks
  carry: number
  rr: number
  sent: number
  acked: number
  failed: number
}

export interface Consumer {
  id: number
  name: string
  rate: number
  alive: boolean
  budget: number
  rr: number
  processed: number
  stallUntil: number // пауза: GC, медленный запрос в БД и т. п.
}

export interface Group {
  id: number
  name: string
  consumers: Consumer[]
  assignment: Record<number, number> // partition -> consumer id
  position: Record<number, number>
  committed: Record<number, number>
  maxProcessed: Record<number, number>
  rebalanceUntil: number
  lastCommit: number
  processed: number
  duplicates: number
  violations: number
  expectedSeq: Map<number, number>
  nextConsumerId: number
}

export interface SimEvent {
  t: number
  text: string
  kind: 'info' | 'warn' | 'error' | 'ok'
}

export interface Sample {
  t: number
  lag: number
  produced: number
  consumed: number
}

const REBALANCE_SEC = 1.5
const COMMIT_INTERVAL = 1
const REPLICA_LAG_MAX = 2
const SLOW_DELAY = 4
const MAX_LOG = 3000
const BIG_CUSTOMER = 'big-corp'

export function keyColor(orderId: number): string {
  const hue = (orderId * 137.508) % 360
  return `hsl(${hue.toFixed(0)} 70% 60%)`
}

export class KafkaSim {
  now = 0
  config: KafkaConfig
  brokers: Broker[] = []
  partitions: Partition[] = []
  producers: Producer[] = []
  groups: Group[] = []
  events: SimEvent[] = []
  history: Sample[] = []
  /** Очередь анимаций; её вычитывает слой отрисовки */
  flights: Flight[] = []
  minIsr: number
  unclean: boolean
  replicaDelay: number

  lost = 0
  lostAcked = 0
  rejected = 0
  private msgId = 0
  private orderId = 0
  private openOrders: { id: number; seq: number; customer: string }[] = []
  private sampleProduced = 0
  private sampleConsumed = 0
  private lastSample = 0
  private nextProducerId = 1

  constructor(config: KafkaConfig) {
    this.config = config
    this.minIsr = config.minInsyncReplicas
    this.unclean = config.uncleanLeaderElection
    this.replicaDelay = config.replicaDelay ?? 0.3
    for (let b = 1; b <= config.brokers; b++) {
      this.brokers.push({ id: b, alive: true, slow: config.slowBrokers?.includes(b) ?? false })
    }
    for (let p = 0; p < config.partitions; p++) this.createPartition()
    config.producers.forEach((p) => this.addProducer(p))
    config.groups.forEach((g) => this.addGroup(g))
  }

  // ---------- топология ----------

  private createPartition() {
    const id = this.partitions.length
    const n = this.brokers.length
    const rf = Math.min(this.config.replicationFactor, n)
    const replicas = Array.from({ length: rf }, (_, j) => ((id + j) % n) + 1)
    const alive = replicas.filter((b) => this.broker(b).alive)
    const leo: Record<number, number> = {}
    const caughtUpAt: Record<number, number> = {}
    replicas.forEach((b) => {
      leo[b] = 0
      caughtUpAt[b] = this.now
    })
    this.partitions.push({
      id,
      replicas,
      leader: alive[0] ?? null,
      isr: alive,
      leo,
      caughtUpAt,
      log: [],
      logStart: 0,
      inRate: 0,
      appended: 0,
    })
  }

  addPartition() {
    this.createPartition()
    this.log(tr(`Добавлена партиция P${this.partitions.length - 1}. Ключи теперь распределяются по-другому`, `Added partition P${this.partitions.length - 1}. Keys are now distributed differently`, `新增了分区 P${this.partitions.length - 1}，键的分布方式随之改变`), 'warn')
    this.groups.forEach((g) => this.triggerRebalance(g, tr('изменилось число партиций', 'partition count changed', '分区数量发生了变化')))
  }

  broker(id: number): Broker {
    return this.brokers[id - 1]
  }

  hw(p: Partition): number {
    if (p.leader === null) return p.log.length ? p.logStart + p.log.length : p.logStart
    let min = Infinity
    for (const b of p.isr) min = Math.min(min, Math.floor(p.leo[b]))
    return min === Infinity ? p.logStart : min
  }

  leaderLeo(p: Partition): number {
    return p.logStart + p.log.length
  }

  // ---------- продюсеры ----------

  addProducer(cfg: ProducerConfig) {
    this.producers.push({ id: this.nextProducerId++, ...cfg, carry: 0, rr: 0, sent: 0, acked: 0, failed: 0 })
  }

  removeProducer(id: number) {
    this.producers = this.producers.filter((p) => p.id !== id)
  }

  private nextEvent(): { orderId: number; seq: number; customer: string } {
    // Либо продвигаем существующий заказ, либо создаём новый
    if (this.openOrders.length > 6 || (this.openOrders.length > 0 && Math.random() < 0.6)) {
      const i = Math.floor(Math.random() * this.openOrders.length)
      const o = this.openOrders[i]
      o.seq++
      if (o.seq >= ORDER_STAGES.length - 1) this.openOrders.splice(i, 1)
      return { orderId: o.id, seq: o.seq, customer: o.customer }
    }
    const customer = Math.random() < 0.7 ? BIG_CUSTOMER : `client-${1 + Math.floor(Math.random() * 30)}`
    const o = { id: ++this.orderId, seq: 0, customer }
    this.openOrders.push(o)
    return { orderId: o.id, seq: 0, customer }
  }

  private choosePartition(pr: Producer, key: string | null): number {
    const n = this.partitions.length
    if (key === null) return pr.rr++ % n
    return hash(key) % n
  }

  private produceOne(pr: Producer) {
    const ev = this.nextEvent()
    const key =
      pr.keyStrategy === 'order' ? `order-${ev.orderId}` : pr.keyStrategy === 'customer' ? ev.customer : null
    const pid = this.choosePartition(pr, key)
    const p = this.partitions[pid]
    pr.sent++
    this.sampleProduced++
    if (p.leader === null) {
      pr.failed++
      this.rejected++
      return
    }
    if (pr.acks === 'all' && p.isr.length < this.minIsr) {
      pr.failed++
      this.rejected++
      return
    }
    const offset = this.leaderLeo(p)
    const msg: Msg = {
      id: ++this.msgId,
      offset,
      partition: pid,
      key,
      orderId: ev.orderId,
      seq: ev.seq,
      customer: ev.customer,
      producedAt: this.now,
      producerId: pr.id,
      acked: pr.acks !== 'all',
    }
    if (msg.acked) pr.acked++
    this.fly(`producer-${pr.id}`, `partition-${pid}`, keyColor(ev.orderId))
    p.log.push(msg)
    p.appended++
    p.leo[p.leader] = offset + 1
    if (p.log.length > MAX_LOG) {
      p.log.shift()
      p.logStart++
    }
  }

  // ---------- брокеры и репликация ----------

  killBroker(id: number) {
    const b = this.broker(id)
    if (!b.alive) return
    b.alive = false
    this.log(tr(`Брокер ${id} упал`, `Broker ${id} is down`, `Broker ${id} 宕机了`), 'error')
    for (const p of this.partitions) {
      p.isr = p.isr.filter((r) => r !== id)
      if (p.leader === id) this.electLeader(p)
    }
  }

  restartBroker(id: number) {
    const b = this.broker(id)
    if (b.alive) return
    b.alive = true
    this.log(tr(`Брокер ${id} снова в строю`, `Broker ${id} is back up`, `Broker ${id} 恢复运行`), 'ok')
    for (const p of this.partitions) {
      if (!p.replicas.includes(id)) continue
      if (p.leader === null) {
        // Партиция была офлайн: вернувшийся брокер — последний, кто был в ISR
        p.leader = id
        p.leo[id] = Math.floor(p.leo[id])
        this.truncate(p, p.leo[id])
        p.isr = [id]
        this.log(tr(`P${p.id} снова доступна, лидер — брокер ${id}`, `P${p.id} is available again, leader is broker ${id}`, `P${p.id} 恢复可用，领导者是 Broker ${id}`), 'ok')
      } else {
        // Догоняет лидера, в ISR вернётся, когда догонит
        p.leo[id] = Math.min(p.leo[id], this.hw(p))
      }
    }
  }

  toggleSlow(id: number) {
    const b = this.broker(id)
    b.slow = !b.slow
    this.log(b.slow ? tr(`Брокер ${id} тормозит (диск/сеть)`, `Broker ${id} is slow (disk/network)`, `Broker ${id} 变慢了（磁盘/网络）`) : tr(`Брокер ${id} работает нормально`, `Broker ${id} is working normally`, `Broker ${id} 运行正常`), b.slow ? 'warn' : 'info')
  }

  private electLeader(p: Partition) {
    const old = p.leader
    const clean = p.replicas.filter((r) => r !== old && this.broker(r).alive && p.isr.includes(r))
    let next: number | undefined = clean[0]
    let uncleanElection = false
    if (next === undefined && this.unclean) {
      next = p.replicas.find((r) => r !== old && this.broker(r).alive)
      uncleanElection = next !== undefined
    }
    if (next === undefined) {
      p.leader = null
      p.isr = []
      this.log(tr(`P${p.id} недоступна: в ISR не осталось живых реплик`, `P${p.id} is unavailable: no live replicas left in the ISR`, `P${p.id} 不可用：ISR 中已没有存活的副本`), 'error')
      return
    }
    p.leader = next
    const newLeo = Math.floor(p.leo[next])
    p.leo[next] = newLeo
    this.truncate(p, newLeo)
    if (uncleanElection) {
      p.isr = [next]
      this.log(tr(`P${p.id}: unclean election — лидером стал отстающий брокер ${next}`, `P${p.id}: unclean election, lagging broker ${next} became leader`, `P${p.id}：unclean election——落后的 Broker ${next} 成为了领导者`), 'error')
    } else {
      p.isr = p.isr.filter((r) => this.broker(r).alive)
      if (!p.isr.includes(next)) p.isr.unshift(next)
      this.log(tr(`P${p.id}: новый лидер — брокер ${next}`, `P${p.id}: new leader is broker ${next}`, `P${p.id}：新的领导者是 Broker ${next}`), 'warn')
    }
  }

  /**
   * Обрезает лог лидера до offset. Подтверждённые сообщения пропадают навсегда,
   * неподтверждённые продюсер переотправляет новому лидеру (retries).
   */
  private truncate(p: Partition, leo: number) {
    const keep = Math.max(0, leo - p.logStart)
    if (keep >= p.log.length) return
    const dropped = p.log.splice(keep)
    for (const r of p.replicas) p.leo[r] = Math.min(p.leo[r], leo)
    for (const g of this.groups) {
      if (g.position[p.id] > leo) g.position[p.id] = leo
      if (g.committed[p.id] > leo) g.committed[p.id] = leo
      if (g.maxProcessed[p.id] >= leo) g.maxProcessed[p.id] = leo - 1
    }
    const lostAcked = dropped.filter((m) => m.acked)
    const retry = dropped.filter((m) => !m.acked)
    this.lost += lostAcked.length
    this.lostAcked += lostAcked.length
    if (lostAcked.length > 0) {
      this.log(tr(`P${p.id}: потеряно ${lostAcked.length} сообщ., которые продюсер считал записанными!`, `P${p.id}: lost ${lostAcked.length} msgs the producer considered written!`, `P${p.id}：丢失了 ${lostAcked.length} 条生产者认为已写入的消息！`), 'error')
    }
    if (retry.length === 0) return
    if (p.leader === null) {
      for (const m of retry) {
        const pr = this.producers.find((x) => x.id === m.producerId)
        if (pr) pr.failed++
      }
      this.rejected += retry.length
      return
    }
    for (const m of retry) {
      m.offset = this.leaderLeo(p)
      p.log.push(m)
      p.leo[p.leader] = m.offset + 1
    }
    this.log(tr(`P${p.id}: ${retry.length} неподтверждённых сообщ. продюсер переотправил новому лидеру`, `P${p.id}: the producer resent ${retry.length} unacknowledged msgs to the new leader`, `P${p.id}：生产者把 ${retry.length} 条未确认的消息重新发给了新的领导者`), 'info')
  }

  private replicate() {
    for (const p of this.partitions) {
      if (p.leader === null) continue
      const leaderLeo = this.leaderLeo(p)
      for (const r of p.replicas) {
        if (r === p.leader) continue
        const b = this.broker(r)
        if (!b.alive) continue
        const delay = b.slow ? SLOW_DELAY : this.replicaDelay
        // Фолловер успевает забрать сообщения старше delay
        let target = Math.max(p.leo[r], p.logStart)
        while (target < leaderLeo) {
          const m = p.log[Math.floor(target) - p.logStart]
          if (!m || this.now - m.producedAt < delay) break
          target = Math.floor(target) + 1
        }
        p.leo[r] = Math.max(p.leo[r], target)
        // Как replica.lag.time.max.ms: насколько давно фолловер последний раз имел всё,
        // что было у лидера. Это время записи первого не скопированного сообщения.
        const firstMissing = p.log[Math.floor(p.leo[r]) - p.logStart]
        p.caughtUpAt[r] = firstMissing ? firstMissing.producedAt : this.now
        const behind = this.now - p.caughtUpAt[r]
        const inIsr = p.isr.includes(r)
        if (inIsr && behind > REPLICA_LAG_MAX) {
          p.isr = p.isr.filter((x) => x !== r)
          this.log(tr(`P${p.id}: брокер ${r} отстал и выпал из ISR`, `P${p.id}: broker ${r} fell behind and dropped out of the ISR`, `P${p.id}：Broker ${r} 落后太多，被移出 ISR`), 'warn')
        } else if (!inIsr && behind < REPLICA_LAG_MAX / 2) {
          p.isr.push(r)
          this.log(tr(`P${p.id}: брокер ${r} догнал лидера и вернулся в ISR`, `P${p.id}: broker ${r} caught up with the leader and rejoined the ISR`, `P${p.id}：Broker ${r} 追上了领导者，重新加入 ISR`), 'ok')
        }
      }
      p.leo[p.leader] = leaderLeo
      // Подтверждаем acks=all, как только сообщение есть на всех ISR
      const hw = this.hw(p)
      for (let i = Math.max(0, hw - p.logStart - 200); i < hw - p.logStart && i < p.log.length; i++) {
        const m = p.log[i]
        if (!m.acked) {
          m.acked = true
          const pr = this.producers.find((x) => x.id === m.producerId)
          if (pr) pr.acked++
        }
      }
    }
  }

  // ---------- консьюмеры ----------

  addGroup(cfg: GroupConfig) {
    const g: Group = {
      id: this.groups.length,
      name: cfg.name,
      consumers: [],
      assignment: {},
      position: {},
      committed: {},
      maxProcessed: {},
      rebalanceUntil: 0,
      lastCommit: 0,
      processed: 0,
      duplicates: 0,
      violations: 0,
      expectedSeq: new Map(),
      nextConsumerId: 1,
    }
    this.groups.push(g)
    for (let i = 0; i < cfg.consumers; i++) this.newConsumer(g, cfg.consumerRate)
    this.assign(g)
  }

  private newConsumer(g: Group, rate: number) {
    const id = g.nextConsumerId++
    g.consumers.push({ id, name: `C${id}`, rate, alive: true, budget: 0, rr: 0, processed: 0, stallUntil: 0 })
  }

  addConsumer(gid: number) {
    const g = this.groups[gid]
    const rate = g.consumers[0]?.rate ?? 10
    this.newConsumer(g, rate)
    this.triggerRebalance(g, tr(`в группу вошёл ${g.consumers[g.consumers.length - 1].name}`, `${g.consumers[g.consumers.length - 1].name} joined the group`, `${g.consumers[g.consumers.length - 1].name} 加入了组`))
  }

  removeConsumer(gid: number, cid: number) {
    const g = this.groups[gid]
    const c = g.consumers.find((x) => x.id === cid)
    if (!c) return
    g.consumers = g.consumers.filter((x) => x.id !== cid)
    this.triggerRebalance(g, tr(`${c.name} вышел из группы`, `${c.name} left the group`, `${c.name} 离开了组`))
  }

  killConsumer(gid: number, cid: number) {
    const g = this.groups[gid]
    const c = g.consumers.find((x) => x.id === cid)
    if (!c || !c.alive) return
    c.alive = false
    this.log(tr(`${g.name}/${c.name} упал, не успев закоммитить offset`, `${g.name}/${c.name} crashed before committing its offset`, `${g.name}/${c.name} 还没来得及提交 offset 就崩溃了`), 'error')
    const orphaned = this.partitionsOf(g, cid)
    g.consumers = g.consumers.filter((x) => x.id !== cid)
    this.triggerRebalance(g, tr(`${c.name} перестал слать heartbeat`, `${c.name} stopped sending heartbeats`, `${c.name} 不再发送心跳（heartbeat）`), orphaned)
  }

  setGroupRate(gid: number, rate: number) {
    this.groups[gid].consumers.forEach((c) => (c.rate = rate))
  }

  /**
   * Живые консьюмеры коммитят offset перед тем, как отдать партиции.
   * Партиции упавшего (orphaned) откатываются к последнему коммиту — его работа будет обработана повторно.
   */
  private triggerRebalance(g: Group, reason: string, orphaned: number[] = []) {
    g.rebalanceUntil = this.now + REBALANCE_SEC
    for (const pid of Object.keys(g.position)) {
      if (orphaned.includes(+pid)) g.position[+pid] = g.committed[+pid] ?? 0
      else g.committed[+pid] = g.position[+pid]
    }
    g.assignment = {}
    this.log(tr(`${g.name}: ребалансировка (${reason}), чтение приостановлено`, `${g.name}: rebalance (${reason}), reading paused`, `${g.name}：再均衡（${reason}），读取已暂停`), 'warn')
  }

  private assign(g: Group) {
    // Range assignor для одного топика
    const cs = g.consumers.filter((c) => c.alive)
    g.assignment = {}
    const n = this.partitions.length
    if (cs.length === 0) return
    const per = Math.floor(n / cs.length)
    const extra = n % cs.length
    let p = 0
    cs.forEach((c, i) => {
      const cnt = per + (i < extra ? 1 : 0)
      for (let k = 0; k < cnt; k++) g.assignment[p++] = c.id
    })
    for (let pid = 0; pid < n; pid++) {
      g.position[pid] ??= 0
      g.committed[pid] ??= 0
      g.maxProcessed[pid] ??= -1
    }
  }

  partitionsOf(g: Group, cid: number): number[] {
    return Object.entries(g.assignment)
      .filter(([, c]) => c === cid)
      .map(([p]) => +p)
  }

  isRebalancing(g: Group): boolean {
    return this.now < g.rebalanceUntil
  }

  lag(g: Group, pid: number): number {
    const p = this.partitions[pid]
    return Math.max(0, this.hw(p) - (g.position[pid] ?? 0))
  }

  totalLag(g: Group): number {
    let s = 0
    for (const p of this.partitions) s += this.lag(g, p.id)
    return s
  }

  maxPartitionLag(g: Group): number {
    let m = 0
    for (const p of this.partitions) m = Math.max(m, this.lag(g, p.id))
    return m
  }

  private consume(dt: number) {
    for (const g of this.groups) {
      if (g.rebalanceUntil > 0 && this.now >= g.rebalanceUntil) {
        g.rebalanceUntil = 0
        this.assign(g)
        this.log(tr(`${g.name}: ребалансировка завершена`, `${g.name}: rebalance complete`, `${g.name}：再均衡完成`), 'info')
      }
      if (this.isRebalancing(g)) continue
      for (const c of g.consumers) {
        if (!c.alive) continue
        const mine = this.partitionsOf(g, c.id)
        if (mine.length === 0) {
          c.budget = 0
          continue
        }
        if (this.now < c.stallUntil) continue
        if (Math.random() < dt * 0.25) {
          c.stallUntil = this.now + 0.3 + Math.random() * 0.7
          continue
        }
        // Компенсируем паузы, чтобы средняя скорость совпадала с заявленной
        const jitter = (0.6 + Math.random() * 0.8) * 1.15
        c.budget += c.rate * dt * jitter
        let guard = 0
        while (c.budget >= 1 && guard++ < 500) {
          let found = false
          for (let k = 0; k < mine.length; k++) {
            const pid = mine[(c.rr + k) % mine.length]
            const p = this.partitions[pid]
            if (p.leader === null) continue
            if (g.position[pid] < p.logStart) g.position[pid] = p.logStart
            if (g.position[pid] < this.hw(p)) {
              c.rr = (c.rr + k + 1) % mine.length
              this.processMsg(g, c, p.log[g.position[pid] - p.logStart])
              g.position[pid]++
              c.budget--
              found = true
              break
            }
          }
          if (!found) {
            c.budget = Math.min(c.budget, 1)
            break
          }
        }
      }
      if (this.now - g.lastCommit >= COMMIT_INTERVAL) {
        g.lastCommit = this.now
        for (const pid of Object.keys(g.position)) g.committed[+pid] = g.position[+pid]
      }
    }
  }

  private processMsg(g: Group, c: Consumer, m: Msg) {
    this.fly(`partition-${m.partition}`, `consumer-${g.id}-${c.id}`, keyColor(m.orderId))
    c.processed++
    g.processed++
    this.sampleConsumed++
    if (m.offset <= (g.maxProcessed[m.partition] ?? -1)) {
      g.duplicates++
      return
    }
    g.maxProcessed[m.partition] = m.offset
    const expected = g.expectedSeq.get(m.orderId) ?? 0
    if (m.seq !== expected) g.violations++
    if (m.seq >= ORDER_STAGES.length - 1) g.expectedSeq.delete(m.orderId)
    else g.expectedSeq.set(m.orderId, Math.max(expected, m.seq + 1))
  }

  // ---------- цикл ----------

  tick(dt: number) {
    this.now += dt
    for (const pr of this.producers) {
      pr.carry += pr.rate * dt
      while (pr.carry >= 1) {
        pr.carry--
        this.produceOne(pr)
      }
    }
    this.replicate()
    this.consume(dt)
    if (this.now - this.lastSample >= 0.5) {
      const span = this.now - this.lastSample
      this.history.push({
        t: this.now,
        lag: this.groups.reduce((s, g) => s + this.totalLag(g), 0),
        produced: this.sampleProduced / span,
        consumed: this.sampleConsumed / span,
      })
      if (this.history.length > 120) this.history.shift()
      const k = Math.min(1, span / 4)
      for (const p of this.partitions) {
        p.inRate += (p.appended / span - p.inRate) * k
        p.appended = 0
      }
      this.sampleProduced = 0
      this.sampleConsumed = 0
      this.lastSample = this.now
    }
  }

  private fly(from: string, to: string, color: string) {
    if (this.flights.length < 300) this.flights.push({ from, to, color })
  }

  log(text: string, kind: SimEvent['kind'] = 'info') {
    this.events.unshift({ t: this.now, text, kind })
    if (this.events.length > 60) this.events.pop()
  }

  /** Нагрузка на консьюмера: входящий поток его партиций относительно его скорости */
  consumerLoad(g: Group, cid: number): number {
    const c = g.consumers.find((x) => x.id === cid)
    if (!c) return 0
    const incoming = this.partitionsOf(g, cid).reduce((s, pid) => s + this.partitions[pid].inRate, 0)
    return incoming / c.rate
  }

  /** Группа справляется: каждая партиция назначена и ни один консьюмер не перегружен */
  groupKeepsUp(g: Group): boolean {
    if (this.isRebalancing(g)) return false
    if (Object.keys(g.assignment).length < this.partitions.length) return false
    return g.consumers.every((c) => this.consumerLoad(g, c.id) <= 0.97)
  }

  offlinePartitions(): number {
    return this.partitions.filter((p) => p.leader === null).length
  }
}

function hash(s: string): number {
  // murmur-подобный хэш, как идея — у Kafka murmur2
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}
