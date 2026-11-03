import { useEffect, useRef, useState } from 'react'
import { tr } from '../../i18n'
import { KINDS, type BEdge, type BNode, type Result } from './model'
import { emulateRequest, pickClient, type Span, type Trace } from './emulate'
import { HOP_MS, type LiveTrace } from './BuilderCanvas'

/**
 * Журнал читают глазами: показываем его снимками раз в пару секунд, а не каждые 450 мс.
 * Точки на схеме при этом бегут непрерывно.
 */
export function useCalm<T>(value: T, ms = 2000): T {
  const [shown, setShown] = useState(value)
  const latest = useRef(value)
  latest.current = value
  const empty = Array.isArray(shown) && shown.length === 0
  useEffect(() => {
    // первые данные показываем сразу, дальше — по таймеру
    if (empty && Array.isArray(value) && value.length > 0) setShown(value)
  }, [empty, value])
  useEffect(() => {
    const h = setInterval(() => setShown(latest.current), ms)
    return () => clearInterval(h)
  }, [ms])
  return shown
}

/** Сколько запросов держим в журнале */
const LOG_SIZE = 60

/**
 * Живой трафик: раз в несколько сотен миллисекунд клиент отправляет настоящий запрос,
 * он проходит по схеме, а результат попадает в журнал. Схему можно менять на ходу.
 */
export function useLiveTraffic(nodes: BNode[], edges: BEdge[], result: Result, enabled: boolean) {
  const [running, setRunning] = useState(true)
  const [inFlight, setInFlight] = useState<LiveTrace[]>([])
  const [log, setLog] = useState<Trace[]>([])
  const latest = useRef({ nodes, edges, result })
  latest.current = { nodes, edges, result }
  // схема изменилась (не просто сдвинули блок) — старый журнал больше не про неё
  const sig = JSON.stringify([nodes.map(({ x: _x, y: _y, ...rest }) => rest), edges])
  useEffect(() => {
    setLog([])
    setInFlight([])
  }, [sig])

  useEffect(() => {
    if (!enabled || !running) return
    const tick = () => {
      const { nodes, edges, result } = latest.current
      const client = pickClient(nodes)
      if (!client) return
      const t = emulateRequest(nodes, edges, result, client.id)
      if (!t) return
      const now = performance.now()
      const alive = (x: LiveTrace) => now - x.born < (x.hops.length + 2) * HOP_MS * 1.4 + 1500
      setInFlight((xs) => [...xs.filter(alive), { ...t, born: now }].slice(-24))
      setLog((xs) => [t, ...xs].slice(0, LOG_SIZE))
    }
    tick()
    const h = setInterval(tick, 450)
    return () => clearInterval(h)
  }, [enabled, running])

  // после паузы точки догорают и исчезают
  useEffect(() => {
    if (running) return
    const h = setTimeout(() => setInFlight([]), 4000)
    return () => clearTimeout(h)
  }, [running])

  return { running, setRunning, inFlight: enabled ? inFlight : [], log }
}

const STATUS_CLASS: Record<Span['status'], string> = {
  ok: 'ok',
  hit: 'hit',
  miss: 'miss',
  slow: 'slow',
  error: 'error',
  queued: 'queued',
  async: 'async',
}

const STATUS_LABEL: Record<Span['status'], string> = {
  ok: 'OK',
  hit: 'HIT',
  miss: 'MISS',
  slow: tr('медленно', 'slow', '慢'),
  error: tr('ошибка', 'error', '错误'),
  queued: tr('в очереди', 'queued', '排队中'),
  async: tr('фоном', 'async', '异步'),
}

