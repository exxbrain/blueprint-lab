import type { ReactElement } from 'react'
import { tr } from '../../i18n'
import { has, type PatternId } from './patterns'
import { modeOf, type Dep, type DepMode, type ModuleId, type Project, type State } from './model'

/**
 * Паттерны на схеме распила — тем, чем они физически являются: отдельными узлами платформы и их связями с сервисами,
 * деталями на связях и на входе, обёртками вокруг сервисов. Значок или название без места на схеме не объясняет,
 * что паттерн меняет; здесь видно, куда сервис шлёт трейсы, через что идёт вызов и во что сервис завёрнут.
 */

type Pt = { x: number; y: number }
type Rect = { x: number; y: number; w: number; h: number }
export interface EdgeGeom {
  d: Dep
  mode: DepMode | null
  geom: { a: Pt; c: Pt; b: Pt }
}

interface Ctx {
  project: Project
  state: State
  /** Левый верхний угол блока модуля (анимированный) */
  pos: Record<string, Pt>
  box: { w: number; h: number }
  mono: Rect
  monoDb: Rect
  /** Высота доски */
  H: number
  /** Куда входят запросы клиентов: шлюз или сразу монолит */
  entry: Pt
}

const on = (s: State, k: PatternId) => !!s.infra[k]

/** Вынесенные сервисы и, пока в нём что-то осталось, монолит — всё, что работает в проде */
function workloads(c: Ctx): { id: string; r: Rect }[] {
  const out: { id: string; r: Rect }[] = []
  for (const m of c.project.modules)
    if (c.state.extracted[m.id]) out.push({ id: m.id, r: { x: c.pos[m.id].x, y: c.pos[m.id].y, w: c.box.w, h: c.box.h } })
  if (c.project.modules.some((m) => !c.state.extracted[m.id])) out.push({ id: 'monolith', r: c.mono })
  return out
}

/** Точка квадратичной кривой связи при параметре t */
function at(g: EdgeGeom['geom'], t: number): Pt {
  const u = 1 - t
  return { x: u * u * g.a.x + 2 * u * t * g.c.x + t * t * g.b.x, y: u * u * g.a.y + 2 * u * t * g.c.y + t * t * g.b.y }
}

// ---------------- обёртки (под модулями) ----------------

/**
 * Kubernetes — кластер вокруг вынесенных сервисов: каждый сервис в своём поде, служебный узел (control plane)
 * распределяет поды и следит за ними, хранилище даёт базам сервисов тома. Mesh — в каждом поде рядом с сервисом
 * sidecar-прокси, через который идут все вызовы.
 */
