import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { KafkaSim, type KafkaConfig } from './engine'

const STEP = 0.05
/** Как часто перерисовывать симуляцию: 4 раза в секунду — сообщения идут пачками, но страница не тормозит на телефоне */
const FRAME_MS = 250

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
    // модель идёт с той же скоростью, что и раньше (1 с модели в секунду на ×1); дробные шаги копятся
    let due = 0
    const timer = setInterval(() => {
      due += (FRAME_MS / 1000 / STEP) * speed
      for (; due >= 1; due--) sim.tick(STEP)
      onTickRef.current?.(sim)
      force()
    }, FRAME_MS)
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
