import { tr } from '../../i18n'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ORDER_STAGES, keyColor, type Acks, type KafkaConfig, type KafkaSim, type KeyStrategy, type Msg, type Partition } from './engine'
import { useKafkaSim } from './useKafkaSim'
import { Sparkline } from '../../components/Sparkline'
import { FlightLayer } from '../../components/FlightLayer'
import { EVENT_TYPES, eventHeaders, eventPayload } from './events'

export interface SimControls {
  partitions?: boolean
  producers?: boolean // добавлять/удалять продюсеров, менять rate
  keys?: boolean
  acks?: boolean
  reliability?: boolean // min.insync.replicas, unclean election
  brokers?: boolean // ронять/поднимать/тормозить брокеры
  consumers?: boolean // добавлять/удалять/ронять консьюмеров
  consumerRate?: boolean
  groups?: boolean
}

export const ALL_CONTROLS: SimControls = {
  partitions: true,
  producers: true,
  keys: true,
  acks: true,
  reliability: true,
  brokers: true,
  consumers: true,
  consumerRate: true,
  groups: true,
}

interface Props {
  config: KafkaConfig
  controls?: SimControls
  onTick?: (sim: KafkaSim) => void
  /** Дополнительные кнопки в тулбаре (например, «устроить аварию» в сценарии) */
  extraActions?: (sim: KafkaSim, act: (fn: (s: KafkaSim) => void) => void) => ReactNode
  compact?: boolean
}

const KEY_LABELS: Record<KeyStrategy, string> = {
  none: tr('без ключа (round-robin)', 'no key (round-robin)', '无 key（轮询 round-robin）'),
  order: tr('ключ = id заказа', 'key = order id', 'key = 订单 id'),
  customer: tr('ключ = клиент', 'key = customer', 'key = 客户'),
}

const WINDOW = 22

/**
 * Сколько последних сообщений партиции помещается в ряд. На телефоне меньше, чем на компьютере:
 * ряд из 22 квадратов шире экрана и растянул бы всю страницу.
 */
function useFitWindow() {
  const ref = useRef<HTMLElement>(null)
  const [win, setWin] = useState(WINDOW)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      const st = getComputedStyle(el)
      const cell = parseFloat(st.getPropertyValue('--cell')) || 22
      const inner = el.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight)
      // слева в ряду — «…offset» начала окна
      setWin(Math.max(6, Math.min(WINDOW, Math.floor((inner - 48) / cell))))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, win] as const
}

export function KafkaSimulator({ config, controls = {}, onTick, extraActions, compact }: Props) {
  const { sim, running, setRunning, speed, setSpeed, reset, act } = useKafkaSim(config, onTick)
  const c = controls
  const totalLag = sim.groups.reduce((s, g) => s + sim.totalLag(g), 0)
  const last = sim.history[sim.history.length - 1]
  const [picked, setPicked] = useState<Msg | null>(null)

  return (
    <div className={'ksim' + (compact ? ' ksim-compact' : '')}>
      <div className="ksim-toolbar">
        <button onClick={() => setRunning(!running)}>{running ? tr('⏸ Пауза', '⏸ Pause', '⏸ 暂停') : tr('▶ Пуск', '▶ Run', '▶ 运行')}</button>
        <button onClick={reset}>{tr('↺ Сначала', '↺ Restart', '↺ 重新开始')}</button>
        <label className="inline">
          {tr('скорость', 'speed', '速度')}
          <select value={speed} onChange={(e) => setSpeed(+e.target.value)}>
            <option value={0.5}>×0.5</option>
            <option value={1}>×1</option>
            <option value={2}>×2</option>
            <option value={4}>×4</option>
          </select>
        </label>
        <span className="muted">t = {sim.now.toFixed(1)} {tr('с', 's', 's')}</span>
        <span className="spacer" />
        {extraActions?.(sim, act)}
      </div>

      <div className="ksim-metrics">
        <Metric label={tr('записано/с', 'written/s', '写入/s')} value={last ? last.produced.toFixed(0) : '0'} />
        <Metric label={tr('прочитано/с', 'read/s', '读取/s')} value={last ? last.consumed.toFixed(0) : '0'} />
        <Metric label={tr('лаг (всего)', 'lag (total)', '积压（总计）')} value={totalLag} tone={totalLag > 50 ? 'bad' : totalLag > 15 ? 'warn' : 'ok'}>
          <Sparkline values={sim.history.map((h) => h.lag)} />
        </Metric>
        <Metric label={tr('отказы записи', 'write rejections', '写入被拒')} value={sim.rejected} tone={sim.rejected ? 'warn' : undefined} />
        <Metric label={tr('потеряно подтверждённых', 'acknowledged lost', '已确认但丢失')} value={sim.lostAcked} tone={sim.lostAcked ? 'bad' : 'ok'} />
        <Metric
          label={tr('партиций офлайн', 'partitions offline', '离线分区')}
          value={sim.offlinePartitions()}
          tone={sim.offlinePartitions() ? 'bad' : 'ok'}
        />
      </div>

      <div className="ksim-main">
        <ProducersPanel sim={sim} act={act} c={c} />
        <TopicPanel sim={sim} act={act} c={c} onPick={setPicked} picked={picked} />
        <GroupsPanel sim={sim} act={act} c={c} />
        <FlightLayer queue={sim.flights} duration={650 / Math.sqrt(speed)} />
      </div>

      <div className="ksim-bottom">
        <BrokersPanel sim={sim} act={act} c={c} />
        <EventLog sim={sim} />
      </div>
      <EventInspector sim={sim} picked={picked} onPick={setPicked} />
    </div>
  )
}

