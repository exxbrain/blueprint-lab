import type { Lesson } from '../types'
import { Callout } from '../../components/Try'
import { tr } from '../../i18n'

function Basics() {
  return (
    <div className="lesson">
      <p>
        Kubernetes — это контроллеры, которые без конца сравнивают <b>желаемое</b> состояние (манифест) с{' '}
        <b>фактическим</b> и исправляют разницу. Вы пишете «нужно 3 реплики», а кластер сам поднимает, переносит и
        перезапускает поды.
      </p>
      <h2>Главные объекты</h2>
      <table className="cmp">
        <thead>
          <tr>
            <th>Объект</th>
            <th>Что делает</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Pod</td>
            <td>Один или несколько контейнеров на одной ноде; смертен, его заменяют, а не чинят</td>
          </tr>
          <tr>
            <td>Deployment</td>
            <td>Держит нужное число подов и выкатывает новые версии (RollingUpdate или Recreate)</td>
          </tr>
          <tr>
            <td>Service</td>
            <td>Стабильный адрес и балансировка только по готовым подам (endpoints)</td>
          </tr>
          <tr>
            <td>HPA</td>
            <td>Меняет число реплик по загрузке CPU или другим метрикам</td>
          </tr>
          <tr>
            <td>PodDisruptionBudget</td>
            <td>Сколько подов можно выключить добровольно (drain, обновление кластера)</td>
          </tr>
        </tbody>
      </table>
      <h2>Ресурсы: requests и limits</h2>
      <p>
        <b>Request</b> — сколько планировщик резервирует на ноде и какую долю CPU под гарантированно получит при
        конкуренции. <b>Limit</b> — потолок. За лимит CPU под троттлится, за лимит памяти — убивается (
        <code>OOMKilled</code>). Под, который не помещается ни на одну ноду по requests, висит в <code>Pending</code>.
      </p>
      <h2>Пробы</h2>
      <ul>
        <li>
          <b>readiness</b> — готов ли под принимать трафик. Не прошёл — Service перестаёт слать ему запросы.
        </li>
        <li>
          <b>liveness</b> — жив ли процесс. Не прошёл — контейнер перезапускается.
        </li>
        <li>
          Проверяйте поведение приложения (HTTP <code>/ready</code>, <code>/health</code>), а не открытый порт: порт
          открыт и у прогревающегося, и у зависшего приложения.
        </li>
      </ul>
      <h2>Выкатка</h2>
      <p>
        RollingUpdate меняет поды постепенно. <code>maxSurge</code> — сколько лишних подов можно поднять заранее,{' '}
        <code>maxUnavailable</code> — сколько готовых можно потерять. Без запаса мощности — <code>1 / 0</code>: сначала
        поднять новый, потом убрать старый. Сломанный релиз в такой схеме просто застревает, а сервис живёт на старой
        версии.
      </p>
      <h2>Отказы</h2>
      <p>
        Нода может умереть, зона облака — пропасть, платформенная команда — вывести ноды на обслуживание. Реплики
        спасают, только если они разнесены: <code>podAntiAffinity</code> по нодам, <code>topologySpreadConstraints</code>{' '}
        по зонам, а PDB не даёт drain выключить слишком многое сразу.
      </p>
      <Callout>
        Kubernetes не делает приложение надёжным сам по себе. Он честно выполняет манифест: без readiness шлёт трафик в
        непрогретый под, без лимитов отдаёт ноду соседу, без anti-affinity ставит все реплики на одну машину.
      </Callout>
    </div>
  )
}

function BasicsEn() {
  return (
    <div className="lesson">
      <p>
        Kubernetes is a set of controllers that endlessly compare the <b>desired</b> state (the manifest) with the{' '}
        <b>actual</b> one and fix the difference. You write “I need 3 replicas”, and the cluster starts, moves and
        restarts pods on its own.
      </p>
      <h2>The main objects</h2>
      <table className="cmp">
        <thead>
          <tr>
            <th>Object</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Pod</td>
            <td>One or more containers on one node; it is mortal and gets replaced, not repaired</td>
          </tr>
          <tr>
            <td>Deployment</td>
            <td>Keeps the desired number of pods and rolls out new versions (RollingUpdate or Recreate)</td>
          </tr>
          <tr>
            <td>Service</td>
            <td>A stable address and load balancing across ready pods only (endpoints)</td>
          </tr>
          <tr>
            <td>HPA</td>
            <td>Changes the replica count based on CPU or other metrics</td>
          </tr>
          <tr>
            <td>PodDisruptionBudget</td>
            <td>How many pods may be shut down voluntarily (drain, cluster upgrades)</td>
          </tr>
        </tbody>
      </table>
      <h2>Resources: requests and limits</h2>
      <p>
        A <b>request</b> is what the scheduler reserves on a node and the CPU share the pod is guaranteed under
        contention. A <b>limit</b> is the ceiling. Above the CPU limit a pod is throttled; above the memory limit it is
        killed (<code>OOMKilled</code>). A pod whose requests fit on no node stays <code>Pending</code>.
      </p>
      <h2>Probes</h2>
      <ul>
        <li>
          <b>readiness</b>: is the pod ready to take traffic? If not, the Service stops sending it requests.
        </li>
        <li>
          <b>liveness</b>: is the process alive? If not, the container is restarted.
        </li>
        <li>
          Check the application’s behaviour (HTTP <code>/ready</code>, <code>/health</code>), not an open port: the port
          is open for a warming-up app and for a hung one alike.
        </li>
      </ul>
      <h2>Rollouts</h2>
      <p>
        RollingUpdate replaces pods gradually. <code>maxSurge</code> is how many extra pods may be started ahead of
        time; <code>maxUnavailable</code> is how many ready pods may be lost. With no spare capacity use{' '}
        <code>1 / 0</code>: start a new pod first, then remove an old one. A broken release then simply gets stuck,
        and the service keeps running the old version.
      </p>
      <h2>Failures</h2>
      <p>
        A node can die, a cloud zone can vanish, the platform team can drain nodes for maintenance. Replicas help only
        if they are spread: <code>podAntiAffinity</code> across nodes, <code>topologySpreadConstraints</code> across
        zones, and a PDB keeps a drain from shutting down too much at once.
      </p>
      <Callout>
        Kubernetes does not make an application reliable by itself. It faithfully executes the manifest: without
        readiness it sends traffic to a cold pod, without limits it hands the node to a neighbour, without
        anti-affinity it puts every replica on one machine.
      </Callout>
    </div>
  )
}

