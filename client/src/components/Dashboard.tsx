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
import { BudgetDialog } from './BudgetDialog'
import { secondaryButtonClass } from './buttons'
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

// One slice of the Spending as the legend shows it. A slice whose Spending is above zero is in the
// ring, with its share of the sum of those slices; one below zero has no part of the ring, and no
// share.
interface SliceViewBase {
  key: string
  categoryId: number | null
  name: string
  amount: number
  colour: string
}
type RingSliceView = SliceViewBase & { inRing: true; share: number }
type SliceView = RingSliceView | (SliceViewBase & { inRing: false })

// A Period's Spending, remembered with the Period and Include savings setting it was loaded for.
interface LoadedSpending {
  period: Period
  includeSavings: boolean
  spending: Spending
}

// The slices in the order the API gives them, largest first, so those below zero come last.
function toSliceViews(spending: Spending, categories: Category[], dark: boolean): SliceView[] {
  const ringTotal = spending.slices.reduce((sum, { amount }) => (amount > 0 ? sum + amount : sum), 0)
  return spending.slices.map(({ categoryId, amount }) => {
    const base = {
      key: String(categoryId),
      categoryId,
      name: categoryName(categoryId, categories),
      amount,
      colour: categoryColour(categoryId, categories, dark),
    }
    return amount > 0 ? { ...base, inRing: true, share: amount / ringTotal } : { ...base, inRing: false }
  })
}

// Spending by Category for one Period, with the Spending trend over a Span below it. Opens on the
// latest month with Transactions and the Savings Category left out. A new version, after
// Transactions are saved or on coming back to home, reloads it in place, keeping the chosen Period
// and Include savings. Its choices last until the browser reloads, never longer.
//
// The ring is drawn from the Categories whose Spending is above zero, each with its share of their
// sum, or is the empty ring when there are none. The legend lists every Category with Spending in
// the Period, those below zero last with a hollow swatch and no share, and the centre shows the
// Period's total, the net of them all, which can be zero or below. Clicking a slice or a legend row
// opens that Category's Transactions in the Period, as a trend dot does for its point.
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
  const [includeSavings, setIncludeSavings] = useState(false)
  const [isSettingBudget, setIsSettingBudget] = useState(false)
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
    fetchSpending(selected, includeSavings)
      .then((spending) => {
        if (!ignore) setLoaded({ period: selected, includeSavings, spending })
      })
      .catch(() => {
        if (!ignore) setErrorMessage(LOAD_ERROR)
      })
    return () => {
      ignore = true
    }
  }, [selected, includeSavings])

  const spending =
    categories && loaded && selected && loaded.period === selected && loaded.includeSavings === includeSavings
      ? loaded.spending
      : null
  const slices = spending && categories ? toSliceViews(spending, categories, dark) : []
  const ringSlices = slices.filter((slice): slice is RingSliceView => slice.inRing)
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

  function chooseIncludeSavings(include: boolean) {
    setErrorMessage(null)
    setIncludeSavings(include)
  }

  return (
    <>
      <section aria-labelledby={headingId} className="mt-6 w-full max-w-3xl">
        <h2 id={headingId} className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Spending
        </h2>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          {selected && (
            <>
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
            </>
          )}
          {/* Waits for the Categories, which the dialog lists. */}
          <button
            type="button"
            disabled={!categories}
            onClick={() => setIsSettingBudget(true)}
            className={secondaryButtonClass}
          >
            Set Budget
          </button>
        </div>

        <label className="mt-3 flex w-fit items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={includeSavings}
            onChange={(event) => chooseIncludeSavings(event.target.checked)}
            className="size-4 rounded border-slate-300 dark:border-slate-700"
          />
          Include savings
        </label>

        {errorMessage && <ErrorMessage className="mt-3">{errorMessage}</ErrorMessage>}

        <div className="mt-6 flex flex-col items-center gap-8 sm:flex-row sm:items-start">
          <div className="relative shrink-0" style={{ width: CHART_SIZE, height: CHART_SIZE }}>
            <PieChart width={CHART_SIZE} height={CHART_SIZE}>
              {ringSlices.length > 0 ? (
                <Pie
                  data={ringSlices}
                  dataKey="amount"
                  nameKey="name"
                  {...RING}
                  stroke={ringColours.border}
                  strokeWidth={2}
                  onClick={(_sector, index) => openSlice(ringSlices[index])}
                  style={targetPeriod ? { cursor: 'pointer' } : undefined}
                >
                  {ringSlices.map((slice) => (
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
              {ringSlices.length > 0 && (
                <Tooltip
                  content={({ active, payload }) => {
                    const slice = active ? (payload?.[0]?.payload as RingSliceView | undefined) : undefined
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
                      {slice.inRing ? percent.format(slice.share) : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {isSettingBudget && categories && (
        <BudgetDialog
          categories={categories}
          onCancel={() => setIsSettingBudget(false)}
          onSaved={(saved) => {
            setCategories(saved)
            setIsSettingBudget(false)
          }}
        />
      )}

      {/* Waits for the months, which decide the Spans it offers. */}
      {selected && (
        <SpendingTrend months={months} categories={categories} onOpenTransactions={onOpenTransactions} />
      )}
    </>
  )
}

// A legend row's swatch and Category name. The swatch is filled for a slice in the ring, and hollow,
// an outline in the Category's colour, for one below zero, which has no part of the ring.
function LegendLabel({ slice }: { slice: SliceView }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={slice.inRing ? 'size-3 shrink-0 rounded-sm' : 'size-3 shrink-0 rounded-sm border-2'}
        style={
          slice.inRing
            ? { backgroundColor: slice.colour }
            : { borderColor: slice.colour, backgroundColor: 'transparent' }
        }
      />
      {slice.name}
    </>
  )
}