export function PatternWrappers(c: Ctx) {
  const ext = c.project.modules.filter((m) => c.state.extracted[m.id])
  const els: ReactElement[] = []
  if (on(c.state, 'containers') && ext.length) {
    const xs = ext.map((m) => c.pos[m.id].x)
    const ys = ext.map((m) => c.pos[m.id].y)
    const pad = 20
    const x0 = Math.min(...xs) - pad
    const y0 = Math.min(...ys) - 34
    const x1 = Math.max(...xs) + c.box.w + 80 + pad
    const y1 = Math.max(...ys) + c.box.h + pad
    const cp = { x: x0 + 10, y: y0 + 5, w: 300, h: 20 }
    const st = { x: x0 + 10, y: y1 - 8, w: 250, h: 20 }
    const withDb = ext.filter((m) => c.state.ownDb[m.id])
    els.push(
      <g key="k8s" className="appear pl-cluster">
        <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0 + 16} rx={18} />
        {/* хранилище: тома под базы сервисов */}
        {withDb.map((m) => {
          const db = { x: c.pos[m.id].x + c.box.w + 40, y: c.pos[m.id].y + 50 }
          return <path key={'pv-' + m.id} d={`M${db.x},${db.y} C${db.x},${st.y - 10} ${st.x + st.w / 2},${db.y + 30} ${st.x + st.w / 2},${st.y}`} className="pl-line tone-k8s" />
        })}
        <g className="pl-node tone-k8s">
          <rect x={cp.x} y={cp.y} width={cp.w} height={cp.h} rx={6} />
          <text x={cp.x + 10} y={cp.y + 14} className="pl-cluster-label">
            ☸ {tr('Control plane: API-сервер · планировщик · etcd', 'Control plane: API server · scheduler · etcd', '控制平面：API Server · 调度器 · etcd')}
          </text>
          <title>{tr('Служебные узлы кластера: раскладывают поды по машинам, перезапускают упавшие, добавляют экземпляры под нагрузку', 'The cluster’s control plane: places pods on machines, restarts failed ones and adds instances under load', '集群的控制平面：把 Pod 调度到机器上，重启失败的 Pod，负载上来时增加实例')}</title>
        </g>
        <g className="pl-node tone-k8s">
          <rect x={st.x} y={st.y} width={st.w} height={st.h} rx={6} />
          <text x={st.x + 10} y={st.y + 14} className="pl-cluster-label">
            💾 {tr('Хранилище: тома (PV) для баз сервисов', 'Storage: volumes (PV) for service databases', '存储：服务数据库的卷（PV）')}
          </text>
          <title>{tr('Данные баз лежат на томах, которые переживают перезапуск и переезд пода', 'Database data lives on volumes that survive pod restarts and moves', '数据库数据存放在卷上，Pod 重启或迁移后依然保留')}</title>
        </g>
      </g>,
    )
  }
  // canary: за сервисом выглядывает вторая версия (v2), на неё уходит 5% трафика
  if (on(c.state, 'canary'))
    for (const w of workloads(c)) {
      if (w.id === 'monolith') continue
      els.push(<rect key={'v2-' + w.id} x={w.r.x + 6} y={w.r.y + 6} width={w.r.w} height={w.r.h} rx={10} className="appear pl-canary-shadow" />)
    }
  // под: сервис + sidecar-прокси (mesh) или просто контейнер сервиса
  for (const w of workloads(c)) {
    if (w.id === 'monolith') continue
    const pod = has(c.state.infra, 'mesh')
    const cont = on(c.state, 'containers')
    if (!pod && !cont) continue
    const r = w.r
    els.push(
      <g key={'pod-' + w.id} className={'appear ' + (pod ? 'pl-pod' : 'pl-container')}>
        <rect x={r.x - 7} y={r.y - 9} width={r.w + (pod ? 32 : 14)} height={r.h + 16} rx={12} />
        <text x={r.x - 2} y={r.y + r.h + 5} className="pl-pod-label">
          pod
        </text>
        <title>
          {pod
            ? tr('Под: сервис и sidecar-прокси mesh. Все вызовы идут через прокси — там шифрование, повторы и предохранитель', 'Pod: the service and its mesh sidecar proxy. All calls go through the proxy, which handles encryption, retries and the circuit breaker', 'Pod：服务及其 mesh sidecar 代理。所有调用都经过代理，由它负责加密、重试和熔断')
            : tr('Контейнер: сервис со всеми зависимостями, одинаковый на всех стендах', 'Container: the service with all its dependencies, identical in every environment', '容器：服务连同所有依赖，在每个环境中都一样')}
        </title>
      </g>,
    )
  }
  return <g className="pl-wrappers">{els}</g>
}

// ---------------- узлы платформы и их связи ----------------

interface PlatformNode {
  id: PatternId
  /** Место: колонка 0–3 и строка 0–1 в полосе над сервисами */
  col: number
  row: number
  label: () => string
  /** Как узел связан с сервисами: кто кому и что передаёт */
  flow: 'toNode' | 'fromNode' | 'both'
  note: () => string
  tone: string
}