function BasicsZh() {
  return (
    <div className="lesson">
      <p>
        Kubernetes 是一组控制器，它们不停地把<b>期望</b>状态（清单 manifest）与
        <b>实际</b>状态进行比较，并修正两者的差异。你写下“我需要 3 个副本”，集群就会自己启动、迁移和重启 Pod。
      </p>
      <h2>主要对象</h2>
      <table className="cmp">
        <thead>
          <tr>
            <th>对象</th>
            <th>作用</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Pod</td>
            <td>运行在同一个 Node（节点）上的一个或多个容器；它是会“死”的，坏了就被替换，而不是被修复</td>
          </tr>
          <tr>
            <td>Deployment</td>
            <td>维持所需数量的 Pod，并发布新版本（RollingUpdate 或 Recreate）</td>
          </tr>
          <tr>
            <td>Service</td>
            <td>提供稳定的地址，只在已就绪的 Pod（endpoints）之间做负载均衡</td>
          </tr>
          <tr>
            <td>HPA</td>
            <td>根据 CPU 或其他指标调整副本数量</td>
          </tr>
          <tr>
            <td>PodDisruptionBudget</td>
            <td>允许主动关闭多少个 Pod（drain、集群升级）</td>
          </tr>
        </tbody>
      </table>
      <h2>资源：requests 与 limits</h2>
      <p>
        <b>request</b>
        是调度器在 Node 上为 Pod 预留的资源量，也是资源争抢时 Pod 保证能分到的 CPU 份额。
        <b>limit</b>
        是上限。超过 CPU limit 时 Pod 会被限流（throttle）；超过内存 limit 时会被杀掉（
        <code>OOMKilled</code>
        ）。如果按 requests 没有任何 Node 放得下某个 Pod，它就会停留在 <code>Pending</code> 状态。
      </p>
      <h2>探针</h2>
      <ul>
        <li>
          <b>readiness</b>（就绪探针）：Pod 是否准备好接收流量？如果没有，Service 就不再向它发送请求。
        </li>
        <li>
          <b>liveness</b>（存活探针）：进程是否还活着？如果不是，容器就会被重启。
        </li>
        <li>
          要检查应用的行为（HTTP <code>/ready</code>、<code>/health</code>），而不是端口是否打开：无论应用正在预热还是已经卡死，端口都是打开的。
        </li>
      </ul>
      <h2>发布</h2>
      <p>
        RollingUpdate 会逐步替换 Pod。<code>maxSurge</code> 表示可以提前多启动多少个 Pod，
        <code>maxUnavailable</code> 表示最多可以失去多少个就绪的 Pod。没有富余容量时用 <code>1 / 0</code>
        ：先启动一个新 Pod，再移除一个旧 Pod。这样一来，有问题的版本只会卡在发布过程中，服务则继续运行旧版本。
      </p>
      <h2>故障</h2>
      <p>
        Node 可能宕机，云上的可用区可能消失，平台团队也可能为了维护而 drain 节点。只有把副本分散开，副本才能帮上忙：用
        <code>podAntiAffinity</code> 分散到不同 Node，用 <code>topologySpreadConstraints</code> 分散到不同可用区，再用 PDB 防止
        drain 一次关闭太多 Pod。
      </p>
      <Callout>
        Kubernetes 本身并不会让应用变得可靠。它只是老老实实地执行清单：没有 readiness，它会把流量发给还没预热好的 Pod；没有
        limits，它会把整个 Node 让给邻居；没有 anti-affinity，它会把所有副本放到同一台机器上。
      </Callout>
    </div>
  )
}

export const k8sLessons: Lesson[] = [
  {
    id: 'basics',
    title: tr('Как Kubernetes держит сервис живым', 'How Kubernetes keeps a service alive', 'Kubernetes 如何让服务保持运行'),
    summary: tr('Поды, Deployment, Service, ресурсы, пробы, выкатка и отказы', 'Pods, Deployments, Services, resources, probes, rollouts and failures', 'Pod、Deployment、Service、资源、探针、发布与故障'),
    minutes: 10,
    Body: tr(Basics, BasicsEn, BasicsZh),
  },
]
