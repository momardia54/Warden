import { useEffect, useId, useState } from "react"
import { Table2, ChartColumn } from "lucide-react"
import { compactNumber } from "#/lib/analytics"

export type ChartSeries<K extends string> = { key: K; label: string; /** A CSS colour, normally a chart token. */ color: string }
type Row<K extends string> = { date: string } & Record<K, number>

const AXIS_WIDTH = 36
const AXIS_HEIGHT = 20
/** Room above the plot for the top tick label. */
const PAD_TOP = 8
const MAX_BAR = 24
/** The surface gap between stacked segments and between neighbouring columns. */
const GAP = 2
const RADIUS = 4

/** "9 Oct", read in UTC like the days themselves, so server and browser agree. */
const shortDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
const longDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })

/** A clean maximum for the value axis whose halfway tick is a whole number: 4, 6, 10, 20, 40, 60, 100… */
function niceMax(value: number): number {
  if (value <= 4) return 4
  const power = 10 ** Math.floor(Math.log10(value))
  return [2, 4, 6, 10].map((m) => m * power).find((m) => m >= value)!
}

/** A column with only its data end rounded: square on the baseline. */
function columnPath(x: number, y: number, w: number, h: number, rounded: boolean) {
  const r = rounded ? Math.min(RADIUS, w / 2, h) : 0
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

/** The width of an element, measured in the browser: null until then (the server cannot know it). */
function useWidth() {
  const [node, setNode] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(120, Math.floor(entry.contentRect.width))))
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])
  return [setNode, width] as const
}

/**
 * Columns per day, stacked when there are several series. Hover or focus a day for its values; the table view
 * lists every value without hovering.
 */
export function ColumnChart<K extends string>({
  data,
  series,
  title,
  description,
  height = 180,
  summary,
}: {
  data: Row<K>[]
  series: ChartSeries<K>[]
  title: string
  description?: string
  height?: number
  /** A headline beside the title, typically the period total. */
  summary?: React.ReactNode
}) {
  const [box, measured] = useWidth()
  // Before the first measure the plot is laid out at a nominal width and kept invisible, so nothing jumps.
  const width = measured ?? 640
  const [active, setActive] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const id = useId()

  const totals = data.map((d) => series.reduce((n, s) => n + d[s.key], 0))
  const max = niceMax(Math.max(0, ...totals))
  const plotW = width - AXIS_WIDTH
  const plotH = height - AXIS_HEIGHT - PAD_TOP
  const band = plotW / Math.max(1, data.length)
  const barW = Math.max(1, Math.min(MAX_BAR, band - GAP))
  const y = (v: number) => PAD_TOP + plotH - (v / max) * plotH
  const ticks = [0, max / 2, max]
  // Three date labels: first, middle, last.
  const labelled = data.length <= 1 ? [0] : [0, Math.floor((data.length - 1) / 2), data.length - 1]
  const empty = totals.every((t) => t === 0)

  // The tooltip sits beside the hovered day, on its right, or on its left near the right edge, never over it.
  const TOOLTIP_WIDTH = 160
  const tooltipLeft = (i: number) => {
    const right = AXIS_WIDTH + band * (i + 1) + 4
    return right + TOOLTIP_WIDTH <= width ? right : Math.max(0, AXIS_WIDTH + band * i - TOOLTIP_WIDTH - 4)
  }

  const move = (delta: number) => setActive((i) => Math.min(data.length - 1, Math.max(0, (i ?? (delta > 0 ? -1 : data.length)) + delta)))

  return (
    <figure className="space-y-3">
      <figcaption className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{title}</h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <div className="flex items-center gap-3">
          {summary && <div className="text-sm text-muted-foreground">{summary}</div>}
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-pressed={asTable}
          >
            {asTable ? <ChartColumn className="size-3.5" /> : <Table2 className="size-3.5" />}
            {asTable ? "Chart" : "Table"}
          </button>
        </div>
      </figcaption>

      {series.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      {asTable ? (
        <div className="max-h-72 overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Day</th>
                {series.map((s) => (
                  <th key={s.key} className="px-3 py-1.5 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y tabular-nums">
              {[...data].reverse().map((d) => (
                <tr key={d.date}>
                  <td className="px-3 py-1.5">{longDate(d.date)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="px-3 py-1.5 text-right">
                      {d[s.key].toLocaleString("en-GB")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={box} className="relative overflow-hidden">
          <svg
            width={width}
            visibility={measured === null ? "hidden" : undefined}
            height={height}
            role="img"
            aria-labelledby={`${id}-desc`}
            tabIndex={0}
            className="block overflow-visible rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") move(1)
              else if (e.key === "ArrowLeft") move(-1)
              else if (e.key === "Escape") setActive(null)
              else return
              e.preventDefault()
            }}
            onBlur={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
          >
            <desc id={`${id}-desc`}>
              {title}, {data.length} days. Use the arrow keys to read each day, or switch to the table.
            </desc>
            <g className="text-[10px] text-muted-foreground" fill="currentColor">
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={AXIS_WIDTH} x2={width} y1={y(t) + 0.5} y2={y(t) + 0.5} className="stroke-border" strokeWidth={1} />
                  <text x={AXIS_WIDTH - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular-nums">
                    {compactNumber(t)}
                  </text>
                </g>
              ))}
              {labelled.map((i) => (
                <text key={i} x={AXIS_WIDTH + band * i + band / 2} y={height - 4} textAnchor={i === 0 && data.length > 1 ? "start" : i === data.length - 1 && data.length > 1 ? "end" : "middle"}>
                  {shortDate(data[i].date)}
                </text>
              ))}
            </g>
            {data.map((d, i) => {
              const x = AXIS_WIDTH + band * i + (band - barW) / 2
              let base = PAD_TOP + plotH
              const drawn = series.filter((s) => d[s.key] > 0)
              return (
                <g key={d.date} opacity={active === null || active === i ? 1 : 0.45}>
                  {drawn.map((s, at) => {
                    const h = (d[s.key] / max) * plotH
                    // Every segment but the top one leaves the surface gap above it.
                    const top = at === drawn.length - 1
                    const segH = Math.max(top ? 1 : 0, h - (top ? 0 : GAP))
                    base -= h
                    return <path key={s.key} d={columnPath(x, base + (h - segH), barW, segH, top)} fill={s.color} />
                  })}
                  {/* The hit area is the whole day, not only the painted column. */}
                  <rect x={AXIS_WIDTH + band * i} y={0} width={band} height={PAD_TOP + plotH} fill="transparent" onPointerEnter={() => setActive(i)} onPointerMove={() => setActive(i)} />
                </g>
              )
            })}
          </svg>
          {empty && <p className="pointer-events-none absolute inset-x-0 top-[40%] text-center text-sm text-muted-foreground" style={{ paddingLeft: AXIS_WIDTH }}>Nothing recorded in this period.</p>}
          {active !== null && data[active] && (
            <div
              className="pointer-events-none absolute top-0 z-10 w-40 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
              style={{ left: tooltipLeft(active) }}
              role="status"
            >
              <div className="mb-1 text-muted-foreground">{longDate(data[active].date)}</div>
              {series.map((s) => (
                <div key={s.key} className="flex items-center gap-2">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                  <span className="font-semibold tabular-nums">{data[active][s.key].toLocaleString("en-GB")}</span>
                  <span className="text-muted-foreground">{s.label.toLowerCase()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  )
}