export const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} ${tr('с', 's', 's')}` : `${v < 10 ? v.toFixed(1) : Math.round(v)} ${tr('мс', 'ms', 'ms')}`)

function codeOf(t: Trace) {
  return t.httpStatus ? String(t.httpStatus) : 'ERR'
}

/** Журнал запросов + водопад выбранного */
export function TrafficPanel({
  log,
  nodes,
  describe,
  running,
  setRunning,
  onPickNode,
}: {
  log: Trace[]
  nodes?: BNode[]
  /** Подпись узла трассы; по умолчанию — блок конструктора */
  describe?: (id: string) => { icon: string; label: string } | undefined
  running: boolean
  setRunning: (v: boolean) => void
  onPickNode: (id: string) => void
}) {
  const [pinned, setPinned] = useState<number | null>(null)
  const byId = Object.fromEntries((nodes ?? []).map((n) => [n.id, n]))
  const name = describe ?? ((id: string) => (byId[id] ? { icon: KINDS[byId[id].kind].icon, label: byId[id].label } : undefined))
  const calm = useCalm(log)
  const shown = (pinned !== null && log.find((t) => t.id === pinned)) || calm.slice(0, 8).find((t) => t.status === 'error') || calm[0]
  const recent = calm.slice(0, 40)
  const errors = recent.filter((t) => t.status === 'error').length
  const p95 = (() => {
    const xs = recent.filter((t) => t.status === 'ok').map((t) => t.totalMs).sort((a, b) => a - b)
    return xs.length ? xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))] : 0
  })()

  return (
    <div className="traffic-panel">
      <div className="traffic-head">
        <h4>📡 {tr('Живой трафик', 'Live traffic', '实时流量')}</h4>
        <button className={running ? '' : 'primary'} onClick={() => setRunning(!running)}>
          {running ? tr('⏸ Пауза', '⏸ Pause', '⏸ 暂停') : tr('▶ Пустить трафик', '▶ Resume traffic', '▶ 恢复流量')}
        </button>
        {recent.length > 0 && (
          <span className="small muted">
            {tr(`последние ${recent.length}:`, `last ${recent.length}:`, `最近 ${recent.length} 个请求：`)}{' '}
            <b className={errors ? 'bad-text' : 'ok-text'}>
              {tr(`${errors} ошибок`, `${errors} errors`, `${errors} 个错误`)}
            </b>{' '}
            · p95 {ms(p95)}
          </span>
        )}
      </div>
      <div className="traffic-cols">
        <div className="access-log" role="list">
          <div className="log-slide">
          {calm.slice(0, 14).map((t) => (
            <button
              key={t.id}
              role="listitem"
              className={'access-row' + (shown?.id === t.id ? ' active' : '') + (t.status === 'error' ? ' err' : '')}
              onClick={() => {
                setPinned(t.id)
                setRunning(false)
              }}
              title={tr('Показать путь запроса', 'Show the request path', '查看请求路径')}
            >
              <span className={'code ' + (t.status === 'error' ? 'bad' : 'ok')}>{codeOf(t)}</span>
              <span className="req">{t.request.split('  ')[0]}</span>
              <span className="dur">{ms(t.totalMs)}</span>
            </button>
          ))}
          </div>
          {!calm.length && <p className="small muted">{tr('Подключите клиента — запросы появятся здесь', 'Connect a client: requests will show up here', '连接一个客户端，请求就会显示在这里')}</p>}
        </div>
        {shown ? (
          <Waterfall trace={shown} describe={name} onPickNode={onPickNode} />
        ) : (
          <div className="waterfall small muted">{tr('Здесь появится путь запроса по блокам', 'The request path through the blocks will appear here', '这里会显示请求经过各个组件的路径')}</div>
        )}
      </div>
    </div>
  )
}

function Waterfall({
  trace,
  describe,
  onPickNode,
}: {
  trace: Trace
  describe: (id: string) => { icon: string; label: string } | undefined
  onPickNode: (id: string) => void
}) {
  const span = Math.max(1, trace.totalMs, ...trace.spans.map((s) => s.start + s.ms))
  return (
    <div className="waterfall">
      <div className="wf-req">
        <span className={'code ' + (trace.status === 'error' ? 'bad' : 'ok')}>{codeOf(trace)}</span> <code>{trace.request}</code>
        <span className="muted small"> · {ms(trace.totalMs)} · trace {trace.id.toString(16).padStart(8, '0')}</span>
      </div>
      {trace.spans.map((s, i) => {
        const n = describe(s.nodeId)
        if (!n) return null
        return (
          <div key={i} className={'wf-row ' + STATUS_CLASS[s.status]}>
            <button className="wf-name" style={{ paddingLeft: 4 + (s.depth - 1) * 12 }} onClick={() => onPickNode(s.nodeId)} title={tr('Выделить блок', 'Select block', '选中该组件')}>
              {n.icon} {n.label}
            </button>
            <div className="wf-track">
              <div className="wf-bar" style={{ left: `${(s.start / span) * 100}%`, width: `${Math.max(0.6, (s.ms / span) * 100)}%` }} />
            </div>
            <span className="wf-ms">{ms(s.ms)}</span>
            <div className="wf-op">
              <code>{s.op}</code> <span className={'wf-status ' + STATUS_CLASS[s.status]}>{STATUS_LABEL[s.status]}</span>
              {s.detail && <div className="wf-detail">{s.detail}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Последние операции выбранного блока — как его собственный лог */
export function NodeLog({ nodeId, log }: { nodeId: string; log: Trace[] }) {
  const calm = useCalm(log)
  const lines: { t: Trace; s: Span }[] = []
  for (const t of calm) {
    for (const s of t.spans) if (s.nodeId === nodeId) lines.push({ t, s })
    if (lines.length >= 10) break
  }
  return (
    <div className="node-log">
      <div className="pattern-group-title">{tr('Лог блока', 'Block log', '组件日志')}</div>
      {!lines.length && <p className="small muted">{tr('Сюда пока не дошёл ни один запрос', 'No request has reached this block yet', '还没有请求到达这个组件')}</p>}
      <div className="log-window">
      <div className="log-slide">
      {lines.slice(0, 10).map(({ t, s }) => (
        <div key={`${t.id}-${t.spans.indexOf(s)}`} className={'log-line ' + STATUS_CLASS[s.status]}>
          <span className="wf-ms">{ms(s.ms)}</span> <code>{s.op}</code>{' '}
          {s.status !== 'ok' && <span className={'wf-status ' + STATUS_CLASS[s.status]}>{STATUS_LABEL[s.status]}</span>}
          {s.detail && <div className="wf-detail">{s.detail}</div>}
        </div>
      ))}
      </div>
      </div>
    </div>
  )
}
