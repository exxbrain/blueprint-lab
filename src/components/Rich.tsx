import { Fragment } from 'react'

/** Абзацы текста с **жирным** и `кодом` — для контента, который хранится как данные */
export function Rich({ paras }: { paras: string[] }) {
  return (
    <>
      {paras.map((p) => (
        <p key={p}>
          {p.split(/\*\*(.+?)\*\*/g).map((part, i) =>
            i % 2 ? (
              <b key={i}>{part}</b>
            ) : (
              <Fragment key={i}>
                {part.split(/`([^`]+)`/g).map((x, j) => (j % 2 ? <code key={j}>{x}</code> : <Fragment key={j}>{x}</Fragment>))}
              </Fragment>
            ),
          )}
        </p>
      ))}
    </>
  )
}
