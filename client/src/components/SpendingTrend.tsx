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

// Dark slate, outside the Category palette, so the Total line stands apart from every Category.
const TOTAL_COLOUR = '#1e293b'

const wholeKroner = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 })

// A Span's monthly Spending, remembered with the Span and Include transfers setting it was loaded
// for; null when loading failed.
interface LoadedTrend {
  span: Span
  includeTransfers: boolean
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

// The Total row, then one per Category with Spending in the Span, largest first. The Categories wait
// for their names, so a Category is never shown without its name.
function trendRows(monthly: MonthSpending[], categories: Category[] | null): TrendRow[] {
  const total = { key: TOTAL_ROW, categoryId: 'all' as const, name: 'Total', colour: TOTAL_COLOUR }
  if (!categories) return [total]
  return [
    total,
    ...trendCategories(monthly).map((categoryId) => ({
      key: categoryRow(categoryId),
      categoryId,
      name: categoryName(categoryId, categories),
      colour: categoryColour(categoryId, categories),
    })),
  ]
}

// How Spending changed over a Span, as lines with a point per Period of its own Granularity, Month
// at first, and a table of the first and last points for Total and each Category. Each row switches
// its line on and off; Total starts on and the Categories off, and they stay as switched when the
// Span changes. `months` are the months with Transactions, newest first, which decide the months
// offered. Opens on the 12 months ending at the latest of them. When they are reloaded, after
// Transactions are saved or on coming back to home, it fetches its Spending again, keeping the Span
// if both its ends are still offered and otherwise going back to the 12 months; its Granularity,
// Include transfers and switched-on lines are kept. Has its own Include transfers, off at first and
// apart from the donut's. Clicking the chart opens the Transactions of the line nearest the click,
// in the Period of the point clicked.
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
  const [includeTransfers, setIncludeTransfers] = useState(false)
  const [loaded, setLoaded] = useState<LoadedTrend | null>(null)
  // The rows whose lines are drawn, by key. Kept for rows missing from the current Span, so they are
  // drawn again when a later Span includes them.
  const [switchedOn, setSwitchedOn] = useState<ReadonlySet<string>>(() => new Set([TOTAL_ROW]))

  useEffect(() => {
    if (!span) return
    let ignore = false
    fetchMonthlySpending(span, includeTransfers)
      .then((monthly) => {
        if (!ignore) setLoaded({ span, includeTransfers, monthly })
      })
      .catch(() => {
        if (!ignore) setLoaded({ span, includeTransfers, monthly: null })
      })
    return () => {
      ignore = true
    }
  }, [span, includeTransfers])

  const current = loaded && loaded.span === span && loaded.includeTransfers === includeTransfers ? loaded : null
  const points = current?.monthly ? trendPoints(current.monthly, granularity) : []
  const first = points[0]
  const last = points[points.length - 1]
  const rows = current?.monthly ? trendRows(current.monthly, categories) : []
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
      <h2 id={headingId} className="text-lg font-semibold text-slate-900">
        Spending trend
      </h2>

      {offered.length < 2 ? (
        <p className="mt-4 text-sm text-slate-600">{TOO_FEW_PERIODS.month}</p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-4">
          <GranularitySelect value={granularity} onChange={chooseGranularity} />
          {span &&
            (['from', 'to'] as const).map((end) => (
              <label key={end} className="flex w-fit flex-col gap-1 text-sm font-medium text-slate-700">
                {end === 'from' ? 'From' : 'To'}
                <select
                  value={monthValue(span[end])}
                  onChange={(event) => chooseMonth(end, event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
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
        <p className="mt-4 text-sm text-slate-600">{TOO_FEW_PERIODS[granularity]}</p>
      )}

      {span && (
        <>

          <label className="mt-3 flex w-fit items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={includeTransfers}
              onChange={(event) => setIncludeTransfers(event.target.checked)}
              className="size-4 rounded border-slate-300"
            />
            Include transfers
          </label>

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
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis
                  tickFormatter={(value: number) => wholeKroner.format(value)}
                  tick={{ fontSize: 12 }}
                  width={72}
                  label={{ value: 'NOK per month', angle: -90, position: 'insideLeft', fontSize: 12 }}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    const point = active ? (payload?.[0]?.payload as TrendPoint | undefined) : undefined
                    if (!point) return null
                    return (
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
                        <p className="font-medium text-slate-900">
                          {point.label}
                          {coverageNote(point)}
                        </p>
                        {drawn.map((row) => (
                          <p key={row.key} className="text-slate-600 tabular-nums">
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
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>

              {/* On a phone the table scrolls sideways on its own, so the page never runs wider than the screen. */}
              <div className="mt-4 max-sm:overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th />
                      <th className="py-2 pr-3 text-right font-medium">{first.label}</th>
                      <th className="py-2 pr-3 text-right font-medium">{last.label}</th>
                      <th className="py-2 text-right font-medium">Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-900">
                    {rows.map((row) => (
                      <tr key={row.key}>
                        <td className="py-2 pr-3">
                          <label className="flex w-fit items-center gap-2">
                            <input
                              type="checkbox"
                              checked={switchedOn.has(row.key)}
                              onChange={(event) => switchRow(row.key, event.target.checked)}
                              className="size-4 rounded border-slate-300"
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
                        <td className="py-2 text-right whitespace-nowrap text-slate-600 tabular-nums">
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
