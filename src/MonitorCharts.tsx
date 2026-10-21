import { useLayoutEffect, useState } from 'react'
import { clock, formatValue, type ValueStyle } from './monitors'

// The charts a monitor's panels draw, in the info panel's style (Charts.tsx): series in the theme's
// colors, a monitor's thresholds as dashed lines in the color of their level.

export interface Series {
  name: string
  values: (number | null)[]
}

/** Along the bottom: times, spaced by when they were, or labels, evenly. */
export type Axis = { kind: 'time'; times: number[] } | { kind: 'label'; labels: string[] }

export interface Threshold {
  value: number
  level: 'warn' | 'alert'
  firing: boolean
}

/** A stretch of time a rule about the panel was firing. */
export interface Band {
  from: number
  to: number
  level: 'warn' | 'alert' | 'done'
}

/** A moment drawn as a line across the chart: one of the spec's marks. */
export interface Mark {
  t: number
  label: string
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The width of the element the returned ref lands on, followed when that element is replaced too. */
function useWidth() {
  const [element, ref] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!element) return
    // Measured before the first paint too, so a chart never shows a frame without its drawing.
    setWidth(Math.floor(element.clientWidth))
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return [ref, width] as const
}

// Spreading a long history into Math.min overflows the stack.
const lowest = (values: number[]) => values.reduce((a, b) => (b < a ? b : a), Infinity)
const highest = (values: number[]) => values.reduce((a, b) => (b > a ? b : a), -Infinity)
const isNumber = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

interface Point {
  t: number
  v: (number | null)[]
  lo: (number | null)[]
  hi: (number | null)[]
}

/**
 * Points to draw over time: thinned to `max` when there are more, each keeping its low and high, and
 * null where runs are missing (the app was closed, the command stopped), so a line doesn't bridge them.
 */
function prepare(times: number[], series: (number | null)[][], max: number): { points: (Point | null)[]; thinned: boolean } {
  const n = times.length
  if (!n) return { points: [], thinned: false }
  const diffs = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b)
  const usual = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0
  const gap = Math.max(usual * 3, usual + MINUTE)
  const thinned = n > Math.max(2, max)
  const groups: number[][] = []
  if (thinned) {
    const size = (times[n - 1] - times[0] || 1) / max
    let bucket = -1
    times.forEach((t, i) => {
      const b = Math.min(max - 1, Math.floor((t - times[0]) / size))
      if (b !== bucket) groups.push([]), (bucket = b)
      groups[groups.length - 1].push(i)
    })
  } else times.forEach((_, i) => groups.push([i]))
  const points: (Point | null)[] = []
  let last: number | null = null
  for (const group of groups) {
    if (last !== null && times[group[0]] - last > gap) points.push(null)
    last = times[group[group.length - 1]]
    const stats = series.map(values => {
      const vs = group.map(i => values[i]).filter(isNumber)
      return vs.length ? { v: vs.reduce((a, b) => a + b, 0) / vs.length, lo: lowest(vs), hi: highest(vs) } : null
    })
    points.push({
      t: group.reduce((sum, i) => sum + times[i], 0) / group.length,
      v: stats.map(s => s?.v ?? null),
      lo: stats.map(s => s?.lo ?? null),
      hi: stats.map(s => s?.hi ?? null),
    })
  }
  return { points, thinned }
}

/** A round step that splits `span` into about `intervals`: 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(span: number, intervals: number) {
  const raw = span / intervals
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const f = raw / magnitude
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * magnitude
}

/** The y range around the data (from zero for bars and areas, stretched to thresholds near it) and round ticks inside it. */
function scale(values: number[], kind: 'line' | 'area' | 'bar', thresholds: Threshold[]) {
  let lo = lowest(values)
  let hi = highest(values)
  if (kind !== 'line') (lo = Math.min(0, lo)), (hi = Math.max(0, hi))
  const span = hi - lo || Math.abs(hi) || 1
  for (const t of thresholds) if (t.value >= lo - span * 0.5 && t.value <= hi + span * 0.5) (lo = Math.min(lo, t.value)), (hi = Math.max(hi, t.value))
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.08
  if (kind === 'line') lo = lowest(values) >= 0 && lo >= 0 ? Math.max(0, lo - pad) : lo - pad
  hi += pad
  if (hi === lo) hi = lo + 1
  const step = niceStep(hi - lo, 3)
  const ticks: number[] = []
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) ticks.push(Math.round(v / step) * step || 0)
  return { lo, hi, ticks, step }
}

