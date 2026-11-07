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
import { formatAmount, formatSignedAmount, signOf } from '../lib/amount'
import { useIsDark } from '../lib/appearance'
import { canHaveBudget, MONTHS_IN_PERIOD, overallBudgetLeft } from '../lib/budget'
import { categoryColour } from '../lib/categoryColours'
import { categoryName } from '../lib/categoryName'
import { percent } from '../lib/percent'
import { currentMonth } from '../lib/month'
import { BudgetDialog } from './BudgetDialog'
import { GranularitySelect } from './GranularitySelect'
import { ErrorMessage } from './Messages'
import {
  cardBodyClass,
  cardHeaderClass,
  cardTableHeadClass,
  cardTitleClass,
  fieldLabelClass,
  fieldSelectClass,
  panelClass,
} from './panel'
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

// The empty ring, and the borders between slices in the colour of the card behind the donut, switched
// with the theme.
const RING_COLOURS = {
  light: { empty: '#e2e8f0', border: '#ffffff' },
  dark: { empty: '#1e293b', border: '#0f172a' },
}

// Shared by the Spending ring and the empty ring.
const RING = { innerRadius: 84, outerRadius: 118, isAnimationActive: false } as const

// The Budget left figures in green above zero, red below and neutral grey at zero, in Light and Dark.
const BUDGET_LEFT_TONE = {
  1: 'text-emerald-700 dark:text-emerald-400',
  [-1]: 'text-red-700 dark:text-red-400',
  0: 'text-slate-500 dark:text-slate-400',
}

// One row of the legend: a slice of the Spending, or a Category with a Budget but no Spending in the
// Period, shown at 0. A slice whose Spending is above zero is in the ring, with its share of the sum
// of those slices; one below zero, like a Category without Spending, has no part of the ring, and no
// share. budgetLeft is null for Savings and Income, which never have a Budget. A Category whose Budget
// is 0, and Uncategorized, have one of minus their Spending, so the column adds up to the Total row.
interface SliceViewBase {
  key: string
  categoryId: number | null
  name: string
  amount: number
  colour: string
  budgetLeft: number | null
}
type RingSliceView = SliceViewBase & { inRing: true; share: number }
type SliceView = RingSliceView | (SliceViewBase & { inRing: false })

// A Period's Spending, remembered with the Period and Include savings setting it was loaded for.
interface LoadedSpending {
  period: Period
  includeSavings: boolean
  spending: Spending
}

// The slices in the order the API gives them, largest first, so those below zero come last. Each
// Budget counts for the months in the Period.
function toSliceViews(spending: Spending, categories: Category[], months: number, dark: boolean): SliceView[] {
  const ringTotal = spending.slices.reduce((sum, { amount }) => (amount > 0 ? sum + amount : sum), 0)
  return spending.slices.map(({ categoryId, amount }) => {
    const category = categories.find((c) => c.id === categoryId)
    const budget = category?.budget ?? 0
    const base = {
      key: String(categoryId),
      categoryId,
      name: categoryName(categoryId, categories),
      amount,
      colour: categoryColour(categoryId, categories, dark),
      budgetLeft: !category || canHaveBudget(category) ? budget * months - amount : null,
    }
    return amount > 0 ? { ...base, inRing: true, share: amount / ringTotal } : { ...base, inRing: false }
  })
}

