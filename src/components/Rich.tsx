import { Fragment } from 'react'

/** Абзацы текста с **жирным** — для контента, который хранится как данные */
export function Rich({ paras }: { paras: string[] }) {
  return (
    <>
      {paras.map((p) => (
        <p key={p}>
          {p.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : <Fragment key={i}>{part}</Fragment>))}
        </p>
      ))}
    </>
  )
}