type Act = (fn: (s: KafkaSim) => void) => void
interface PanelProps {
  sim: KafkaSim
  act: Act
  c: SimControls
}

function Metric(props: { label: string; value: ReactNode; tone?: 'ok' | 'warn' | 'bad'; children?: ReactNode }) {
  return (
    <div className={'metric ' + (props.tone ?? '')}>
      <div className="metric-value">{props.value}</div>
      <div className="metric-label">{props.label}</div>
      {props.children}
    </div>
  )
}

function ProducersPanel({ sim, act, c }: PanelProps) {
  return (
    <section className="panel">
      <h4>{tr('Продюсеры', 'Producers', '生产者')}</h4>
      {sim.producers.map((p) => (
        <div key={p.id} className="card" data-anchor={`producer-${p.id}`}>
          <div className="card-head">
            <b>Producer {p.id}</b>
            {c.producers && sim.producers.length > 1 && (
              <button className="icon" title={tr('Удалить', 'Remove', '删除')} onClick={() => act((s) => s.removeProducer(p.id))}>
                ✕
              </button>
            )}
          </div>
          <label>
            {p.rate} {tr('сообщ./с', 'msg/s', 'msg/s')}
            <input
              type="range"
              min={1}
              max={120}
              value={p.rate}
              disabled={!c.producers}
              onChange={(e) => act(() => (p.rate = +e.target.value))}
            />
          </label>
          <label>
            {tr('ключ', 'key', 'key')}
            <select
              value={p.keyStrategy}
              disabled={!c.keys}
              onChange={(e) => act(() => (p.keyStrategy = e.target.value as KeyStrategy))}
            >
              {Object.entries(KEY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            acks
            <select
              value={String(p.acks)}
              disabled={!c.acks}
              onChange={(e) => act(() => (p.acks = parseAcks(e.target.value)))}
            >
              <option value="0">{tr('0 — не ждать', '0 — no wait', '0 — 不等待')}</option>
              <option value="1">{tr('1 — ждать лидера', '1 — wait for leader', '1 — 等待领导者')}</option>
              <option value="all">{tr('all — ждать все ISR', 'all — wait for all ISR', 'all — 等待全部 ISR')}</option>
            </select>
          </label>
          <div className="small muted">
            {tr(`отправлено ${p.sent} · подтверждено ${p.acked} · ошибок ${p.failed}`, `sent ${p.sent} · acked ${p.acked} · errors ${p.failed}`, `已发送 ${p.sent} · 已确认 ${p.acked} · 错误 ${p.failed}`)}
          </div>
        </div>
      ))}
      {c.producers && (
        <button
          onClick={() => act((s) => s.addProducer({ rate: 10, keyStrategy: 'order', acks: 'all' }))}
        >
          + {tr('продюсер', 'producer', '生产者')}
        </button>
      )}
      {c.reliability && (
        <div className="card">
          <b>{tr('Настройки топика', 'Topic settings', 'Topic 设置')}</b>
          <label>
            min.insync.replicas
            <select value={sim.minIsr} onChange={(e) => act((s) => (s.minIsr = +e.target.value))}>
              {[1, 2, 3].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={sim.unclean}
              onChange={(e) => act((s) => (s.unclean = e.target.checked))}
            />
            unclean.leader.election
          </label>
        </div>
      )}
    </section>
  )
}

function parseAcks(v: string): Acks {
  return v === 'all' ? 'all' : v === '0' ? 0 : 1
}

function TopicPanel({
  sim,
  act,
  c,
  onPick,
  picked,
}: PanelProps & { onPick: (m: Msg) => void; picked: Msg | null }) {
  const [ref, win] = useFitWindow()
  return (
    <section className="panel topic" ref={ref}>
      <h4>
        {tr('Топик', 'Topic', 'Topic')} <code>orders</code>
        <span className="muted small">
          {' '}
          · {sim.partitions.length} {tr('партиций', 'partitions', '个分区')} · RF={sim.config.replicationFactor}
        </span>
      </h4>
      {sim.partitions.map((p) => (
        <PartitionRow key={p.id} sim={sim} p={p} win={win} onPick={onPick} picked={picked} />
      ))}
      <div className="legend small muted">
        {tr(
          <>
            Квадрат = сообщение, цвет = заказ, цифра = стадия ({ORDER_STAGES.map((s, i) => `${i + 1} ${s}`).join(', ')}).
            Пунктир = ещё не реплицировано (выше high watermark), консьюмеры его не видят.
          </>,
          <>
            Square = message, color = order, digit = stage ({ORDER_STAGES.map((s, i) => `${i + 1} ${s}`).join(', ')}).
            Dashed = not yet replicated (above the high watermark), consumers cannot see it.
          </>,
          <>
            方块 = 消息，颜色 = 订单，数字 = 阶段（{ORDER_STAGES.map((s, i) => `${i + 1} ${s}`).join(', ')}）。虚线 = 尚未复制（位于 high watermark 之上），消费者还看不到它。
          </>,
        )}
      </div>
      {c.partitions && (
        <button disabled={sim.partitions.length >= 12} onClick={() => act((s) => s.addPartition())}>
          + {tr('партиция', 'partition', '分区')}
        </button>
      )}
    </section>
  )
}

function PartitionRow({
  sim,
  p,
  win,
  onPick,
  picked,
}: {
  sim: KafkaSim
  p: Partition
  /** Сколько последних сообщений показать */
  win: number
  onPick: (m: Msg) => void
  picked: Msg | null
}) {
  const leo = sim.leaderLeo(p)
  const hw = sim.hw(p)
  const start = Math.max(p.logStart, leo - win)
  const cells = p.log.slice(start - p.logStart)
  return (
    <div className={'prow' + (p.leader === null ? ' offline' : '')} data-anchor={`partition-${p.id}`}>
      <div className="prow-head">
        <b>P{p.id}</b>
        <span className="replicas">
          {p.replicas.map((r) => {
            const alive = sim.broker(r).alive
            const cls = !alive ? 'dead' : r === p.leader ? 'leader' : p.isr.includes(r) ? 'isr' : 'out'
            const title = !alive
              ? tr(`брокер ${r} недоступен`, `broker ${r} is unavailable`, `Broker ${r} 不可用`)
              : r === p.leader
                ? tr(`лидер на брокере ${r}`, `leader on broker ${r}`, `领导者在 Broker ${r} 上`)
                : p.isr.includes(r)
                  ? tr(`фолловер на брокере ${r}, в ISR`, `follower on broker ${r}, in ISR`, `追随者在 Broker ${r} 上，位于 ISR 中`)
                  : tr(`фолловер на брокере ${r}, отстаёт на ${leo - Math.floor(p.leo[r])}`, `follower on broker ${r}, behind by ${leo - Math.floor(p.leo[r])}`, `追随者在 Broker ${r} 上，落后 ${leo - Math.floor(p.leo[r])}`)
            return (
              <span key={`${r}-${p.leader}-${alive}`} className={'rep ' + cls} title={title}>
                B{r}
                {r === p.leader ? '★' : ''}
              </span>
            )
          })}
        </span>
        <span className="small muted">
          offset {leo} · HW {hw}
        </span>
      </div>
      <div className="plog">
        {start > 0 && <span className="more">…{start}</span>}
        {cells.map((m) => (
          <span
            key={m.id}
            className={'msg' + (m.offset >= hw ? ' unrepl' : '') + (picked?.id === m.id ? ' picked' : '')}
            onClick={() => onPick(m)}
            style={{ background: m.offset >= hw ? 'transparent' : keyColor(m.orderId), borderColor: keyColor(m.orderId) }}
            title={tr(`${EVENT_TYPES[m.seq]} · offset ${m.offset} · ключ ${m.key ?? 'null'} — кликните, чтобы открыть событие`, `${EVENT_TYPES[m.seq]} · offset ${m.offset} · key ${m.key ?? 'null'} — click to open the event`, `${EVENT_TYPES[m.seq]} · offset ${m.offset} · key ${m.key ?? 'null'} — 点击打开该事件`)}
          >
            {m.seq + 1}
          </span>
        ))}
        {p.leader === null && <span className="offline-label">{tr('НЕДОСТУПНА', 'UNAVAILABLE', '不可用')}</span>}
      </div>
      <div className="pmarks" style={{ height: sim.groups.length * 14 + 2 }}>
        {sim.groups.map((g, gi) => {
          const pos = g.position[p.id] ?? 0
          const idx = pos - start
          const lag = sim.lag(g, p.id)
          const left = idx < 0 ? 0 : Math.min(idx, win)
          const tail = idx < 0 ? tr(` ◀ лаг ${lag}`, ` ◀ lag ${lag}`, ` ◀ 积压 ${lag}`) : lag > 0 ? ` (${lag})` : ''
          // у правого края ряда подпись уходит влево от отметки: иначе вылезла бы за панель и раздвинула страницу на телефоне
          const flip = left > win / 2
          return (
            <span
              key={g.id}
              className={'gmark g' + (gi % 4) + (flip ? ' flip' : '')}
              style={{ left: `calc(${left} * var(--cell))`, top: gi * 14 }}
              title={tr(`${g.name}: позиция ${pos}, лаг ${lag}`, `${g.name}: position ${pos}, lag ${lag}`, `${g.name}：位置 ${pos}，积压 ${lag}`)}
            >
              {flip ? `${g.name}${tail}▲` : `▲${g.name}${tail}`}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function GroupsPanel({ sim, act, c }: PanelProps) {
  return (
    <section className="panel">
      <h4>Consumer groups</h4>
      {sim.groups.map((g, gi) => {
        const rebal = sim.isRebalancing(g)
        const rate = g.consumers[0]?.rate ?? 10
        return (
          <div key={g.id} className={'card gcard g' + (gi % 4) + (rebal ? ' rebalancing' : '')}>
            <div className="card-head">
              <b>{g.name}</b>
              <span className={'badge ' + (rebal ? 'warn' : 'ok')}>{rebal ? tr('ребалансировка…', 'rebalancing…', '再均衡中…') : tr('работает', 'running', '运行中')}</span>
            </div>
            {g.consumers.length === 0 && <div className="small muted">{tr('нет консьюмеров', 'no consumers', '没有消费者')}</div>}
            {g.consumers.map((cn) => {
              const parts = sim.partitionsOf(g, cn.id)
              return (
                <div key={cn.id} className="consumer" data-anchor={`consumer-${g.id}-${cn.id}`}>
                  <span className="cname">{cn.name}</span>
                  <span className="cparts">
                    {rebal ? '—' : parts.length ? parts.map((p) => `P${p}`).join(' ') : <i className="muted">{tr('простаивает', 'idle', '空闲')}</i>}
                  </span>
                  {c.consumers && (
                    <>
                      <button
                        className="icon"
                        title={tr('Уронить (без коммита offset)', 'Crash (no offset commit)', '使其崩溃（不提交 offset）')}
                        onClick={() => act((s) => s.killConsumer(gi, cn.id))}
                      >
                        💥
                      </button>
                      <button
                        className="icon"
                        title={tr('Штатно остановить', 'Stop gracefully', '正常停止')}
                        onClick={() => act((s) => s.removeConsumer(gi, cn.id))}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              )
            })}
            {c.consumers && (
              <button onClick={() => act((s) => s.addConsumer(gi))} disabled={g.consumers.length >= 12}>
                + {tr('консьюмер', 'consumer', '消费者')}
              </button>
            )}
            <label>
              {tr(`обработка: ${rate} сообщ./с на консьюмера`, `processing: ${rate} msg/s per consumer`, `处理速度：每个消费者 ${rate} msg/s`)}
              <input
                type="range"
                min={1}
                max={60}
                value={rate}
                disabled={!c.consumerRate}
                onChange={(e) => act((s) => s.setGroupRate(gi, +e.target.value))}
              />
            </label>
            <div className="small">
              {tr('лаг', 'lag', '积压')} <b>{sim.totalLag(g)}</b> · {tr('обработано', 'processed', '已处理')} {g.processed} ·{' '}
              <span className={g.duplicates ? 'warn-text' : ''}>{tr('дубликатов', 'duplicates', '重复')} {g.duplicates}</span> ·{' '}
              <span className={g.violations ? 'bad-text' : ''}>{tr('нарушений порядка', 'order violations', '顺序错乱')} {g.violations}</span>
            </div>
          </div>
        )
      })}
      {c.groups && sim.groups.length < 4 && (
        <button
          onClick={() =>
            act((s) =>
              s.addGroup({
                name: ['billing', 'analytics', 'shipping', 'audit'][s.groups.length % 4],
                consumers: 1,
                consumerRate: 20,
              }),
            )
          }
        >
          + {tr('группа', 'group', '消费者组')}
        </button>
      )}
    </section>
  )
}

function BrokersPanel({ sim, act, c }: PanelProps) {
  return (
    <section className="panel">
      <h4>{tr('Брокеры', 'Brokers', 'Broker')}</h4>
      <div className="brokers">
        {sim.brokers.map((b) => {
          const leads = sim.partitions.filter((p) => p.leader === b.id).map((p) => `P${p.id}`)
          const follows = sim.partitions
            .filter((p) => p.replicas.includes(b.id) && p.leader !== b.id)
            .map((p) => `P${p.id}`)
          return (
            <div key={b.id} className={'broker' + (b.alive ? '' : ' dead') + (b.slow ? ' slow' : '')}>
              <div className="card-head">
                <b>{tr('Брокер', 'Broker', 'Broker')} {b.id}</b>
                <span className={'badge ' + (b.alive ? (b.slow ? 'warn' : 'ok') : 'bad')}>
                  {b.alive ? (b.slow ? tr('тормозит', 'slow', '变慢') : tr('в строю', 'up', '运行中')) : tr('упал', 'down', '已宕机')}
                </span>
              </div>
              <div className="small">{tr('лидер', 'leader', '领导者')}: {leads.join(' ') || '—'}</div>
              <div className="small muted">{tr('реплики', 'replicas', '副本')}: {follows.join(' ') || '—'}</div>
              {c.brokers && (
                <div className="row">
                  {b.alive ? (
                    <button onClick={() => act((s) => s.killBroker(b.id))}>💥 {tr('Уронить', 'Kill', '使其宕机')}</button>
                  ) : (
                    <button onClick={() => act((s) => s.restartBroker(b.id))}>↑ {tr('Поднять', 'Restart', '重启')}</button>
                  )}
                  <button disabled={!b.alive} onClick={() => act((s) => s.toggleSlow(b.id))}>
                    {b.slow ? tr('Починить', 'Fix', '修复') : tr('🐢 Замедлить', '🐢 Slow down', '🐢 减速')}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function EventLog({ sim }: { sim: KafkaSim }) {
  return (
    <section className="panel events">
      <h4>{tr('Журнал событий', 'Event log', '事件日志')}</h4>
      <ul>
        {sim.events.slice(0, 14).map((e, i) => (
          <li key={sim.events.length - i + '-' + e.t} className={e.kind}>
            <span className="muted">{e.t.toFixed(1)}{tr('с', 's', 's')}</span> {e.text}
          </li>
        ))}
        {sim.events.length === 0 && <li className="muted">{tr('Пока тихо', 'All quiet so far', '暂时风平浪静')}</li>}
      </ul>
    </section>
  )
}

/** Последние события в топике и полная запись выбранного события — как в kafka-console-consumer */
function EventInspector({ sim, picked, onPick }: { sim: KafkaSim; picked: Msg | null; onPick: (m: Msg | null) => void }) {
  const tail = sim.partitions
    .flatMap((p) => p.log.slice(-8))
    .sort((a, b) => b.id - a.id)
    .slice(0, 8)
  return (
    <section className="panel inspector">
      <div className="card-head">
        <h4>
          {picked
            ? tr(`Событие · P${picked.partition} · offset ${picked.offset}`, `Event · P${picked.partition} · offset ${picked.offset}`, `事件 · P${picked.partition} · offset ${picked.offset}`)
            : tr('Поток событий в топике orders', 'Event stream in the orders topic', 'orders topic 中的事件流')}
        </h4>
        {picked && (
          <button className="icon" onClick={() => onPick(null)} title={tr('Назад к потоку', 'Back to the stream', '返回事件流')}>
            ✕
          </button>
        )}
      </div>
      {!picked && (
        <>
          <p className="small muted">
            {tr(
              'Так выглядят последние записи, если подписаться на топик консольным консьюмером. Кликните по строке или по квадратику в партиции, чтобы открыть событие целиком.',
              'This is what the latest records look like through a console consumer. Click a line or a square in a partition to open the full event.',
              '这就是用控制台消费者订阅 topic 时看到的最新记录。点击某一行或分区里的小方块，即可打开完整的事件。',
            )}
          </p>
          <div className="console">
            <div className="console-cmd">$ kafka-console-consumer --topic orders --property print.key=true --property print.partition=true</div>
            {tail.map((m) => {
              const pl = eventPayload(m)
              const compact = JSON.stringify({ type: pl.type, orderId: pl.orderId, ...('total' in pl ? { total: pl.total } : {}), ...('amount' in pl ? { amount: pl.amount } : {}), ...('courier' in pl ? { courier: pl.courier } : {}) })
              return (
                <div key={m.id} className="console-line" onClick={() => onPick(m)}>
                  <span className="muted">Partition:{m.partition}</span> <span className="console-key">{m.key ?? 'null'}</span> {compact}
                </div>
              )
            })}
            {tail.length === 0 && <div className="muted">{tr('…ждём первые события', '…waiting for the first events', '…正在等待第一批事件')}</div>}
          </div>
        </>
      )}
      {picked && (
        <div className="inspector-body">
          <table className="cmp small">
            <tbody>
              <tr>
                <td>topic / partition / offset</td>
                <td>
                  orders / {picked.partition} / {picked.offset}
                </td>
              </tr>
              <tr>
                <td>key</td>
                <td>
                  <code>{picked.key ?? 'null'}</code>{' '}
                  <span className="muted">
                    {picked.key === null
                      ? tr('— без ключа партиция выбрана по кругу', '— no key, partition chosen round-robin', '— 没有 key，分区按轮询选出')
                      : tr('— hash(key) % партиций выбрал эту партицию', '— hash(key) % partitions picked this partition', '— hash(key) % 分区数 选中了这个分区')}
                  </span>
                </td>
              </tr>
              <tr>
                <td>headers</td>
                <td>
                  {Object.entries(eventHeaders(picked)).map(([k, v]) => (
                    <div key={k}>
                      <code>{k}</code>: {v}
                    </div>
                  ))}
                </td>
              </tr>
              <tr>
                <td>{tr('подтверждено', 'acknowledged', '已确认')}</td>
                <td>{picked.acked ? tr('да', 'yes', '是') : tr('ещё нет — ждём реплики', 'not yet — waiting for replicas', '尚未确认——正在等待副本')}</td>
              </tr>
              {sim.groups.map((g) => {
                const done = (g.position[picked.partition] ?? 0) > picked.offset
                return (
                  <tr key={g.id}>
                    <td>
                      {tr('группа', 'group', '消费者组')} {g.name}
                    </td>
                    <td className={done ? 'ok-text' : 'warn-text'}>
                      {done
                        ? tr('обработала', 'processed', '已处理')
                        : tr(`ещё не дошла (позиция ${g.position[picked.partition] ?? 0})`, `not reached yet (position ${g.position[picked.partition] ?? 0})`, `尚未处理到（位置 ${g.position[picked.partition] ?? 0}）`)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <pre className="json">{JSON.stringify(eventPayload(picked), null, 2)}</pre>
        </div>
      )}
    </section>
  )
}
