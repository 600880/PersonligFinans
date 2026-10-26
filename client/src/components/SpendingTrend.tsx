import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  CartesianGrid,
  getRelativeCoordinate,
  Line,
  LineChart,
  Tooltip,
  useYAxisInverseScale,
  XAxis,
  YAxis,
  type InverseScaleFunction,
  type MouseHandlerDataParam,
} from 'recharts'
import { fetchMonthlySpending, type Category, type MonthSpending, type TransactionMonth } from '../lib/api'
import { formatAmount } from '../lib/amount'
import { useIsDark } from '../lib/appearance'
import { categoryColour } from '../lib/categoryColours'
import { categoryName } from '../lib/categoryName'
import type { Granularity } from '../lib/period'
import {
  defaultSpan,
  monthLabel,
  monthValue,
  offeredMonths,
  reloadedSpan,
  withFrom,
  withGranularity,
  withTo,
  type Span,
} from '../lib/span'
import {
  categoryRow,
  coverageNote,
  formatChange,
  TOTAL_ROW,
  trendCategories,
  trendPoints,
  type TrendPoint,
} from '../lib/trend'
import { GranularitySelect } from './GranularitySelect'
import { ErrorMessage } from './Messages'
import type { TransactionsTarget } from './TransactionsPage'

const LOAD_ERROR = 'Could not load the Spending trend.'

// Why there is no trend when the months with Transactions all fall in one Period of the granularity.
const TOO_FEW_PERIODS: Record<Granularity, string> = {
  month: 'Trends need at least two months with Transactions',
  quarter: 'Trends by Quarter need Transactions in at least two quarters',
  year: 'Trends by Year need Transactions in at least two years',
}

const CHART_HEIGHT = 280

// The chart's own colours, switched with the theme. The Total line is slate outside the Category
// palette, dark in Light and pale in Dark, so it stands apart from every Category. Light keeps
// recharts' own greys for the axes, their label and the line following the pointer, and its white
// ring round the dot under the pointer, which Dark gives the page's colour.
const CHART_COLOURS = {
  light: {
    total: '#1e293b',
    grid: '#e2e8f0',
    axis: '#666666',
    label: '#808080',
    cursor: '#cccccc',
    ring: '#ffffff',
  },
  dark: {
    total: '#e2e8f0',
    grid: '#1e293b',
    axis: '#94a3b8',
    label: '#94a3b8',
    cursor: '#475569',
    ring: '#020617',
  },
}

const wholeKroner = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 })

// A Span's monthly Spending, remembered with the Span it was loaded for; null when loading failed.
interface LoadedTrend {
  span: Span
  monthly: MonthSpending[] | null
}

// One row of the table, and the line it switches on. Its dots open the Transactions of its Category,
// of Uncategorized when categoryId is null, or of all Categories for Total.
interface TrendRow {
  key: string
  categoryId: number | null | 'all'
  name: string
  colour: string
}

// Hands the y axis's conversion from pixels to NOK to `onScale`, since only the chart's own
// children can reach it.
function YAxisInverseScale({ onScale }: { onScale: (scale: InverseScaleFunction | undefined) => void }) {
  const scale = useYAxisInverseScale()
  useEffect(() => onScale(scale))
  return null
}

// The Total row, then one per Category with Spending in some point of the trend at the granularity,
// largest first, then Savings and Income when they have a figure in some point. The Categories wait
// for their names, so a Category is never shown without its name.
function trendRows(
  monthly: MonthSpending[],
  granularity: Granularity,
  categories: Category[] | null,
  dark: boolean,
): TrendRow[] {
  const total = {
    key: TOTAL_ROW,
    categoryId: 'all' as const,
    name: 'Total',
    colour: CHART_COLOURS[dark ? 'dark' : 'light'].total,
  }
  if (!categories) return [total]
  return [
    total,
    ...trendCategories(monthly, granularity).map((categoryId) => ({
      key: categoryRow(categoryId),
      categoryId,
      name: categoryName(categoryId, categories),
      colour: categoryColour(categoryId, categories, dark),
    })),
  ]
}

