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
import { useIsDark } from '../lib/appearance'
import { categoryColour } from '../lib/categoryColours'
import { categoryName } from '../lib/categoryName'
import { percent } from '../lib/percent'
import { currentMonth } from '../lib/month'
import { GranularitySelect } from './GranularitySelect'
import { ErrorMessage } from './Messages'
import { SpendingTrend } from './SpendingTrend'
import type { TransactionsTarget } from './TransactionsPage'
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

// The empty ring, and the borders between slices in the colour behind the donut, switched with the
// theme.
const RING_COLOURS = {
  light: { empty: '#e2e8f0', border: '#ffffff' },
  dark: { empty: '#1e293b', border: '#020617' },
}

// Shared by the Spending ring and the empty ring.
const RING = { innerRadius: 76, outerRadius: 116, isAnimationActive: false } as const

// One slice as the chart and the legend show it.
interface SliceView {
  key: string
  categoryId: number | null
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

function toSliceViews(spending: Spending, categories: Category[], dark: boolean): SliceView[] {
  return spending.slices.map(({ categoryId, amount }) => ({
    key: String(categoryId),
    categoryId,
    name: categoryName(categoryId, categories),
    amount,
    share: amount / spending.total,
    colour: categoryColour(categoryId, categories, dark),
  }))
}

// Spending by Category for one Period, with the Spending trend over a Span below it. Opens on the
// latest month with Transactions and the Transfers Category left out. A new version, after
// Transactions are saved or on coming back to home, reloads it in place, keeping the chosen Period
// and Include transfers. Its choices last until the browser reloads, never longer. Clicking a slice
// or its legend row opens that Category's Transactions in the Period, as a trend dot does for its
// point.
export function Dashboard({
  version,
  onOpenTransactions,
}: {
  version: number
  onOpenTransactions: (target: TransactionsTarget) => void
}) {
  const headingId = useId()
  const dark = useIsDark()
  const ringColours = RING_COLOURS[dark ? 'dark' : 'light']
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
  // The version last loaded. A new one starts afresh, so an error from an earlier load doesn't
  // outlive it.
  const [loadedVersion, setLoadedVersion] = useState(version)
  if (loadedVersion !== version) {
    setLoadedVersion(version)
    setErrorMessage(null)
  }

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
  const slices = spending && categories ? toSliceViews(spending, categories, dark) : []
  const periodOptions = selected ? periodsOfMonths(months, selected.granularity) : []
  // The Period the slices lead to, once its Spending shows. The Transactions page finds a quarter's
  // first month where the Category has Transactions.
  const targetPeriod = spending && selected

  function openSlice(slice: SliceView) {
    if (targetPeriod) onOpenTransactions({ period: targetPeriod, categoryId: slice.categoryId })
  }

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
        <h2 id={headingId} className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Spending
        </h2>

        {selected && (
          <div className="mt-4 flex flex-wrap gap-4">
            <GranularitySelect
              value={selected.granularity}
              onChange={(granularity) => choosePeriod(switchGranularity(selected, granularity, months))}
            />
            <label className="flex w-fit flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
              Period
              <select
                value={periodValue(selected)}
                onChange={(event) =>
                  choosePeriod(periodOptions.find((option) => periodValue(option) === event.target.value)!)
                }
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 font-normal"
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

        <label className="mt-3 flex w-fit items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={includeTransfers}
            onChange={(event) => chooseIncludeTransfers(event.target.checked)}
            className="size-4 rounded border-slate-300 dark:border-slate-700"
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
                  stroke={ringColours.border}
                  strokeWidth={2}
                  onClick={(_sector, index) => openSlice(slices[index])}
                  style={targetPeriod ? { cursor: 'pointer' } : undefined}
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
                  fill={ringColours.empty}
                  stroke="none"
                />
              )}
              {slices.length > 0 && (
                <Tooltip
                  content={({ active, payload }) => {
                    const slice = active ? (payload?.[0]?.payload as SliceView | undefined) : undefined
                    if (!slice) return null
                    return (
                      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-sm shadow-sm">
                        <p className="font-medium text-slate-900 dark:text-slate-100">{slice.name}</p>
                        <p className="text-slate-600 dark:text-slate-400 tabular-nums">
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
                <span className="text-xs text-slate-500 dark:text-slate-400">Total</span>{' '}
                <span className="text-lg font-semibold text-slate-900 dark:text-slate-100">{formatAmount(spending.total)}</span>
              </p>
            )}
          </div>

          {slices.length > 0 && (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-900 dark:text-slate-100">
                {slices.map((slice) => (
                  <tr key={slice.key}>
                    <td className="py-2 pr-3">
                      {targetPeriod ? (
                        <button
                          type="button"
                          onClick={() => openSlice(slice)}
                          className="flex cursor-pointer items-center gap-2 text-left"
                        >
                          <LegendLabel slice={slice} />
                        </button>
                      ) : (
                        <span className="flex items-center gap-2">
                          <LegendLabel slice={slice} />
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                      {formatAmount(slice.amount)}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap text-slate-500 dark:text-slate-400 tabular-nums">
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
      {selected && (
        <SpendingTrend months={months} categories={categories} onOpenTransactions={onOpenTransactions} />
      )}
    </>
  )
}

// A legend row's swatch and Category name.
function LegendLabel({ slice }: { slice: SliceView }) {
  return (
    <>
      <span aria-hidden="true" className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: slice.colour }} />
      {slice.name}
    </>
  )
}
