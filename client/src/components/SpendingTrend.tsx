import { useEffect, useId, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import { fetchMonthlySpending, type Category, type MonthSpending, type TransactionMonth } from '../lib/api'
import { formatAmount } from '../lib/amount'
import { categoryColour } from '../lib/categoryColours'
import { categoryName } from '../lib/categoryName'
import { defaultSpan, monthLabel, monthValue, offeredMonths, withFrom, withTo, type Span } from '../lib/span'
import {
  categoryRow,
  coverageNote,
  formatChange,
  TOTAL_ROW,
  trendCategories,
  trendPoints,
  type TrendPoint,
} from '../lib/trend'

const LOAD_ERROR = 'Could not load the Spending trend.'

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

// One row of the table, and the line it switches on.
interface TrendRow {
  key: string
  name: string
  colour: string
}

// The Total row, then one per Category with Spending in the Span, largest first. The Categories wait
// for their names, so a Category is never shown without its name.
function trendRows(monthly: MonthSpending[], categories: Category[] | null): TrendRow[] {
  const total = { key: TOTAL_ROW, name: 'Total', colour: TOTAL_COLOUR }
  if (!categories) return [total]
  return [
    total,
    ...trendCategories(monthly).map((categoryId) => ({
      key: categoryRow(categoryId),
      name: categoryName(categoryId, categories),
      colour: categoryColour(categoryId),
    })),
  ]
}

// How Spending changed over a Span, as lines with a point per month, quarter or half-year and a table
// of the first and last points for Total and each Category. Each row switches its line on and off;
// Total starts on and the Categories off, and they stay as switched when the Span changes. `months`
// are the months with Transactions, newest first, which decide the months offered. Opens on the 12
// months ending at the latest of them, and does so again whenever they are reloaded. Has its own
// Include transfers, off at first and apart from the donut's.
export function SpendingTrend({ months, categories }: { months: TransactionMonth[]; categories: Category[] | null }) {
  const headingId = useId()
  const offered = useMemo(() => offeredMonths(months), [months])
  // The Span the user chose, remembered with the months it was chosen from.
  const [chosen, setChosen] = useState<{ months: TransactionMonth[]; span: Span } | null>(null)
  const span = useMemo(
    () => (chosen && chosen.months === months ? chosen.span : defaultSpan(offered)),
    [chosen, months, offered],
  )
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
  const points = current?.monthly ? trendPoints(current.monthly) : []
  const first = points[0]
  const last = points[points.length - 1]
  const rows = current?.monthly ? trendRows(current.monthly, categories) : []
  const drawn = rows.filter((row) => switchedOn.has(row.key))

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
    setChosen({ months, span: end === 'from' ? withFrom(span, month, offered) : withTo(span, month, offered) })
  }

  return (
    <section aria-labelledby={headingId} className="mt-10 w-full max-w-3xl">
      <h2 id={headingId} className="text-lg font-semibold text-slate-900">
        Spending trend
      </h2>

      {!span ? (
        <p className="mt-4 text-sm text-slate-600">Trends need at least two months with Transactions</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-4">
            {(['from', 'to'] as const).map((end) => (
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

          <label className="mt-3 flex w-fit items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={includeTransfers}
              onChange={(event) => setIncludeTransfers(event.target.checked)}
              className="size-4 rounded border-slate-300"
            />
            Include transfers
          </label>

          {current && !current.monthly && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {LOAD_ERROR}
            </p>
          )}

          {first && last && (
            <>
              <LineChart
                responsive
                data={points}
                margin={{ top: 8, right: 16, bottom: 8, left: 16 }}
                className="mt-6"
                style={{ width: '100%', height: CHART_HEIGHT }}
              >
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

              <table className="mt-4 w-full text-sm">
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
            </>
          )}
        </>
      )}
    </section>
  )
}
