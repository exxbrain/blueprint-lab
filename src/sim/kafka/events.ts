/**
 * Реалистичные данные событий: каждое сообщение симулятора — это событие жизненного цикла заказа
 * с полезной нагрузкой, как в настоящем топике. Данные детерминированы номером заказа,
 * поэтому OrderCreated, OrderPaid и OrderShipped одного заказа согласованы между собой.
 */
import { tr } from '../../i18n'
import type { Msg } from './engine'

export const EVENT_TYPES = ['OrderCreated', 'OrderPaid', 'OrderShipped'] as const

const PRODUCTS = tr(
  [
    ['SKU-1001', 'Кофе в зёрнах 1 кг', 1490],
    ['SKU-2044', 'Электрочайник', 2990],
    ['SKU-3107', 'Кружка керамическая', 590],
    ['SKU-4210', 'Наушники беспроводные', 7990],
    ['SKU-5333', 'Книга «Designing Data-Intensive Applications»', 3200],
    ['SKU-6012', 'Френч-пресс', 1890],
  ] as const,
  [
    ['SKU-1001', 'Coffee beans 1 kg', 1490],
    ['SKU-2044', 'Electric kettle', 2990],
    ['SKU-3107', 'Ceramic mug', 590],
    ['SKU-4210', 'Wireless headphones', 7990],
    ['SKU-5333', 'Book "Designing Data-Intensive Applications"', 3200],
    ['SKU-6012', 'French press', 1890],
  ] as const,
)
const COURIERS = ['CDEK', 'Boxberry', 'DPD', tr('Почта России', 'Russian Post')]
const METHODS = ['card', 'sbp', 'apple_pay']
const BASE_TIME = Date.UTC(2026, 10, 2, 12, 0, 0)

/** Детерминированный псевдослучайный генератор по номеру заказа */
function rand(seed: number) {
  let x = (seed * 2654435761) >>> 0
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return ((x >>> 0) % 1_000_000) / 1_000_000
  }
}

export function orderNo(orderId: number): string {
  return `ORD-${100000 + orderId}`
}

export function customerId(customer: string): string {
  return customer === 'big-corp' ? 'CUST-BIGCORP' : `CUST-${customer.replace('client-', '').padStart(5, '0')}`
}

function items(orderId: number) {
  const r = rand(orderId)
  const n = 1 + Math.floor(r() * 3)
  const out: { sku: string; name: string; qty: number; price: number }[] = []
  for (let i = 0; i < n; i++) {
    const [sku, name, price] = PRODUCTS[Math.floor(r() * PRODUCTS.length)]
    if (!out.some((x) => x.sku === sku)) out.push({ sku, name, qty: 1 + Math.floor(r() * 2), price })
  }
  return out
}

/** Полезная нагрузка события в том виде, в каком её отправил бы сервис заказов */
export function eventPayload(m: Msg): Record<string, unknown> {
  const order = orderNo(m.orderId)
  const at = new Date(BASE_TIME + m.producedAt * 1000).toISOString()
  const its = items(m.orderId)
  const total = its.reduce((s, x) => s + x.qty * x.price, 0)
  const r = rand(m.orderId * 7 + 3)
  const base = { eventId: `evt-${m.orderId.toString(36)}-${m.seq}-${m.id.toString(36)}`, type: EVENT_TYPES[m.seq], orderId: order }
  if (m.seq === 0)
    return { ...base, customerId: customerId(m.customer), items: its, total, currency: 'RUB', createdAt: at }
  if (m.seq === 1)
    return {
      ...base,
      paymentId: `PAY-${(m.orderId * 7919).toString(16).toUpperCase()}`,
      amount: total,
      currency: 'RUB',
      method: METHODS[Math.floor(r() * METHODS.length)],
      paidAt: at,
    }
  return {
    ...base,
    courier: COURIERS[Math.floor(r() * COURIERS.length)],
    trackingNo: `TRK${(m.orderId * 104729).toString().padStart(10, '0').slice(0, 10)}`,
    shippedAt: at,
  }
}

/** Заголовки записи Kafka */
export function eventHeaders(m: Msg): Record<string, string> {
  return {
    'event-type': EVENT_TYPES[m.seq],
    'content-type': 'application/json',
    'producer': `order-service-${m.producerId}`,
    'schema-version': '1',
  }
}