// How Spending, Savings and Income changed over a Span, as lines with a point per Period of its own
// Granularity, Month at first, and a table of the first and last points for Total and each Category,
// Savings and Income after the Spending ones and never in Total. Each row switches its line on and
// off; Total starts on and the Categories off, and they stay as switched when the Span changes. `months` are the months with Transactions, newest first, which decide the months
// offered. Opens on the 12 months ending at the latest of them. When they are reloaded, after
// Transactions are saved or on coming back to home, it fetches its Spending again, keeping the Span
// if both its ends are still offered and otherwise going back to the 12 months; its Granularity and
// switched-on lines are kept. Clicking the chart opens the Transactions of the line nearest the
// click, in the Period of the point clicked.
export function SpendingTrend({
  months,
  categories,
  onOpenTransactions,
}: {
  months: TransactionMonth[]
  categories: Category[] | null
  onOpenTransactions: (target: TransactionsTarget) => void
}) {
  const headingId = useId()
  const dark = useIsDark()
  const colours = CHART_COLOURS[dark ? 'dark' : 'light']
  const offered = useMemo(() => offeredMonths(months), [months])
  const [granularity, setGranularity] = useState<Granularity>('month')
  // The Span shown, remembered with the months it was worked out from. When the months are reloaded
  // it is kept, or falls back to the default, before anything is drawn or fetched for the old one.
  const [shown, setShown] = useState<{ months: TransactionMonth[]; span: Span | null }>(() => ({
    months,
    span: defaultSpan(offered, 'month'),
  }))
  if (shown.months !== months) setShown({ months, span: reloadedSpan(shown.span, offered, granularity) })
  const span = shown.span
  const [loaded, setLoaded] = useState<LoadedTrend | null>(null)
  // The rows whose lines are drawn, by key. Kept for rows missing from the current Span, so they are
  // drawn again when a later Span includes them.
  const [switchedOn, setSwitchedOn] = useState<ReadonlySet<string>>(() => new Set([TOTAL_ROW]))

  useEffect(() => {
    if (!span) return
    let ignore = false
    fetchMonthlySpending(span)
      .then((monthly) => {
        if (!ignore) setLoaded({ span, monthly })
      })
      .catch(() => {
        if (!ignore) setLoaded({ span, monthly: null })
      })
    return () => {
      ignore = true
    }
  }, [span])

  const current = loaded && loaded.span === span ? loaded : null
  const points = current?.monthly ? trendPoints(current.monthly, granularity) : []
  const first = points[0]
  const last = points[points.length - 1]
  const rows = current?.monthly ? trendRows(current.monthly, granularity, categories, dark) : []
  const drawn = rows.filter((row) => switchedOn.has(row.key))
  const yValueAt = useRef<InverseScaleFunction | undefined>(undefined)

  // Opens the Transactions of the drawn line nearest the click, in the Period of the point clicked;
  // Total wins a tie, being drawn on top. A quarter only looks for them in its months inside the
  // Span.
  function openNearestLine(
    { activeTooltipIndex }: MouseHandlerDataParam,
    event: MouseEvent<SVGGraphicsElement>,
  ) {
    const point = activeTooltipIndex == null ? undefined : points[Number(activeTooltipIndex)]
    if (!point || drawn.length === 0) return
    const clicked = Number(yValueAt.current?.(getRelativeCoordinate(event).relativeY))
    const distance = (row: TrendRow) => Math.abs(point.values[row.key] - clicked)
    const nearest = drawn.reduce((best, row) => (distance(row) < distance(best) ? row : best))
    onOpenTransactions({
      period: point.period,
      categoryId: nearest.categoryId,
      allowedMonths: current?.monthly ?? [],
    })
  }

  function switchRow(key: string, on: boolean) {
    setSwitchedOn((keys) => {
      const next = new Set(keys)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  function chooseMonth(end: 'from' | 'to', value: string) {
    if (!span) return
    const month = offered.find((option) => monthValue(option) === value)!
    setShown({
      months,
      span: end === 'from' ? withFrom(span, month, offered, granularity) : withTo(span, month, offered, granularity),
    })
  }

  // Keeps the Span when it touches two Periods of the new granularity, and otherwise corrects it, or
  // goes back to the default when there was none at the old one.
  function chooseGranularity(next: Granularity) {
    setGranularity(next)
    setShown({ months, span: span ? withGranularity(span, offered, next) : defaultSpan(offered, next) })
  }

  return (
    <section aria-labelledby={headingId} className="mt-10 w-full max-w-3xl">
      <h2 id={headingId} className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        Spending trend
      </h2>

      {offered.length < 2 ? (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">{TOO_FEW_PERIODS.month}</p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-4">
          <GranularitySelect value={granularity} onChange={chooseGranularity} />
          {span &&
            (['from', 'to'] as const).map((end) => (
              <label key={end} className="flex w-fit flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
                {end === 'from' ? 'From' : 'To'}
                <select
                  value={monthValue(span[end])}
                  onChange={(event) => chooseMonth(end, event.target.value)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 font-normal"
                >
                  {offered.map((option) => (
                    <option key={monthValue(option)} value={monthValue(option)}>
                      {monthLabel(option)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
        </div>
      )}

      {offered.length >= 2 && !span && (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">{TOO_FEW_PERIODS[granularity]}</p>
      )}

      {span && (
        <>
          {current && !current.monthly && <ErrorMessage className="mt-3">{LOAD_ERROR}</ErrorMessage>}

          {first && last && (
            <>
              <LineChart
                responsive
                data={points}
                margin={{ top: 8, right: 16, bottom: 8, left: 16 }}
                className="mt-6"
                style={{ width: '100%', height: CHART_HEIGHT, cursor: drawn.length > 0 ? 'pointer' : undefined }}
                onClick={openNearestLine}
              >
                <YAxisInverseScale onScale={(scale) => (yValueAt.current = scale)} />
                <CartesianGrid stroke={colours.grid} vertical={false} />
                <XAxis dataKey="label" stroke={colours.axis} tick={{ fontSize: 12 }} />
                <YAxis
                  tickFormatter={(value: number) => wholeKroner.format(value)}
                  stroke={colours.axis}
                  tick={{ fontSize: 12 }}
                  width={72}
                  label={{
                    value: 'NOK per month',
                    angle: -90,
                    position: 'insideLeft',
                    fontSize: 12,
                    fill: colours.label,
                  }}
                />
                <Tooltip
                  cursor={{ stroke: colours.cursor }}
                  content={({ active, payload }) => {
                    const point = active ? (payload?.[0]?.payload as TrendPoint | undefined) : undefined
                    if (!point) return null
                    return (
                      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-sm shadow-sm">
                        <p className="font-medium text-slate-900 dark:text-slate-100">
                          {point.label}
                          {coverageNote(point)}
                        </p>
                        {drawn.map((row) => (
                          <p key={row.key} className="text-slate-600 dark:text-slate-400 tabular-nums">
                            {row.name} {formatAmount(point.values[row.key])} per month
                          </p>
                        ))}
                      </div>
                    )
                  }}
                />
                {/* Backwards, so the Total line is drawn on top. It is slightly thicker than the rest. */}
                {drawn.toReversed().map((row) => (
                  <Line
                    key={row.key}
                    dataKey={(point: TrendPoint) => point.values[row.key]}
                    name={row.name}
                    stroke={row.colour}
                    strokeWidth={row.key === TOTAL_ROW ? 3 : 2}
                    dot={{ r: row.key === TOTAL_ROW ? 3 : 2, fill: row.colour }}
                    activeDot={{ stroke: colours.ring }}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>

              {/* On a phone the table scrolls sideways on its own, so the page never runs wider than the screen. */}
              <div className="mt-4 max-sm:overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-slate-500 dark:text-slate-400">
                    <tr>
                      <th />
                      <th className="py-2 pr-3 text-right font-medium">{first.label}</th>
                      <th className="py-2 pr-3 text-right font-medium">{last.label}</th>
                      <th className="py-2 text-right font-medium">Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-900 dark:text-slate-100">
                    {rows.map((row) => (
                      <tr key={row.key}>
                        <td className="py-2 pr-3">
                          <label className="flex w-fit items-center gap-2">
                            <input
                              type="checkbox"
                              checked={switchedOn.has(row.key)}
                              onChange={(event) => switchRow(row.key, event.target.checked)}
                              className="size-4 rounded border-slate-300 dark:border-slate-700"
                            />
                            <span
                              aria-hidden="true"
                              className="size-3 shrink-0 rounded-sm"
                              style={{ backgroundColor: row.colour }}
                            />
                            {row.name}
                          </label>
                        </td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                          {formatAmount(first.values[row.key])}
                        </td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                          {formatAmount(last.values[row.key])}
                        </td>
                        <td className="py-2 text-right whitespace-nowrap text-slate-600 dark:text-slate-400 tabular-nums">
                          {formatChange(first.values[row.key], last.values[row.key])}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
