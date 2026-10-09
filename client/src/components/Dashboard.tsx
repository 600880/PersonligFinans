import { useEffect, useId, useState } from 'react'
import { Cell, Pie, PieChart, Tooltip } from 'recharts'
import {
  fetchCategories,
  fetchSpendingOfMonth,
  fetchTransactionMonths,
  type Category,
  type Spending,
  type TransactionMonth,
} from '../lib/api'
import { formatAmount } from '../lib/amount'
import { currentMonth, MONTH_NAMES } from '../lib/month'

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
// Neutral grey, so Uncategorized reads as pending rather than as a Category.
const UNCATEGORIZED_COLOUR = '#94a3b8'
const EMPTY_RING_COLOUR = '#e2e8f0'

const percent = new Intl.NumberFormat('nb-NO', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

// One slice as the chart and the legend show it.
interface Row {
  key: string
  name: string
  amount: number
  share: number
  colour: string
}

// A month's Spending, remembered with the month it was loaded for.
interface LoadedSpending extends TransactionMonth {
  spending: Spending
}

function monthValue({ year, month }: TransactionMonth) {
  return `${year}-${month}`
}

function toRows(spending: Spending, categories: Category[]): Row[] {
  return spending.slices.map(({ categoryId, amount }) => ({
    key: String(categoryId),
    name:
      categoryId === null
        ? 'Uncategorized'
        : (categories.find((c) => c.id === categoryId)?.name ?? `Category ${categoryId}`),
    amount,
    share: amount / spending.total,
    colour: categoryId === null ? UNCATEGORIZED_COLOUR : (CATEGORY_COLOURS[categoryId] ?? UNCATEGORIZED_COLOUR),
  }))
}

// Spending by Category for one month. Opens on the latest month with Transactions, and remembers
// nothing between visits.
export function Dashboard() {
  const headingId = useId()
  const [categories, setCategories] = useState<Category[]>([])
  const [monthsWithTransactions, setMonthsWithTransactions] = useState<TransactionMonth[]>([])
  // Null until the months are loaded, which decides the month the Dashboard opens on.
  const [selected, setSelected] = useState<TransactionMonth | null>(null)
  const [loaded, setLoaded] = useState<LoadedSpending | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    Promise.all([fetchCategories(), fetchTransactionMonths()])
      .then(([loadedCategories, loadedMonths]) => {
        if (ignore) return
        setCategories(loadedCategories)
        setMonthsWithTransactions(loadedMonths)
        setSelected(loadedMonths[0] ?? currentMonth())
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
    fetchSpendingOfMonth(selected)
      .then((spending) => {
        if (!ignore) setLoaded({ ...selected, spending })
      })
      .catch(() => {
        if (!ignore) setErrorMessage(LOAD_ERROR)
      })
    return () => {
      ignore = true
    }
  }, [selected])

  const spending =
    loaded && loaded.year === selected?.year && loaded.month === selected.month ? loaded.spending : null
  const rows = spending ? toRows(spending, categories) : []
  const monthOptions = monthsWithTransactions.length > 0 ? monthsWithTransactions : selected ? [selected] : []

  function chooseMonth(value: string) {
    const [year, month] = value.split('-').map(Number)
    setErrorMessage(null)
    setSelected({ year, month })
  }

  return (
    <section aria-labelledby={headingId} className="mt-6 w-full max-w-3xl">
      <h2 id={headingId} className="text-lg font-semibold text-slate-900">
        Spending
      </h2>

      {selected && (
        <label className="mt-4 flex w-fit flex-col gap-1 text-sm font-medium text-slate-700">
          Period
          <select
            value={monthValue(selected)}
            onChange={(event) => chooseMonth(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
          >
            {monthOptions.map((option) => (
              <option key={monthValue(option)} value={monthValue(option)}>
                {MONTH_NAMES[option.month - 1]} {option.year}
              </option>
            ))}
          </select>
        </label>
      )}

      {errorMessage && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {errorMessage}
        </p>
      )}

      <div className="mt-6 flex flex-col items-center gap-8 sm:flex-row sm:items-start">
        <div className="relative shrink-0" style={{ width: CHART_SIZE, height: CHART_SIZE }}>
          <PieChart width={CHART_SIZE} height={CHART_SIZE}>
            {rows.length > 0 ? (
              <Pie
                data={rows}
                dataKey="amount"
                nameKey="name"
                innerRadius={76}
                outerRadius={116}
                stroke="#ffffff"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {rows.map((row) => (
                  <Cell key={row.key} fill={row.colour} />
                ))}
              </Pie>
            ) : (
              <Pie
                data={[{ amount: 1 }]}
                dataKey="amount"
                innerRadius={76}
                outerRadius={116}
                fill={EMPTY_RING_COLOUR}
                stroke="none"
                isAnimationActive={false}
              />
            )}
            {rows.length > 0 && (
              <Tooltip
                content={({ active, payload }) => {
                  const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined
                  if (!row) return null
                  return (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
                      <p className="font-medium text-slate-900">{row.name}</p>
                      <p className="text-slate-600 tabular-nums">
                        {formatAmount(row.amount)} · {percent.format(row.share)}
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

        {rows.length > 0 && (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-200 text-slate-900">
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-3 shrink-0 rounded-sm"
                        style={{ backgroundColor: row.colour }}
                      />
                      {row.name}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                    {formatAmount(row.amount)}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap text-slate-500 tabular-nums">
                    {percent.format(row.share)}
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
