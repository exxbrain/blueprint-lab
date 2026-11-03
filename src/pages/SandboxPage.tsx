import { tr } from '../i18n'
import { ALL_CONTROLS, KafkaSimulator } from '../sim/kafka/KafkaSimulator'
import { href } from '../router'

export function SandboxPage() {
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">{tr('Карта', 'Map', '地图')}</a> / <a href={href('kafka')}>Apache Kafka</a> / {tr('Песочница', 'Sandbox', '自由模式')}
      </div>
      <h1>🧰 {tr('Песочница Kafka', 'Kafka sandbox', 'Kafka 自由模式')}</h1>
      <p className="muted">
        {tr(
          'Все рычаги сразу. Наведите курсор на сообщение, реплику или метку группы, чтобы увидеть детали.',
          'All the levers at once. Hover over a message, replica or group label to see details.',
          '所有调节项一次全开。将鼠标悬停在消息、副本或消费者组标签上即可查看详情。',
        )}
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
