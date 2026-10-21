import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

// The info panel's two charts. One series each, so the title names it and there's no legend; the
// accent is the theme's, so they follow it.

export const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

export function duration(ms: number) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

const clock = (time: number | null) => (time ? ` · ${new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '')

/** A chart's frame: title and headline value, then the plot, drawn once its width is known. */
function Chart({ title, value, label, height, plot, tip }: {
  title: string
  value: ReactNode
  label: string
  height: number
  plot: (width: number) => ReactNode
  tip: (width: number) => ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(ref.current!)
    return () => observer.disconnect()
  }, [])
  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <span className="chart-title">{title}</span>
        <span className="chart-value">{value}</span>
      </figcaption>
      <div className="chart-plot" ref={ref} style={{ height }}>
        {width > 0 && (
          <>
            <svg width={width} height={height} role="img" aria-label={label}>{plot(width)}</svg>
            {tip(width)}
          </>
        )}
      </div>
    </figure>
  )
}

/** The value first, then where it is; kept inside the plot. */
function Tip({ x, width, value, detail }: { x: number; width: number; value: string; detail: string }) {
  const half = 64
  return (
    <div className="chart-tip" style={{ left: Math.min(Math.max(x - half, 0), Math.max(width - half * 2, 0)) }}>
      <strong>{value}</strong>
      <span>{detail}</span>
    </div>
  )
}

/** Tokens in context after each request, as a line over a faint wash; a compaction shows as a drop. */
export function ContextChart({ series }: { series: ClaudeInfo['series'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const height = 64
  const n = series.length
  const max = Math.max(...series.map(p => p.tokens), 1)
  const last = series[n - 1].tokens
  // The end dot is 4px with a 2px ring, so the line stops that far from the edges.
  const pad = 6
  const x = (i: number, width: number) => pad + (n === 1 ? 0 : (i / (n - 1)) * (width - pad * 2))
  const y = (v: number) => pad + (1 - v / max) * (height - pad - 1)
  const base = height - 0.5

  return (
    <Chart
      title="Context"
      value={<>{tokens(last)} <span className="chart-unit">now</span></>}
      label={`Context over ${n} requests: ${tokens(last)} tokens now, ${tokens(max)} at most.`}
      height={height}
      plot={width => {
        const points = series.map((p, i) => `${x(i, width).toFixed(1)},${y(p.tokens).toFixed(1)}`)
        const at = hover ?? n - 1
        return (
          <g
            onPointerMove={e => {
              const left = e.currentTarget.ownerSVGElement!.getBoundingClientRect().left
              const i = Math.round(((e.clientX - left - pad) / (width - pad * 2)) * (n - 1))
              setHover(Math.min(n - 1, Math.max(0, i)))
            }}
            onPointerLeave={() => setHover(null)}
          >
            <rect width={width} height={height} fill="transparent" />
            <line className="chart-rule" x1={0} x2={width} y1={base} y2={base} />
            <path className="chart-area" d={`M${points.join('L')}L${x(n - 1, width)},${base}L${x(0, width)},${base}Z`} />
            <polyline className="chart-line" points={points.join(' ')} />
            {hover !== null && <line className="chart-cross" x1={x(hover, width)} x2={x(hover, width)} y1={0} y2={base} />}
            <circle className="chart-dot" cx={x(at, width)} cy={y(series[at].tokens)} r={4} />
          </g>
        )
      }}
      tip={width => hover !== null && (
        <Tip x={x(hover, width)} width={width} value={`${tokens(series[hover].tokens)} tokens`} detail={`Request ${hover + 1}${clock(series[hover].time)}`} />
      )}
    />
  )
}

/** How long Claude worked on each prompt, the latest in full accent; the last 30 are shown. */
export function TurnsChart({ turns }: { turns: ClaudeInfo['turns'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = turns.slice(-30)
  const skipped = turns.length - shown.length
  const height = 44
  const gap = 2
  const max = Math.max(...shown.map(t => t.ms), 1)
  const longest = Math.max(...turns.map(t => t.ms))
  const total = turns.reduce((sum, t) => sum + t.ms, 0)
  const barWidth = (width: number) => Math.min(24, (width - gap * (shown.length - 1)) / shown.length)

  return (
    <Chart
      title="Turns"
      value={<>{duration(longest)} <span className="chart-unit">longest</span></>}
      label={`${turns.length} turns, ${duration(total)} in all, the longest ${duration(longest)}.`}
      height={height}
      plot={width => {
        const w = barWidth(width)
        return (
          <g onPointerLeave={() => setHover(null)}>
            <line className="chart-rule" x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} />
            {shown.map((turn, i) => {
              const h = Math.max(2, (turn.ms / max) * (height - 2))
              const left = i * (w + gap)
              const top = height - h
              // Rounded where the bar ends, square where it stands on the baseline.
              const r = Math.min(4, w / 2, h)
              const d = `M${left},${height}V${top + r}Q${left},${top} ${left + r},${top}H${left + w - r}Q${left + w},${top} ${left + w},${top + r}V${height}Z`
              return (
                <g key={i} onPointerEnter={() => setHover(i)}>
                  <rect x={left - gap / 2} y={0} width={w + gap} height={height} fill="transparent" />
                  <path className={`chart-bar ${i === shown.length - 1 ? 'latest' : ''} ${hover === i ? 'hover' : ''}`} d={d} />
                </g>
              )
            })}
          </g>
        )
      }}
      tip={width => {
        if (hover === null) return null
        const w = barWidth(width)
        return (
          <Tip x={hover * (w + gap) + w / 2} width={width} value={duration(shown[hover].ms)} detail={`Prompt ${skipped + hover + 1}${clock(shown[hover].time)}`} />
        )
      }}
    />
  )
}
