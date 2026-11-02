import { ALL_CONTROLS, KafkaSimulator } from '../sim/kafka/KafkaSimulator'
import { href } from '../router'

export function SandboxPage() {
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">Главная</a> / <a href={href('kafka')}>Apache Kafka</a> / Песочница
      </div>
      <h1>🧰 Песочница Kafka</h1>
      <p className="muted">
        Все рычаги сразу. Наведите курсор на сообщение, реплику или метку группы, чтобы увидеть детали.
      </p>
      <KafkaSimulator
        controls={ALL_CONTROLS}
        config={{
          brokers: 3,
          partitions: 4,
          replicationFactor: 3,
          minInsyncReplicas: 2,
          uncleanLeaderElection: false,
          producers: [{ rate: 25, keyStrategy: 'order', acks: 'all' }],
          groups: [
            { name: 'billing', consumers: 2, consumerRate: 15 },
            { name: 'analytics', consumers: 1, consumerRate: 30 },
          ],
        }}
      />
    </div>
  )
}
