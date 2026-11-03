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

export const k8sLessons: Lesson[] = [
  {
    id: 'basics',
    title: tr('Как Kubernetes держит сервис живым', 'How Kubernetes keeps a service alive'),
    summary: tr('Поды, Deployment, Service, ресурсы, пробы, выкатка и отказы', 'Pods, Deployments, Services, resources, probes, rollouts and failures'),
    minutes: 10,
    Body: tr(Basics, BasicsEn),
  },
]
