import { tr } from '../../i18n'
import { type ReactNode } from 'react'
import { ORDER_STAGES, keyColor, type Acks, type KafkaConfig, type KafkaSim, type KeyStrategy, type Partition } from './engine'
import { useKafkaSim } from './useKafkaSim'
import { Sparkline } from '../../components/Sparkline'
import { FlightLayer } from '../../components/FlightLayer'

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
  none: tr('без ключа (round-robin)', 'no key (round-robin)'),
  order: tr('ключ = id заказа', 'key = order id'),
  customer: tr('ключ = клиент', 'key = customer'),
}

const WINDOW = 22

export function KafkaSimulator({ config, controls = {}, onTick, extraActions, compact }: Props) {
  const { sim, running, setRunning, speed, setSpeed, reset, act } = useKafkaSim(config, onTick)
  const c = controls
  const totalLag = sim.groups.reduce((s, g) => s + sim.totalLag(g), 0)
  const last = sim.history[sim.history.length - 1]

  return (
    <div className={'ksim' + (compact ? ' ksim-compact' : '')}>
      <div className="ksim-toolbar">
        <button onClick={() => setRunning(!running)}>{running ? tr('⏸ Пауза', '⏸ Pause') : tr('▶ Пуск', '▶ Run')}</button>
        <button onClick={reset}>{tr('↺ Сначала', '↺ Restart')}</button>
        <label className="inline">
          {tr('скорость', 'speed')}
          <select value={speed} onChange={(e) => setSpeed(+e.target.value)}>
            <option value={0.5}>×0.5</option>
            <option value={1}>×1</option>
            <option value={2}>×2</option>
            <option value={4}>×4</option>
          </select>
        </label>
        <span className="muted">t = {sim.now.toFixed(1)} {tr('с', 's')}</span>
        <span className="spacer" />
        {extraActions?.(sim, act)}
      </div>

      <div className="ksim-metrics">
        <Metric label={tr('записано/с', 'written/s')} value={last ? last.produced.toFixed(0) : '0'} />
        <Metric label={tr('прочитано/с', 'read/s')} value={last ? last.consumed.toFixed(0) : '0'} />
        <Metric label={tr('лаг (всего)', 'lag (total)')} value={totalLag} tone={totalLag > 50 ? 'bad' : totalLag > 15 ? 'warn' : 'ok'}>
          <Sparkline values={sim.history.map((h) => h.lag)} />
        </Metric>
        <Metric label={tr('отказы записи', 'write rejections')} value={sim.rejected} tone={sim.rejected ? 'warn' : undefined} />
        <Metric label={tr('потеряно подтверждённых', 'acknowledged lost')} value={sim.lostAcked} tone={sim.lostAcked ? 'bad' : 'ok'} />
        <Metric
          label={tr('партиций офлайн', 'partitions offline')}
          value={sim.offlinePartitions()}
          tone={sim.offlinePartitions() ? 'bad' : 'ok'}
        />
      </div>

      <div className="ksim-main">
        <ProducersPanel sim={sim} act={act} c={c} />
        <TopicPanel sim={sim} act={act} c={c} />
        <GroupsPanel sim={sim} act={act} c={c} />
        <FlightLayer queue={sim.flights} duration={650 / Math.sqrt(speed)} />
      </div>

      <div className="ksim-bottom">
        <BrokersPanel sim={sim} act={act} c={c} />
        <EventLog sim={sim} />
      </div>
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
      <h4>{tr('Продюсеры', 'Producers')}</h4>
      {sim.producers.map((p) => (
        <div key={p.id} className="card" data-anchor={`producer-${p.id}`}>
          <div className="card-head">
            <b>Producer {p.id}</b>
            {c.producers && sim.producers.length > 1 && (
              <button className="icon" title={tr('Удалить', 'Remove')} onClick={() => act((s) => s.removeProducer(p.id))}>
                ✕
              </button>
            )}
          </div>
          <label>
            {p.rate} {tr('сообщ./с', 'msg/s')}
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
            {tr('ключ', 'key')}
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
              <option value="0">{tr('0 — не ждать', '0 — no wait')}</option>
              <option value="1">{tr('1 — ждать лидера', '1 — wait for leader')}</option>
              <option value="all">{tr('all — ждать все ISR', 'all — wait for all ISR')}</option>
            </select>
          </label>
          <div className="small muted">
            {tr(`отправлено ${p.sent} · подтверждено ${p.acked} · ошибок ${p.failed}`, `sent ${p.sent} · acked ${p.acked} · errors ${p.failed}`)}
          </div>
        </div>
      ))}
      {c.producers && (
        <button
          onClick={() => act((s) => s.addProducer({ rate: 10, keyStrategy: 'order', acks: 'all' }))}
        >
          + {tr('продюсер', 'producer')}
        </button>
      )}
      {c.reliability && (
        <div className="card">
          <b>{tr('Настройки топика', 'Topic settings')}</b>
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

function TopicPanel({ sim, act, c }: PanelProps) {
  return (
    <section className="panel topic">
      <h4>
        {tr('Топик', 'Topic')} <code>orders</code>
        <span className="muted small">
          {' '}
          · {sim.partitions.length} {tr('партиций', 'partitions')} · RF={sim.config.replicationFactor}
        </span>
      </h4>
      {sim.partitions.map((p) => (
        <PartitionRow key={p.id} sim={sim} p={p} />
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
        )}
      </div>
      {c.partitions && (
        <button disabled={sim.partitions.length >= 12} onClick={() => act((s) => s.addPartition())}>
          + {tr('партиция', 'partition')}
        </button>
      )}
    </section>
  )
}

function PartitionRow({ sim, p }: { sim: KafkaSim; p: Partition }) {
  const leo = sim.leaderLeo(p)
  const hw = sim.hw(p)
  const start = Math.max(p.logStart, leo - WINDOW)
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
              ? tr(`брокер ${r} недоступен`, `broker ${r} is unavailable`)
              : r === p.leader
                ? tr(`лидер на брокере ${r}`, `leader on broker ${r}`)
                : p.isr.includes(r)
                  ? tr(`фолловер на брокере ${r}, в ISR`, `follower on broker ${r}, in ISR`)
                  : tr(`фолловер на брокере ${r}, отстаёт на ${leo - Math.floor(p.leo[r])}`, `follower on broker ${r}, behind by ${leo - Math.floor(p.leo[r])}`)
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
            className={'msg' + (m.offset >= hw ? ' unrepl' : '')}
            style={{ background: m.offset >= hw ? 'transparent' : keyColor(m.orderId), borderColor: keyColor(m.orderId) }}
            title={tr(`offset ${m.offset} · ключ ${m.key ?? 'null'} · заказ #${m.orderId}: ${ORDER_STAGES[m.seq]}`, `offset ${m.offset} · key ${m.key ?? 'null'} · order #${m.orderId}: ${ORDER_STAGES[m.seq]}`)}
          >
            {m.seq + 1}
          </span>
        ))}
        {p.leader === null && <span className="offline-label">{tr('НЕДОСТУПНА', 'UNAVAILABLE')}</span>}
      </div>
      <div className="pmarks" style={{ height: sim.groups.length * 14 + 2 }}>
        {sim.groups.map((g, gi) => {
          const pos = g.position[p.id] ?? 0
          const idx = pos - start
          const lag = sim.lag(g, p.id)
          const left = idx < 0 ? 0 : Math.min(idx, WINDOW)
          return (
            <span
              key={g.id}
              className={'gmark g' + (gi % 4)}
              style={{ left: `calc(${left} * var(--cell))`, top: gi * 14 }}
              title={tr(`${g.name}: позиция ${pos}, лаг ${lag}`, `${g.name}: position ${pos}, lag ${lag}`)}
            >
              ▲{g.name}
              {idx < 0 ? tr(` ◀ лаг ${lag}`, ` ◀ lag ${lag}`) : lag > 0 ? ` (${lag})` : ''}
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
              <span className={'badge ' + (rebal ? 'warn' : 'ok')}>{rebal ? tr('ребалансировка…', 'rebalancing…') : tr('работает', 'running')}</span>
            </div>
            {g.consumers.length === 0 && <div className="small muted">{tr('нет консьюмеров', 'no consumers')}</div>}
            {g.consumers.map((cn) => {
              const parts = sim.partitionsOf(g, cn.id)
              return (
                <div key={cn.id} className="consumer" data-anchor={`consumer-${g.id}-${cn.id}`}>
                  <span className="cname">{cn.name}</span>
                  <span className="cparts">
                    {rebal ? '—' : parts.length ? parts.map((p) => `P${p}`).join(' ') : <i className="muted">{tr('простаивает', 'idle')}</i>}
                  </span>
                  {c.consumers && (
                    <>
                      <button
                        className="icon"
                        title={tr('Уронить (без коммита offset)', 'Crash (no offset commit)')}
                        onClick={() => act((s) => s.killConsumer(gi, cn.id))}
                      >
                        💥
                      </button>
                      <button
                        className="icon"
                        title={tr('Штатно остановить', 'Stop gracefully')}
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
                + {tr('консьюмер', 'consumer')}
              </button>
            )}
            <label>
              {tr(`обработка: ${rate} сообщ./с на консьюмера`, `processing: ${rate} msg/s per consumer`)}
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
              {tr('лаг', 'lag')} <b>{sim.totalLag(g)}</b> · {tr('обработано', 'processed')} {g.processed} ·{' '}
              <span className={g.duplicates ? 'warn-text' : ''}>{tr('дубликатов', 'duplicates')} {g.duplicates}</span> ·{' '}
              <span className={g.violations ? 'bad-text' : ''}>{tr('нарушений порядка', 'order violations')} {g.violations}</span>
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
          + {tr('группа', 'group')}
        </button>
      )}
    </section>
  )
}

function BrokersPanel({ sim, act, c }: PanelProps) {
  return (
    <section className="panel">
      <h4>{tr('Брокеры', 'Brokers')}</h4>
      <div className="brokers">
        {sim.brokers.map((b) => {
          const leads = sim.partitions.filter((p) => p.leader === b.id).map((p) => `P${p.id}`)
          const follows = sim.partitions
            .filter((p) => p.replicas.includes(b.id) && p.leader !== b.id)
            .map((p) => `P${p.id}`)
          return (
            <div key={b.id} className={'broker' + (b.alive ? '' : ' dead') + (b.slow ? ' slow' : '')}>
              <div className="card-head">
                <b>{tr('Брокер', 'Broker')} {b.id}</b>
                <span className={'badge ' + (b.alive ? (b.slow ? 'warn' : 'ok') : 'bad')}>
                  {b.alive ? (b.slow ? tr('тормозит', 'slow') : tr('в строю', 'up')) : tr('упал', 'down')}
                </span>
              </div>
              <div className="small">{tr('лидер', 'leader')}: {leads.join(' ') || '—'}</div>
              <div className="small muted">{tr('реплики', 'replicas')}: {follows.join(' ') || '—'}</div>
              {c.brokers && (
                <div className="row">
                  {b.alive ? (
                    <button onClick={() => act((s) => s.killBroker(b.id))}>💥 {tr('Уронить', 'Kill')}</button>
                  ) : (
                    <button onClick={() => act((s) => s.restartBroker(b.id))}>↑ {tr('Поднять', 'Restart')}</button>
                  )}
                  <button disabled={!b.alive} onClick={() => act((s) => s.toggleSlow(b.id))}>
                    {b.slow ? tr('Починить', 'Fix') : tr('🐢 Замедлить', '🐢 Slow down')}
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
      <h4>{tr('Журнал событий', 'Event log')}</h4>
      <ul>
        {sim.events.slice(0, 14).map((e, i) => (
          <li key={sim.events.length - i + '-' + e.t} className={e.kind}>
            <span className="muted">{e.t.toFixed(1)}{tr('с', 's')}</span> {e.text}
          </li>
        ))}
        {sim.events.length === 0 && <li className="muted">{tr('Пока тихо', 'All quiet so far')}</li>}
      </ul>
    </section>
  )
}
