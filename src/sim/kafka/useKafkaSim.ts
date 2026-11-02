import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { KafkaSim, type KafkaConfig } from './engine'

const STEP = 0.05

export function useKafkaSim(config: KafkaConfig, onTick?: (sim: KafkaSim) => void) {
  // Сам объект симуляции мутабельный; React перерисовывается по счётчику
  const [sim, setSim] = useState(() => new KafkaSim(config))
  const [, force] = useReducer((x: number) => x + 1, 0)
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState(1)
  const configRef = useRef(config)
  const onTickRef = useRef(onTick)
  useLayoutEffect(() => {
    configRef.current = config
    onTickRef.current = onTick
  })

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      const steps = Math.round(2 * speed)
      for (let i = 0; i < steps; i++) sim.tick(STEP)
      onTickRef.current?.(sim)
      force()
    }, 100)
    return () => clearInterval(timer)
  }, [running, speed, sim])

  const reset = useCallback(() => setSim(new KafkaSim(configRef.current)), [])

  /** Выполнить действие над симуляцией и сразу перерисовать */
  const act = useCallback(
    (fn: (s: KafkaSim) => void) => {
      fn(sim)
      force()
    },
    [sim],
  )

  return { sim, running, setRunning, speed, setSpeed, reset, act }
}