const NODES: PlatformNode[] = [
  { id: 'accessToken', col: 0, row: 0, label: () => tr('🔑 Сервер авторизации', '🔑 Auth server', '🔑 授权服务器'), flow: 'fromNode', tone: 'auth', note: () => tr('Выдаёт клиенту токен (JWT); шлюз и сервисы проверяют подпись токена сами, без похода сюда', 'Issues the client a token (JWT); the gateway and services verify its signature themselves, without calling here', '给客户端签发令牌（JWT）；网关和服务自己校验签名，无需回调这里') },
  { id: 'discovery', col: 1, row: 0, label: () => tr('🧭 Реестр сервисов', '🧭 Service registry', '🧭 服务注册中心'), flow: 'both', tone: 'infra', note: () => tr('Сервисы регистрируются при старте и узнают здесь адреса друг друга', 'Services register on startup and look up each other’s addresses here', '服务启动时在此注册，并在此查到彼此的地址') },
  { id: 'config', col: 2, row: 0, label: () => tr('⚙️ Конфиг-сервер', '⚙️ Config server', '⚙️ 配置服务器'), flow: 'fromNode', tone: 'infra', note: () => tr('Раздаёт сервисам настройки и адреса — меняются без нового релиза', 'Hands settings and addresses to services; they change without a new release', '向服务下发配置和地址；修改无需重新发布') },
  { id: 'contracts', col: 3, row: 0, label: () => tr('🤝 Брокер контрактов', '🤝 Contract broker', '🤝 契约代理'), flow: 'both', tone: 'infra', note: () => tr('Потребители публикуют ожидания от API, поставщики проверяют их в своём CI до релиза', 'Consumers publish their API expectations; providers verify them in CI before release', '消费方发布对 API 的期望，提供方在发布前于 CI 中验证') },
  { id: 'tracing', col: 0, row: 1, label: () => tr('🔭 Сборщик трейсов', '🔭 Trace collector', '🔭 链路追踪收集器'), flow: 'toNode', tone: 'obs', note: () => tr('Каждый сервис шлёт сюда спаны с trace id — видна вся цепочка вызовов запроса', 'Every service sends spans with a trace id here, so the whole call chain of a request is visible', '每个服务把带 trace id 的 span 发到这里，请求的完整调用链一目了然') },
  { id: 'logs', col: 1, row: 1, label: () => tr('🪵 Хранилище логов', '🪵 Log store', '🪵 日志存储'), flow: 'toNode', tone: 'obs', note: () => tr('Логи всех сервисов в одном месте, с поиском по trace id', 'Logs from all services in one place, searchable by trace id', '所有服务的日志集中在一处，可按 trace id 检索') },
  { id: 'metrics', col: 2, row: 1, label: () => tr('📈 Метрики (Prometheus)', '📈 Metrics (Prometheus)', '📈 指标（Prometheus）'), flow: 'fromNode', tone: 'obs', note: () => tr('Сам опрашивает каждый сервис раз в несколько секунд и поднимает тревогу при отклонениях', 'Polls every service every few seconds and raises alerts on anomalies', '每隔几秒主动拉取每个服务的指标，异常时告警') },
  { id: 'auditLog', col: 3, row: 1, label: () => tr('🧾 Журнал аудита', '🧾 Audit log', '🧾 审计日志'), flow: 'toNode', tone: 'obs', note: () => tr('Сервисы пишут сюда, кто и что сделал с деньгами и данными; записи не меняются', 'Services record who did what with money and data; entries are never changed', '服务在此记录谁对资金和数据做了什么；记录不可修改') },
]
const SLOT_X = [575, 728, 881, 1034]
const SLOT_Y = [8, 54]
const NODE_W = 146
const NODE_H = 36

