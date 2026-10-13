import { useEffect, useId, useState } from 'react'
import { Cell, Pie, PieChart, Tooltip } from 'recharts'
import {
  fetchCategories,
  fetchSpending,
  fetchTransactionMonths,
  type Category,
  type Spending,
  type TransactionMonth,
} from '../lib/api'
import { formatAmount } from '../lib/amount'
import { categoryColour } from '../lib/categoryColours'
import { categoryName } from '../lib/categoryName'
import { percent } from '../lib/percent'
import { currentMonth } from '../lib/month'
import { GranularitySelect } from './GranularitySelect'
import { ErrorMessage } from './Messages'
import { SpendingTrend } from './SpendingTrend'
import {
  periodLabel,
  periodOfMonth,
  periodsOfMonths,
  periodValue,
  switchGranularity,
  type Period,
} from '../lib/period'

const LOAD_ERROR = 'Could not load the Spending.'

const CHART_SIZE = 240

const EMPTY_RING_COLOUR = '#e2e8f0'

// Shared by the Spending ring and the empty ring.
const RING = { innerRadius: 76, outerRadius: 116, isAnimationActive: false } as const

// One slice as the chart and the legend show it.
interface SliceView {
  key: string
  name: string
  amount: number
  share: number
  colour: string
}

// A Period's Spending, remembered with the Period and Include transfers setting it was loaded for.
interface LoadedSpending {
  period: Period
  includeTransfers: boolean
  spending: Spending
}

function toSliceViews(spending: Spending, categories: Category[]): SliceView[] {
  return spending.slices.map(({ categoryId, amount }) => ({
    key: String(categoryId),
    name: categoryName(categoryId, categories),
    amount,
    share: amount / spending.total,
    colour: categoryColour(categoryId, categories),
  }))
}