/** Digits after the point a round step needs: 2.5 needs one more than its power of ten. */
function digitsOf(step: number) {
  const power = Math.floor(Math.log10(step) + 1e-9)
  const half = Math.abs(step / 10 ** power - 2.5) < 1e-6 ? 1 : 0
  return Math.min(4, Math.max(0, half - power))
}

/** How the y ticks read: as many digits as the step needs, compact for big numbers. */
function tickStyle(style: ValueStyle, hi: number, step: number): ValueStyle {
  const format = style.format ?? 'number'
  if (format === 'number' && Math.abs(hi) >= 10_000) return { ...style, format: 'compact' }
  if (format === 'number') return { ...style, decimals: digitsOf(step) }
  if (format === 'percent') return { ...style, decimals: digitsOf(step * 100) }
  return style
}

const TIME_STEPS = [MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY]

const midnight = (t: number) => {
  const d = new Date(t)
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0
}

/** Times along the bottom at round local times, about `count` of them. */
function timeTicks(t0: number, t1: number, count: number) {
  // Past the listed steps, whole weeks, as many as keep to the count.
  const step = TIME_STEPS.find(s => (t1 - t0) / s <= Math.max(1, count)) ?? Math.ceil((t1 - t0) / Math.max(1, count) / (7 * DAY)) * 7 * DAY
  const ticks: number[] = []
  // Stepped in local time, day by day, so a change to or from summer time keeps them on the hour.
  for (const day = new Date(t0); ; day.setDate(day.getDate() + Math.max(1, step / DAY))) {
    day.setHours(0, 0, 0, 0)
    if (+day > t1) break
    if (step >= DAY) {
      if (+day >= t0) ticks.push(+day)
      continue
    }
    for (let minutes = 0; minutes < 24 * 60; minutes += step / MINUTE) {
      const t = +new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes)
      if (t >= t0 && t <= t1) ticks.push(t)
    }
  }
  return ticks
}

