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
import { currentMonth } from '../lib/month'
import {
  GRANULARITIES,
  periodLabel,
  periodOfMonth,
  periodsOfMonths,
  periodValue,
  switchGranularity,
  type Granularity,
  type Period,
} from '../lib/period'

const LOAD_ERROR = 'Could not load the Spending.'

const CHART_SIZE = 240

// Keyed by Category id, so each Category keeps its colour whichever Period is shown.
const CATEGORY_COLOURS: Record<number, string> = {
  1: '#2a78d6',
  2: '#eb6834',
  3: '#1baf7a',
  4: '#eda100',
  5: '#e87ba4',
  6: '#008300',
  7: '#4a3aa7',
  8: '#e34948',
  9: '#104281',
  10: '#86b6ef',
  11: '#8a5a1c',
  12: '#0f766e',
  13: '#9085e9',
  14: '#b8336a',
  15: '#6b8e23',
}
// Neutral grey, so Uncategorized stands apart from the Categories.
const UNCATEGORIZED_COLOUR = '#94a3b8'
// For a Category added after this list; never the Uncategorized grey.
const FALLBACK_COLOUR = '#475569'
const EMPTY_RING_COLOUR = '#e2e8f0'

// Shared by the Spending ring and the empty ring.
const RING = { innerRadius: 76, outerRadius: 116, isAnimationActive: false } as const

const percent = new Intl.NumberFormat('nb-NO', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

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
    name:
      categoryId === null
        ? 'Uncategorized'
        : (categories.find((c) => c.id === categoryId)?.name ?? `Category ${categoryId}`),
    amount,
    share: amount / spending.total,
    colour: categoryId === null ? UNCATEGORIZED_COLOUR : (CATEGORY_COLOURS[categoryId] ?? FALLBACK_COLOUR),
  }))
}

// Spending by Category for one Period. Opens on the latest month with Transactions and the Transfers
// Category left out, and remembers nothing between visits.
export function Dashboard() {
  const headingId = useId()
  const [categories, setCategories] = useState<Category[]>([])
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
    Promise.all([fetchCategories(), fetchTransactionMonths()])
      .then(([loadedCategories, loadedMonths]) => {
        if (ignore) return
        setCategories(loadedCategories)
        const available = loadedMonths.length > 0 ? loadedMonths : [currentMonth()]
        setMonths(available)
        setSelected(periodOfMonth(available[0], 'month'))
      })
      .catch(() => {
        if (!ignore) setErrorMessage(LOAD_ERROR)
      })
    return () => {
      ignore = true
    }
  }, [])

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
    loaded && selected && loaded.period === selected && loaded.includeTransfers === includeTransfers
      ? loaded.spending
      : null
  const slices = spending ? toSliceViews(spending, categories) : []
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
    <section aria-labelledby={headingId} className="mt-6 w-full max-w-3xl">
      <h2 id={headingId} className="text-lg font-semibold text-slate-900">
        Spending
      </h2>

      {selected && (
        <div className="mt-4 flex flex-wrap gap-4">
          <label className="flex w-fit flex-col gap-1 text-sm font-medium text-slate-700">
            Granularity
            <select
              value={selected.granularity}
              onChange={(event) =>
                choosePeriod(switchGranularity(selected, event.target.value as Granularity, months))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
            >
              {GRANULARITIES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
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

      {errorMessage && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {errorMessage}
        </p>
      )}

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
  )
}
