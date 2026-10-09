import { useEffect, useId, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import { fetchMonthlySpending, type MonthSpending, type TransactionMonth } from '../lib/api'
import { formatAmount } from '../lib/amount'
import { defaultSpan, monthLabel, monthValue, offeredMonths, withFrom, withTo, type Span } from '../lib/span'
import { formatChange, trendPoints, type TrendPoint } from '../lib/trend'

const LOAD_ERROR = 'Could not load the Spending trend.'

const CHART_HEIGHT = 280

// Dark slate, outside the Category palette, so the Total line stands apart from every Category.
const TOTAL_COLOUR = '#1e293b'

const wholeKroner = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 })

// A Span's monthly Spending, remembered with the Span it was loaded for; null when loading failed.
interface LoadedTrend {
  span: Span
  monthly: MonthSpending[] | null
}

// How Spending changed over a Span, as a line with one point per month and a table of the first and
// last points. `months` are the months with Transactions, newest first, which decide the months
// offered. Opens on the 12 months ending at the latest of them, and does so again whenever they are
// reloaded. Transfers are always left out.
export function SpendingTrend({ months }: { months: TransactionMonth[] }) {
  const headingId = useId()
  const offered = useMemo(() => offeredMonths(months), [months])
  // The Span the user chose, remembered with the months it was chosen from.
  const [chosen, setChosen] = useState<{ months: TransactionMonth[]; span: Span } | null>(null)
  const span = useMemo(
    () => (chosen && chosen.months === months ? chosen.span : defaultSpan(offered)),
    [chosen, months, offered],
  )
  const [loaded, setLoaded] = useState<LoadedTrend | null>(null)

  useEffect(() => {
    if (!span) return
    let ignore = false
    fetchMonthlySpending(span, false)
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
  const points = current?.monthly ? trendPoints(current.monthly) : []
  const first = points[0]
  const last = points[points.length - 1]

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
                        <p className="font-medium text-slate-900">{point.label}</p>
                        <p className="text-slate-600 tabular-nums">Total {formatAmount(point.total)} per month</p>
                      </div>
                    )
                  }}
                />
                <Line
                  dataKey="total"
                  name="Total"
                  stroke={TOTAL_COLOUR}
                  strokeWidth={3}
                  dot={{ r: 3, fill: TOTAL_COLOUR }}
                  isAnimationActive={false}
                />
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
                  <tr>
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-3 shrink-0 rounded-sm"
                          style={{ backgroundColor: TOTAL_COLOUR }}
                        />
                        Total
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                      {formatAmount(first.total)}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                      {formatAmount(last.total)}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap text-slate-600 tabular-nums">
                      {formatChange(first.total, last.total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </section>
  )
}