/** Узлы платформы над сервисами и их связи с каждым работающим сервисом */
export function PlatformNodes(c: Ctx) {
  const shown = NODES.filter((n) => on(c.state, n.id))
  if (!shown.length && !on(c.state, 'eventSourcing')) return null
  const targets = workloads(c)
  // у каждого узла свой вход на верхней кромке сервиса — линии не сходятся в одну точку
  const anchor = (r: Rect, isMono: boolean, slot: number): Pt =>
    isMono ? { x: r.x + r.w - 150 + slot * 18, y: r.y } : { x: r.x + 18 + slot * 20, y: r.y }
  return (
    <g className="pl-platform">
      {shown.map((n) => {
        const x = SLOT_X[n.col]
        const y = SLOT_Y[n.row]
        const from = { x: x + NODE_W / 2, y: y + NODE_H }
        return (
          <g key={n.id} className={'appear pl-node tone-' + n.tone}>
            {/* сервер авторизации — к клиентам: токен получают они */}
            {n.id === 'accessToken' ? (
              <path d={`M${x},${y + NODE_H / 2} C${x - 160},${y + NODE_H / 2} 260,${30} 190,${36}`} className="pl-line tone-auth flow-from" />
            ) : (
              targets.map((t) => {
                const to = anchor(t.r, t.id === 'monolith', n.row * 4 + n.col)
                const midY = (from.y + to.y) / 2
                return <path key={t.id} d={`M${from.x},${from.y} C${from.x},${midY} ${to.x},${midY} ${to.x},${to.y}`} className={'pl-line tone-' + n.tone + ' flow-' + n.flow} />
              })
            )}
            <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={8} />
            <text x={x + NODE_W / 2} y={y + 23} textAnchor="middle" className="pl-node-label">
              {n.label()}
            </text>
            <title>{n.note()}</title>
          </g>
        )
      })}
      {on(c.state, 'eventSourcing') && (
        <g className="appear pl-node tone-data">
          {targets.map((t) => {
            const from = { x: t.r.x + t.r.w / 2, y: t.r.y + t.r.h }
            const to = { x: 1055, y: c.H - 80 }
            return <path key={t.id} d={`M${from.x},${from.y} C${from.x},${(from.y + to.y) / 2} ${to.x},${(from.y + to.y) / 2} ${to.x},${to.y}`} className="pl-line tone-data flow-toNode" />
          })}
          <rect x={960} y={c.H - 80} width={190} height={30} rx={6} />
          <text x={1055} y={c.H - 60} textAnchor="middle" className="pl-node-label">
            📚 {tr('Хранилище событий', 'Event store', '事件存储')}
          </text>
          <title>{tr('Состояние не перезаписывается: сервис дописывает события, а текущее состояние собирает из них', 'State is never overwritten: the service appends events and rebuilds the current state from them', '状态从不覆盖：服务只追加事件，并从事件重建当前状态')}</title>
        </g>
      )}
    </g>
  )
}

// ---------------- вход: ограничитель и проверка токена ----------------

/** Rate limiter — шлагбаум на входе перед шлюзом; токен — проверка на входе */
export function EntryMarks(c: Ctx) {
  const els: ReactElement[] = []
  // линия от клиентов ко входу: клиенты — (120, 64), вход — шлюз или монолит
  const a = { x: 190, y: 50 }
  const b = c.entry
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  if (on(c.state, 'rateLimiter'))
    els.push(
      <g key="rl" className="appear pl-mark tone-guard" transform={`translate(${m.x - 34},${m.y - 13})`}>
        <rect width={68} height={22} rx={6} />
        <text x={34} y={15} textAnchor="middle">
          🚧 {tr('лимит', 'limit', '限流')}
        </text>
        <title>{tr('Rate limiter: лишние запросы сверх лимита сразу получают 429 и не доходят до сервисов', 'Rate limiter: requests over the limit get 429 right away and never reach the services', '限流器：超出限额的请求立即返回 429，不会到达服务')}</title>
      </g>,
    )
  if (has(c.state.infra, 'accessToken'))
    els.push(
      <g key="tok" className="appear pl-mark tone-auth" transform={`translate(${b.x - 12},${b.y - 30})`}>
        <circle cx={12} cy={12} r={11} />
        <text x={12} y={16} textAnchor="middle">
          🎫
        </text>
        <title>{tr('Вход проверяет токен клиента: без токена или с чужим — 401', 'The entry checks the client token: missing or forged token means 401', '入口校验客户端令牌：没有令牌或令牌伪造则返回 401')}</title>
      </g>,
    )
  return <g className="pl-entry">{els}</g>
}

