export function Sparkline({ values, width = 90, height = 22 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} />
  const max = Math.max(1, ...values)
  const step = width / (values.length - 1)
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 2) - 1).toFixed(1)}`)
  return (
    <svg width={width} height={height} className="sparkline">
      <polyline points={pts.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