/** A time as a tick says it: the day at midnight, the clock otherwise. */
const tickLabel = (t: number) => (midnight(t) ? new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric' }) : clock(t))

/** A time as the tooltip says it: with its day when that isn't today. */
const tipTime = (t: number) => (new Date(t).toDateString() === new Date().toDateString()
  ? clock(t, true)
  : midnight(t) ? new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
  : `${new Date(t).toLocaleDateString([], { weekday: 'short' })} ${clock(t)}`)

export function SeriesChart({ kind, series, axis, style, thresholds, bands = [], marks = [], height = 150 }: {
  kind: 'line' | 'area' | 'bar'
  series: Series[]
  axis: Axis
  style: ValueStyle
  thresholds: Threshold[]
  bands?: Band[]
  marks?: Mark[]
  height?: number
}) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const gutter = 52
  const plotW = Math.max(10, width - gutter)
  const n = axis.kind === 'time' ? axis.times.length : axis.labels.length
  const times = axis.kind === 'time' ? axis.times : null
  // Lines over time are spaced by when; bars and labels sit in even slots.
  const timed = !!times && kind !== 'bar' && n > 1 && times[n - 1] > times[0]
  const { points, thinned } = timed
    ? prepare(times!, series.map(s => s.values), Math.max(2, Math.floor(plotW / 3)))
    : { points: [] as (Point | null)[], thinned: false }
  const values = timed
    ? points.flatMap(p => (p ? [...p.lo, ...p.hi] : [])).filter(isNumber)
    : series.flatMap(s => s.values).filter(isNumber)
  if (!n || !values.length) return <div className="monitor-chart" ref={ref} style={{ height }}><div className="monitor-empty">No numbers to draw yet.</div></div>

  const { lo, hi, ticks, step } = scale(values, kind, thresholds)
  const shownMarks = times ? marks : []
  const top = shownMarks.length ? 16 : 6
  const bottom = 18
  const plotH = height - bottom - top
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * plotH
  const t0 = timed ? times![0] : 0
  const t1 = timed ? times![n - 1] : 0
  const slot = plotW / n
  const xAt = (i: number) => gutter + (kind === 'bar' ? slot * (i + 0.5) : n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const xOf = (t: number) => gutter + ((t - t0) / (t1 - t0)) * plotW
  // A time on an axis of even slots falls between the slots of the times around it.
  const xFor = (t: number): number | null => {
    if (timed) return t < t0 || t > t1 ? null : xOf(t)
    if (!times || !n) return null
    if (t < times[0] || t > times[n - 1]) return null
    let i = 0
    while (i < n - 2 && times[i + 1] <= t) i++
    const span = times[i + 1] - times[i]
    return span > 0 ? xAt(i) + ((t - times[i]) / span) * (xAt(i + 1) - xAt(i)) : xAt(i)
  }
  const yStyle = tickStyle(style, hi, step)
  const baseline = y(Math.max(lo, Math.min(0, hi)))
  const drawn = timed ? points.map((p, i) => (p ? i : -1)).filter(i => i >= 0) : []

  const nearest = (clientX: number, left: number) => {
    const px = clientX - left
    if (timed) {
      let best = drawn[0]
      for (const i of drawn) if (Math.abs(xOf(points[i]!.t) - px) < Math.abs(xOf(points[best]!.t) - px)) best = i
      return best
    }
    return Math.max(0, Math.min(n - 1, kind === 'bar' ? Math.floor((px - gutter) / slot) : Math.round(((px - gutter) / plotW) * (n - 1))))
  }

  const paths = series.map((s, si) => {
    if (kind === 'bar') {
      const groupW = Math.min(slot * 0.78, 48)
      const w = Math.max(1, groupW / series.length - (series.length > 1 ? 1 : 0))
      return (
        <g key={si} className={`series series-${si}`}>
          {s.values.map((v, i) => {
            // A zero is no bar, not a sliver along the bottom.
            if (v === null || v === 0) return null
            const left = xAt(i) - groupW / 2 + si * (groupW / series.length)
            const top0 = Math.min(y(v), baseline)
            const h = Math.max(1, Math.abs(baseline - y(v)))
            return <rect key={i} className={`monitor-bar ${hover === i ? 'hover' : ''}`} x={left} y={top0} width={w} height={h} rx={Math.min(3, w / 2)} />
          })}
        </g>
      )
    }
    // Runs of points with a value; a gap breaks the line rather than bridging it.
    const runs: { x: number; v: number; lo: number; hi: number }[][] = []
    let current: { x: number; v: number; lo: number; hi: number }[] = []
    const push = (x: number, v: number | null, l: number | null, h: number | null) => {
      if (v === null) {
        if (current.length) runs.push(current)
        current = []
      } else current.push({ x, v, lo: l ?? v, hi: h ?? v })
    }
    if (timed) points.forEach(p => (p ? push(xOf(p.t), p.v[si], p.lo[si], p.hi[si]) : push(0, null, null, null)))
    else s.values.forEach((v, i) => push(xAt(i), v, v, v))
    if (current.length) runs.push(current)
    const line = (run: typeof current, key: 'v' | 'lo' | 'hi') => run.map(p => `${p.x.toFixed(1)},${y(p[key]).toFixed(1)}`)
    return (
      <g key={si} className={`series series-${si}`}>
        {/* Thinned, each point is many runs: their range is a band around the average. */}
        {thinned && kind === 'line' && runs.filter(r => r.length > 1).map((run, ri) => (
          <path key={`b${ri}`} className="monitor-range" d={`M${line(run, 'hi').join('L')}L${line([...run].reverse(), 'lo').join('L')}Z`} />
        ))}
        {kind === 'area' && runs.filter(r => r.length > 1).map((run, ri) => {
          const pts = line(run, 'v')
          return <path key={`a${ri}`} className="monitor-area" d={`M${pts.join('L')}L${run[run.length - 1].x.toFixed(1)},${baseline}L${run[0].x.toFixed(1)},${baseline}Z`} />
        })}
        {runs.map((run, ri) => (run.length === 1
          ? <circle key={ri} className="monitor-point" cx={run[0].x} cy={y(run[0].v)} r={2.5} />
          : <polyline key={ri} className="monitor-line" points={line(run, 'v').join(' ')} />))}
      </g>
    )
  })

  // Along the bottom: round times when spaced by time, otherwise as many slots' labels as fit.
  const fit = Math.max(2, Math.floor(plotW / 80))
  const xTicks: { x: number; label: string; day: boolean }[] = timed
    ? timeTicks(t0, t1, fit).map(t => ({ x: xOf(t), label: tickLabel(t), day: midnight(t) }))
    : (() => {
      const every = Math.max(1, Math.ceil(n / fit))
      const indices = Array.from({ length: n }, (_, i) => i).filter(i => i % every === 0)
      return indices.map(i => ({ x: xAt(i), label: times ? tickLabel(times[i]) : String((axis as { labels: string[] }).labels[i]).slice(0, 14), day: false }))
    })()

  const fireBands = bands
    .map(b => {
      const left = xFor(Math.max(b.from, timed ? t0 : times?.[0] ?? b.from))
      const right = xFor(Math.min(b.to, timed ? t1 : times?.[n - 1] ?? b.to))
      return left === null || right === null || b.to < (timed ? t0 : times?.[0] ?? 0) ? null : { ...b, left, right: Math.max(right, left + 2) }
    })
    .filter(Boolean) as (Band & { left: number; right: number })[]

  // A run that lands while hovering can leave the index past the points.
  const shown = hover !== null && (timed ? points[hover] : hover < n) ? hover : null
  const tipX = shown === null ? 0 : timed ? xOf(points[shown]!.t) : xAt(shown)
  return (
    <div className="monitor-chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          onPointerMove={e => setHover(nearest(e.clientX, e.currentTarget.getBoundingClientRect().left))}
          onPointerLeave={() => setHover(null)}
        >
          {fireBands.map((b, i) => (
            <rect key={`f${i}`} className={`monitor-fired ${b.level}`} x={b.left} y={top} width={b.right - b.left} height={plotH} />
          ))}
          {ticks.map(v => (
            <g key={v}>
              <line className="monitor-grid-line" x1={gutter} x2={width} y1={y(v)} y2={y(v)} />
              <text className="monitor-tick" x={gutter - 8} y={y(v)} dy="0.32em" textAnchor="end">{formatValue(v, yStyle)}</text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <g key={i}>
              {t.day && <line className="monitor-day-line" x1={t.x} x2={t.x} y1={top} y2={top + plotH} />}
              <text className={`monitor-tick ${t.day ? 'day' : ''}`} x={Math.min(Math.max(t.x, gutter + 18), width - 18)} y={height - 4} textAnchor="middle">{t.label}</text>
            </g>
          ))}
          {thresholds.filter(t => t.value >= lo && t.value <= hi).map((t, i) => (
            <line key={`t${i}`} className={`monitor-threshold ${t.level} ${t.firing ? 'firing' : ''}`} x1={gutter} x2={width} y1={y(t.value)} y2={y(t.value)} />
          ))}
          {shownMarks.map((m, i) => {
            const x = xFor(m.t)
            if (x === null) return null
            const flip = x > width - 90
            return (
              <g key={`m${i}`} className="monitor-mark">
                <line x1={x} x2={x} y1={top - 4} y2={top + plotH} />
                <text x={flip ? x - 4 : x + 4} y={top - 6} textAnchor={flip ? 'end' : 'start'}>{m.label}</text>
              </g>
            )
          })}
          {paths}
          {shown !== null && kind !== 'bar' && <line className="chart-cross" x1={tipX} x2={tipX} y1={top} y2={top + plotH} />}
          {shown !== null && kind !== 'bar' && series.map((s, si) => {
            const v = timed ? points[shown]!.v[si] : s.values[shown]
            return v !== null && <circle key={si} className={`monitor-dot series-${si}`} cx={tipX} cy={y(v)} r={3.5} />
          })}
        </svg>
      )}
      {shown !== null && width > 0 && (
        <div className="chart-tip monitor-tip" style={{ left: Math.min(Math.max(tipX - 80, 0), Math.max(width - 160, 0)) }}>
          <span>{timed ? `${thinned ? '~' : ''}${tipTime(points[shown]!.t)}` : times ? tipTime(times[shown]) : (axis as { labels: string[] }).labels[shown]}</span>
          {series.map((s, si) => {
            const p = timed ? points[shown]! : null
            const v = p ? p.v[si] : s.values[shown]
            const spread = p && thinned && p.lo[si] !== null && p.hi[si] !== p.lo[si]
            return (
              <strong key={si} className="monitor-tip-row">
                {series.length > 1 && <i className={`legend-swatch series-${si}`} />}
                {series.length > 1 && <em>{s.name}</em>}
                {formatValue(v, style)}
                {spread && <small>{formatValue(p.lo[si], style)}–{formatValue(p.hi[si], style)}</small>}
              </strong>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** A stat's history: a line with no axes, its last point marked; thinned and broken at gaps as the charts are. */
export function Sparkline({ values, times, height = 34 }: { values: (number | null)[]; times: number[]; height?: number }) {
  const [ref, width] = useWidth()
  const pad = 3
  const { points, thinned } = prepare(times, [values], Math.max(2, Math.floor(width / 2.5)))
  const numbers = points.flatMap(p => (p ? [p.lo[0], p.hi[0]] : [])).filter(isNumber)
  const lo = lowest(numbers)
  const hi = highest(numbers)
  const t0 = times[0]
  const t1 = times[times.length - 1]
  const x = (t: number) => (t1 === t0 ? width / 2 : pad + ((t - t0) / (t1 - t0)) * (width - pad * 2))
  const y = (v: number) => pad + (hi === lo ? 0.5 : 1 - (v - lo) / (hi - lo)) * (height - pad * 2)
  const runs: Point[][] = [[]]
  for (const p of points) {
    if (!p || p.v[0] === null) runs.push([])
    else runs[runs.length - 1].push(p)
  }
  const drawn = runs.filter(r => r.length)
  const last = drawn.at(-1)?.at(-1)
  const coords = (run: Point[], key: 'v' | 'lo' | 'hi') => run.map(p => `${x(p.t).toFixed(1)},${y(p[key][0]!).toFixed(1)}`)
  return (
    <div className="monitor-spark" ref={ref} style={{ height }}>
      {width > 0 && numbers.length > 1 && (
        <svg width={width} height={height}>
          {thinned && drawn.filter(r => r.length > 1).map((run, i) => (
            <path key={`b${i}`} className="monitor-range" d={`M${coords(run, 'hi').join('L')}L${coords([...run].reverse(), 'lo').join('L')}Z`} />
          ))}
          {drawn.map((run, i) => (run.length === 1
            ? <circle key={i} className="monitor-point" cx={x(run[0].t)} cy={y(run[0].v[0]!)} r={1.5} />
            : <polyline key={i} className="monitor-line" points={coords(run, 'v').join(' ')} />))}
          {last && <circle className="chart-dot" cx={x(last.t)} cy={y(last.v[0]!)} r={3} />}
        </svg>
      )}
    </div>
  )
}
