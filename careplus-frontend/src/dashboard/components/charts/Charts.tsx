import * as React from "react"

const PALETTE = ["#0E5C56", "#B8842E", "#2A67A6", "#1A8754", "#C0392B", "#64748B"]

/* --------------------------------- Line --------------------------------- */

export function LineChartWidget({
  data,
  height = 200,
}: {
  data: { label: string; value: number }[]
  height?: number
}) {
  const width = 560
  const padding = { top: 16, right: 16, bottom: 28, left: 40 }
  const max = Math.max(...data.map((d) => d.value), 1)
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom
  const step = data.length > 1 ? innerW / (data.length - 1) : 0

  const points = data.map((d, i) => {
    const x = padding.left + i * step
    const y = padding.top + innerH - (d.value / max) * innerH
    return { x, y, ...d }
  })

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")
  const areaPath = `${linePath} L ${points[points.length - 1]?.x ?? 0} ${padding.top + innerH} L ${padding.left} ${padding.top + innerH} Z`

  const [hover, setHover] = React.useState<number | null>(null)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Line chart">
      {[0, 0.5, 1].map((t) => (
        <line
          key={t}
          x1={padding.left}
          x2={width - padding.right}
          y1={padding.top + innerH * t}
          y2={padding.top + innerH * t}
          stroke="var(--cp-border)"
          strokeDasharray="4 4"
        />
      ))}
      <path d={areaPath} fill="var(--cp-primary-light)" opacity={0.7} />
      <path d={linePath} fill="none" stroke="var(--cp-primary)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <circle cx={p.x} cy={p.y} r={hover === i ? 5 : 3.5} fill="var(--cp-primary)" stroke="white" strokeWidth={1.5} />
          <rect x={p.x - step / 2} y={padding.top} width={step || 20} height={innerH} fill="transparent" />
          <text x={p.x} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--cp-ink-soft)">{p.label}</text>
          {hover === i && (
            <g>
              <rect x={p.x - 26} y={p.y - 30} width={52} height={20} rx={5} fill="var(--cp-ink)" />
              <text x={p.x} y={p.y - 16} textAnchor="middle" fontSize="10" fill="white" fontWeight={600}>{p.value.toLocaleString()}</text>
            </g>
          )}
        </g>
      ))}
    </svg>
  )
}

/* --------------------------------- Bar --------------------------------- */

export function BarChartWidget({
  data,
  height = 200,
}: {
  data: { label: string; value: number }[]
  height?: number
}) {
  const width = 560
  const padding = { top: 24, right: 16, bottom: 48, left: 52 }
  const [hover, setHover] = React.useState<number | null>(null)
  if (data.length === 0) return <p className="flex h-[200px] items-center justify-center text-sm text-[var(--cp-ink-soft)]">No data available.</p>
  const max = Math.max(...data.map((d) => d.value), 1)
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom
  const gap = 10
  const barW = data.length > 0 ? innerW / data.length - gap : 0

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Bar chart">
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={padding.left} x2={width - padding.right} y1={padding.top + innerH * (1 - t)} y2={padding.top + innerH * (1 - t)} stroke="var(--cp-border)" strokeDasharray={t === 0 ? undefined : "4 4"} />
          <text x={padding.left - 8} y={padding.top + innerH * (1 - t) + 3} textAnchor="end" fontSize="10" fill="var(--cp-ink-soft)">{Math.round(max * t).toLocaleString()}</text>
        </g>
      ))}
      <line x1={padding.left} x2={width - padding.right} y1={padding.top + innerH} y2={padding.top + innerH} stroke="var(--cp-ink-soft)" />
      {data.map((d, i) => {
        const barH = (d.value / max) * innerH
        const x = padding.left + i * (barW + gap) + gap / 2
        const y = padding.top + innerH - barH
        const label = d.label.length > 16 ? `${d.label.slice(0, 15)}…` : d.label
        return (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={x} y={y} width={barW} height={barH} rx={5} fill={hover === i ? "var(--cp-accent)" : "var(--cp-primary)"} />
            <title>{`${d.label}: ${d.value.toLocaleString()}`}</title>
            <text x={x + barW / 2} y={height - 26} textAnchor="middle" fontSize="9" fill="var(--cp-ink-soft)">{label}</text>
            <text x={x + barW / 2} y={Math.max(padding.top + 10, y - 6)} textAnchor="middle" fontSize="10" fontWeight={700} fill="var(--cp-ink)">{d.value.toLocaleString()}</text>
            {hover === i && (
              <g>
                <rect x={x + barW / 2 - 42} y={Math.max(2, y - 48)} width={84} height={22} rx={5} fill="var(--cp-ink)" />
                <text x={x + barW / 2} y={Math.max(17, y - 33)} textAnchor="middle" fontSize="10" fill="white" fontWeight={600}>{d.value.toLocaleString()}</text>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/* -------------------------------- Donut -------------------------------- */

export function DonutChartWidget({
  data,
  size = 180,
}: {
  data: { label: string; value: number }[]
  size?: number
}) {
  const [hover, setHover] = React.useState<number | null>(null)
  if (data.length === 0) return <p className="flex h-[180px] items-center justify-center text-sm text-[var(--cp-ink-soft)]">No data available.</p>
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const radius = size / 2 - 14
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Donut chart">
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--cp-border)" strokeWidth={20} />
          {data.map((d, i) => {
            const frac = d.value / total
            const dash = frac * circumference
            const dashArray = `${dash} ${circumference - dash}`
            const el = (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={hover === i ? 24 : 20}
                strokeDasharray={dashArray}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className="transition-all duration-150"
              />
            )
            offset += dash
            return el
          })}
        </g>
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="18" fontWeight={700} fill="var(--cp-ink)">{total.toLocaleString()}</text>
        <text x={cx} y={cy + 16} textAnchor="middle" fontSize="9" fill="var(--cp-ink-soft)">Total</text>
      </svg>
      <ul className="flex flex-col gap-1.5">
        {data.map((d, i) => (
          <li key={i} className="flex items-center gap-2 text-xs text-[var(--cp-ink-soft)]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
            {d.label} <span className="cp-tabular font-semibold text-[var(--cp-ink)]">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