// Spending by Category for one Period, with the Spending trend over a Span below it. Opens on the
// latest month with Transactions and the Transfers Category left out. A new version, after
// Transactions are saved or on coming back to Home, reloads it in place, keeping the chosen Period
// and Include transfers. Its choices last until the browser reloads, never longer.
export function Dashboard({ version }: { version: number }) {
  const headingId = useId()
  // Null until loaded, so the donut never shows a Category without its name.
  const [categories, setCategories] = useState<Category[] | null>(null)
  // The months with Transactions, newest first, or the current month when there are none. The
  // Periods offered are worked out from them.
  const [months, setMonths] = useState<TransactionMonth[]>([])
  // Null until the months are loaded, which decide the Period the Dashboard opens on: the latest
  // month with Transactions.
  const [selected, setSelected] = useState<Period | null>(null)
  const [includeTransfers, setIncludeTransfers] = useState(false)
  const [loaded, setLoaded] = useState<LoadedSpending | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    // Loaded apart from the months, so the Spending trend still shows, with its Total, when they
    // fail.
    fetchCategories()
      .then((loadedCategories) => {
        if (!ignore) setCategories(loadedCategories)
      })
      .catch(() => {
        if (!ignore) setErrorMessage(LOAD_ERROR)
      })
    fetchTransactionMonths()
      .then((loadedMonths) => {
        if (ignore) return
        const available = loadedMonths.length > 0 ? loadedMonths : [currentMonth()]
        setMonths(available)
        // A fresh copy of a kept Period, so its Spending is fetched again. The current month stands
        // in when there are no Transactions, so it may no longer be offered.
        setSelected((kept) =>
          kept && periodsOfMonths(available, kept.granularity).some((p) => periodValue(p) === periodValue(kept))
            ? { ...kept }
            : periodOfMonth(available[0], 'month'),
        )
      })
      .catch(() => {
        if (!ignore) setErrorMessage(LOAD_ERROR)
      })
    return () => {
      ignore = true
    }
  }, [version])

  useEffect(() => {
    if (!selected) return
    let ignore = false
    fetchSpending(selected, includeTransfers)
      .then((spending) => {
        if (!ignore) setLoaded({ period: selected, includeTransfers, spending })
      })
      .catch(() => {
        if (!ignore) setErrorMessage(LOAD_ERROR)
      })
    return () => {
      ignore = true
    }
  }, [selected, includeTransfers])

  const spending =
    categories && loaded && selected && loaded.period === selected && loaded.includeTransfers === includeTransfers
      ? loaded.spending
      : null
  const slices = spending && categories ? toSliceViews(spending, categories) : []
  const periodOptions = selected ? periodsOfMonths(months, selected.granularity) : []

  function choosePeriod(period: Period) {
    setErrorMessage(null)
    setSelected(period)
  }

  function chooseIncludeTransfers(include: boolean) {
    setErrorMessage(null)
    setIncludeTransfers(include)
  }

  return (
    <>
      <section aria-labelledby={headingId} className="mt-6 w-full max-w-3xl">
        <h2 id={headingId} className="text-lg font-semibold text-slate-900">
          Spending
        </h2>

        {selected && (
          <div className="mt-4 flex flex-wrap gap-4">
            <GranularitySelect
              value={selected.granularity}
              onChange={(granularity) => choosePeriod(switchGranularity(selected, granularity, months))}
            />
            <label className="flex w-fit flex-col gap-1 text-sm font-medium text-slate-700">
              Period
              <select
                value={periodValue(selected)}
                onChange={(event) =>
                  choosePeriod(periodOptions.find((option) => periodValue(option) === event.target.value)!)
                }
                className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
              >
                {periodOptions.map((option) => (
                  <option key={periodValue(option)} value={periodValue(option)}>
                    {periodLabel(option)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <label className="mt-3 flex w-fit items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={includeTransfers}
            onChange={(event) => chooseIncludeTransfers(event.target.checked)}
            className="size-4 rounded border-slate-300"
          />
          Include transfers
        </label>

        {errorMessage && <ErrorMessage className="mt-3">{errorMessage}</ErrorMessage>}

        <div className="mt-6 flex flex-col items-center gap-8 sm:flex-row sm:items-start">
          <div className="relative shrink-0" style={{ width: CHART_SIZE, height: CHART_SIZE }}>
            <PieChart width={CHART_SIZE} height={CHART_SIZE}>
              {slices.length > 0 ? (
                <Pie
                  data={slices}
                  dataKey="amount"
                  nameKey="name"
                  {...RING}
                  stroke="#ffffff"
                  strokeWidth={2}
                >
                  {slices.map((slice) => (
                    <Cell key={slice.key} fill={slice.colour} />
                  ))}
                </Pie>
              ) : (
                <Pie
                  data={[{ amount: 1 }]}
                  dataKey="amount"
                  {...RING}
                  fill={EMPTY_RING_COLOUR}
                  stroke="none"
                />
              )}
              {slices.length > 0 && (
                <Tooltip
                  content={({ active, payload }) => {
                    const slice = active ? (payload?.[0]?.payload as SliceView | undefined) : undefined
                    if (!slice) return null
                    return (
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
                        <p className="font-medium text-slate-900">{slice.name}</p>
                        <p className="text-slate-600 tabular-nums">
                          {formatAmount(slice.amount)} · {percent.format(slice.share)}
                        </p>
                      </div>
                    )
                  }}
                />
              )}
            </PieChart>
            {spending && (
              <p className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xs text-slate-500">Total</span>{' '}
                <span className="text-lg font-semibold text-slate-900">{formatAmount(spending.total)}</span>
              </p>
            )}
          </div>

          {slices.length > 0 && (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-200 text-slate-900">
                {slices.map((slice) => (
                  <tr key={slice.key}>
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-3 shrink-0 rounded-sm"
                          style={{ backgroundColor: slice.colour }}
                        />
                        {slice.name}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                      {formatAmount(slice.amount)}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap text-slate-500 tabular-nums">
                      {percent.format(slice.share)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Waits for the months, which decide the Spans it offers. */}
      {selected && <SpendingTrend months={months} categories={categories} />}
    </>
  )
}
