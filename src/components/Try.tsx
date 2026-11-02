import type { ReactNode } from 'react'

/** Блок «попробуй сам» внутри урока */
export function Try({ title, children, task }: { title: string; task?: ReactNode; children: ReactNode }) {
  return (
    <div className="try panel">
      <div className="try-title">🧪 {title}</div>
      {task && <div className="small" style={{ marginBottom: 10 }}>{task}</div>}
      {children}
    </div>
  )
}

export function Callout({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return <div className={'callout' + (danger ? ' danger' : '')}>{children}</div>
}