// ---------------- детали на связях ----------------

/** Предохранитель, повтор, шифрование, ключ идемпотентности, дедупликация — там, где они работают на связи */
export function EdgeMarks({ state, edges }: { state: State; edges: EdgeGeom[] }) {
  const els: ReactElement[] = []
  const mark = (key: string, p: Pt, icon: string, tone: string, title: string) =>
    els.push(
      <g key={key} className={'appear pl-mark tone-' + tone} transform={`translate(${p.x},${p.y})`}>
        <circle r={9} />
        <text y={4} textAnchor="middle">
          {icon}
        </text>
        <title>{title}</title>
      </g>,
    )
  for (const e of edges) {
    const m = modeOf(state, e.d)
    const remote = (m === 'sync' || m === 'api') && (state.extracted[e.d.from] || state.extracted[e.d.to])
    if (remote) {
      if (has(state.infra, 'circuitBreakers') && !e.d.critical)
        mark(e.d.id + '-cb', at(e.geom, 0.2), '⚡', 'guard', tr('Предохранитель (circuit breaker): если сервис-получатель падает или тормозит, вызовы сразу обрываются, а не копятся', 'Circuit breaker: if the callee fails or slows down, calls are cut off right away instead of piling up', '熔断器：被调用方故障或变慢时，立即中断调用，而不是越积越多'))
      if (has(state.infra, 'mtls')) mark(e.d.id + '-tls', at(e.geom, 0.5), '🔒', 'auth', tr('mTLS: вызов зашифрован, и стороны проверяют сертификаты друг друга', 'mTLS: the call is encrypted and both sides check each other’s certificates', 'mTLS：调用被加密，双方互相校验证书'))
      if (has(state.infra, 'retry')) mark(e.d.id + '-retry', at(e.geom, 0.68), '↻', 'guard', tr('Повтор: сбойный вызов повторяется с паузой', 'Retry: a failed call is retried after a pause', '重试：失败的调用在间隔后重试'))
      if (has(state.infra, 'idempotencyKeys')) mark(e.d.id + '-key', at(e.geom, 0.84), '🔑', 'data', tr('Ключ идемпотентности: повтор того же запроса не спишет деньги дважды', 'Idempotency key: retrying the same request will not charge twice', '幂等键：重复同一请求不会重复扣款'))
    }
    if ((m === 'async' || m === 'saga' || m === 'replica') && has(state.infra, 'idempotentConsumer'))
      mark(e.d.id + '-dedup', at(e.geom, 0.84), '♻️', 'data', tr('Идемпотентный потребитель: повторно доставленное событие узнаётся по id и не обрабатывается второй раз', 'Idempotent consumer: a redelivered event is recognized by its id and not processed twice', '幂等消费者：重复投递的事件按 id 识别，不会被处理两次'))
  }
  return <g className="pl-edge-marks">{els}</g>
}

// ---------------- детали в сервисах ----------------