// The Categories with a Budget but no slice in the Period, in the order the Categories come in, each
// with no Spending and its whole Budget for the months in the Period left. Listed after the slices,
// so the Budget left column always adds up to the Total row.
function toUnspentBudgetViews(spending: Spending, categories: Category[], months: number, dark: boolean): SliceView[] {
  const withSlice = new Set(spending.slices.map(({ categoryId }) => categoryId))
  return categories
    .filter((c) => c.budget > 0 && !withSlice.has(c.id))
    .map((c) => ({
      key: String(c.id),
      categoryId: c.id,
      name: c.name,
      amount: 0,
      colour: categoryColour(c.id, categories, dark),
      budgetLeft: c.budget * months,
      inRing: false,
    }))
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
//
// Once any Category has a Budget, the legend gets a header, a Budget left column and a Total row,
// each Budget counting for the months in the Period, the whole of it even while the Period is under
// way. It also lists every Category with a Budget but no Spending in the Period, after the others,
// so a Period without Spending still shows them and the Total row. See Budget left in CONTEXT.md.
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
  const monthsInPeriod = selected ? MONTHS_IN_PERIOD[selected.granularity] : 1
  const slices =
    spending && categories
      ? [
          ...toSliceViews(spending, categories, monthsInPeriod, dark),
          ...toUnspentBudgetViews(spending, categories, monthsInPeriod, dark),
        ]
      : []
  const showsBudgets = categories?.some((c) => c.budget > 0) ?? false
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
      <section aria-labelledby={headingId} className={`w-full max-w-4xl ${panelClass}`}>
        <div className={cardHeaderClass}>
          <h2 id={headingId} className={cardTitleClass}>
            Spending
          </h2>

          {selected && (
            <div className="flex flex-wrap gap-3">
              <GranularitySelect
                value={selected.granularity}
                onChange={(granularity) => choosePeriod(switchGranularity(selected, granularity, months))}
              />
              <label className={fieldLabelClass}>
                Period
                <select
                  value={periodValue(selected)}
                  onChange={(event) =>
                    choosePeriod(periodOptions.find((option) => periodValue(option) === event.target.value)!)
                  }
                  className={fieldSelectClass}
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
        </div>

        <div className={cardBodyClass}>
          <div className="flex items-center justify-between gap-4">
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={includeSavings}
                onChange={(event) => chooseIncludeSavings(event.target.checked)}
                className="size-4 rounded border-slate-300 dark:border-slate-700"
              />
              Include savings
            </label>
            {/* At the right, above the legend. Waits for the Categories, which the dialog lists. */}
            <button
              type="button"
              disabled={!categories}
              onClick={() => setIsSettingBudget(true)}
              className="flex items-center gap-1 rounded-md bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-700 dark:text-slate-300 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/10 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-400 dark:disabled:text-slate-500"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="size-3.5 text-slate-500 dark:text-slate-400">
                <path d="M11.013 2.513a1.75 1.75 0 0 1 2.475 2.474L6.226 12.25a2.751 2.751 0 0 1-.892.596l-2.047.848a.75.75 0 0 1-.98-.98l.848-2.047a2.75 2.75 0 0 1 .596-.892l7.262-7.261Z" />
              </svg>
              Set budget
            </button>
          </div>

          {errorMessage && <ErrorMessage className="mt-3">{errorMessage}</ErrorMessage>}

          <div className="mt-5 flex flex-col items-center gap-8 sm:flex-row sm:items-start">
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
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm shadow-md">
                          <p className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.colour }} />
                            {slice.name}
                          </p>
                          <p className="mt-0.5 text-slate-600 dark:text-slate-400 tabular-nums">
                            {formatAmount(slice.amount)} · {percent.format(slice.share)}
                          </p>
                        </div>
                      )
                    }}
                  />
                )}
              </PieChart>
              {spending && (
                <p className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                  <span className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">Total</span>{' '}
                  <span className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
                    {formatAmount(spending.total)}
                  </span>
                </p>
              )}
            </div>

            {/* On a phone the table scrolls sideways on its own, so the page never runs wider than the screen. */}
            {slices.length > 0 && (
              <div className="w-full min-w-0 max-sm:-mx-4 max-sm:w-auto max-sm:self-stretch max-sm:overflow-x-auto max-sm:px-4">
                <table className="w-full text-sm">
                  {showsBudgets && (
                    <thead className={`border-b border-slate-200 dark:border-slate-800 ${cardTableHeadClass}`}>
                      <tr>
                        <th className="pt-1 pr-3 pb-2 text-left">Category</th>
                        <th className="pt-1 pr-3 pb-2 text-right">Spending</th>
                        <th className="pt-1 pb-2 text-right">Share</th>
                        <th className="pt-1 pb-2 pl-3 text-right">Budget left</th>
                      </tr>
                    </thead>
                  )}
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-900 dark:text-slate-100">
                    {slices.map((slice) => (
                      <tr key={slice.key}>
                        <td className="py-2.5 pr-3">
                          {targetPeriod ? (
                            <button
                              type="button"
                              onClick={() => openSlice(slice)}
                              className="group flex cursor-pointer items-center gap-2.5 rounded text-left"
                            >
                              <LegendLabel slice={slice} />
                            </button>
                          ) : (
                            <span className="flex items-center gap-2.5">
                              <LegendLabel slice={slice} />
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-medium whitespace-nowrap tabular-nums">
                          {formatAmount(slice.amount)}
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap text-slate-500 dark:text-slate-400 tabular-nums">
                          {slice.inRing ? percent.format(slice.share) : '–'}
                        </td>
                        {showsBudgets && <BudgetLeftCell budgetLeft={slice.budgetLeft} />}
                      </tr>
                    ))}
                  </tbody>
                  {showsBudgets && spending && categories && (
                    <tfoot className="border-t-2 border-slate-200 dark:border-slate-700 font-semibold text-slate-900 dark:text-slate-100">
                      <tr>
                        <td className="pt-3 pb-1 pr-3">Total</td>
                        <td className="pt-3 pb-1 pr-3 text-right whitespace-nowrap tabular-nums">{formatAmount(spending.total)}</td>
                        <td />
                        <BudgetLeftCell budgetLeft={overallBudgetLeft(spending.slices, categories, monthsInPeriod)} footer />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
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

// A legend row's Budget left: always with its sign, and green, red or grey by it, or "–" for none.
// In the Total row it is spaced as the rest of that row.
function BudgetLeftCell({ budgetLeft, footer = false }: { budgetLeft: number | null; footer?: boolean }) {
  const tone = budgetLeft === null ? BUDGET_LEFT_TONE[0] : BUDGET_LEFT_TONE[signOf(budgetLeft)]
  return (
    <td className={`${footer ? 'pt-3 pb-1' : 'py-2.5'} pl-3 text-right whitespace-nowrap tabular-nums ${tone}`}>
      {budgetLeft === null ? '–' : formatSignedAmount(budgetLeft)}
    </td>
  )
}

// A legend row's swatch and Category name. The swatch is filled for a slice in the ring, and hollow,
// an outline in the Category's colour, for a row with no part of the ring: one below zero, or a
// Category with a Budget but no Spending.
function LegendLabel({ slice }: { slice: SliceView }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={slice.inRing ? 'size-3 shrink-0 rounded-full' : 'size-3 shrink-0 rounded-full border-2'}
        style={
          slice.inRing
            ? { backgroundColor: slice.colour }
            : { borderColor: slice.colour, backgroundColor: 'transparent' }
        }
      />
      <span className="group-hover:underline group-hover:decoration-slate-300 group-hover:underline-offset-4 dark:group-hover:decoration-slate-600">
        {slice.name}
      </span>
    </>
  )
}