/** Отсеки (bulkhead), пробы здоровья, canary-версия, outbox — внутри или рядом с каждым сервисом */
export function ServiceMarks(c: Ctx) {
  const els: ReactElement[] = []
  for (const w of workloads(c)) {
    const r = w.r
    const isMono = w.id === 'monolith'
    if (isMono) {
      if (has(c.state.infra, 'mesh'))
        els.push(
          <g key="mono-sidecar" className="appear sidecar" transform={`translate(${r.x + r.w - 8},${r.y - 8})`}>
            <rect width={16} height={16} rx={4} />
            <title>{tr('Sidecar-прокси mesh и у монолита: его вызовы тоже идут через mesh', 'The monolith has a mesh sidecar proxy too: its calls also go through the mesh', '单体也有 mesh sidecar 代理：它的调用同样经过 mesh')}</title>
          </g>,
        )
      continue
    }
    const id = w.id as ModuleId
    if (on(c.state, 'bulkhead'))
      els.push(
        <g key={id + '-bh'} className="appear pl-bulkhead" transform={`translate(${r.x + 12},${r.y + r.h - 9})`}>
          {[0, 1, 2].map((i) => (
            <rect key={i} x={i * 22} width={18} height={5} rx={2} />
          ))}
          <title>{tr('Отсеки (bulkhead): у каждой внешней зависимости свой пул потоков — зависшая не займёт все', 'Bulkheads: each external dependency gets its own thread pool, so a hung one cannot take them all', '舱壁：每个外部依赖都有自己的线程池，卡住的那个占不满全部线程')}</title>
        </g>,
      )
    if (on(c.state, 'health'))
      els.push(
        <g key={id + '-hc'} className="appear pl-mark tone-ok" transform={`translate(${r.x + r.w - 40},${r.y + 2})`}>
          <text y={13}>❤</text>
          <title>{tr('Пробы /health: оркестратор не шлёт трафик в неготовый экземпляр и перезапускает зависший', 'Health probes: the orchestrator sends no traffic to an unready instance and restarts a hung one', '健康探针：编排器不把流量发给未就绪的实例，并重启卡死的实例')}</title>
        </g>,
      )
    if (on(c.state, 'canary'))
      els.push(
        <g key={id + '-canary'} className="appear pl-canary" transform={`translate(${r.x + r.w - 62},${r.y + r.h + 1})`}>
          <rect width={66} height={13} rx={4} />
          <text x={33} y={10} textAnchor="middle">
            🐤 v2 · 5%
          </text>
          <title>{tr('Canary: новая версия сначала получает 5% трафика; хуже метрики — автоматический откат', 'Canary: the new version first gets 5% of traffic; worse metrics mean an automatic rollback', '金丝雀：新版本先接收 5% 流量；指标变差就自动回滚')}</title>
        </g>,
      )
    if (on(c.state, 'kafka') && on(c.state, 'outbox') && c.state.ownDb[id]) {
      const tx = r.x + r.w + 14
      const ty = r.y + r.h - 2
      els.push(
        <g key={id + '-outbox'} className="appear pl-outbox">
          <path d={`M${tx + 26},${ty + 12} L${tx + 26},${c.H - 40}`} className="pl-line tone-data flow-toNode" />
          <rect x={tx} y={ty} width={52} height={12} rx={3} />
          <text x={tx + 26} y={ty + 9} textAnchor="middle">
            outbox
          </text>
          <title>{tr('Outbox: событие пишется в таблицу в той же транзакции, что и данные; ретранслятор переносит его в Kafka', 'Outbox: the event is written to a table in the same transaction as the data; a relay moves it to Kafka', 'Outbox：事件与数据在同一事务中写入表；中继再把它转发到 Kafka')}</title>
        </g>,
      )
    }
  }
  if (on(c.state, 'acl') && c.project.modules.some((m) => c.state.extracted[m.id]) && c.project.modules.some((m) => !c.state.extracted[m.id]))
    els.push(
      <g key="acl" className="appear pl-mark tone-infra" transform={`translate(${c.mono.x + c.mono.w - 26},${c.mono.y + 34})`}>
        <rect width={52} height={22} rx={6} />
        <text x={26} y={15} textAnchor="middle">
          🧱 ACL
        </text>
        <title>{tr('Слой защиты от искажений: переводит модель монолита в язык нового сервиса, чтобы старые понятия не протекли в него', 'Anti-corruption layer: translates the monolith’s model into the new service’s language so old concepts do not leak in', '防腐层：把单体的模型翻译成新服务的语言，防止旧概念渗入')}</title>
      </g>,
    )
  return <g className="pl-service-marks">{els}</g>
}
