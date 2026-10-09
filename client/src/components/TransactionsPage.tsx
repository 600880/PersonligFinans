import { useEffect, useState } from 'react'
import {
  fetchCategories,
  fetchTransactionMonths,
  fetchTransactionsOfMonth,
  type Category,
  type Transaction,
  type TransactionMonth,
} from '../lib/api'
import { formatAmount } from '../lib/amount'
import { formatNorwegianDate } from '../lib/date'

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const LOAD_ERROR = 'Could not load the transactions.'

const inputClass = 'rounded-lg border border-slate-300 px-3 py-2 font-normal'

function currentMonth(): TransactionMonth {
  const today = new Date()
  return { year: today.getFullYear(), month: today.getMonth() + 1 }
}

// A month's Transactions, remembered with the month they were loaded for.
interface LoadedMonth extends TransactionMonth {
  transactions: Transaction[]
}

export function TransactionsPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [monthsWithTransactions, setMonthsWithTransactions] = useState<TransactionMonth[]>([])
  // Null until the months are loaded, which decides the month the page opens on.
  const [selected, setSelected] = useState<TransactionMonth | null>(null)
  const [loaded, setLoaded] = useState<LoadedMonth | null>(null)
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
    fetchTransactionsOfMonth(selected)
      .then((transactions) => {
        if (!ignore) setLoaded({ ...selected, transactions })
      })
      .catch(() => {
        if (!ignore) setErrorMessage(LOAD_ERROR)
      })
    return () => {
      ignore = true
    }
  }, [selected])

  const years = [
    ...new Set([currentMonth().year, ...monthsWithTransactions.map((m) => m.year)]),
  ].sort((a, b) => b - a)
  const transactions =
    loaded && loaded.year === selected?.year && loaded.month === selected.month
      ? loaded.transactions
      : null
  const categoryName = (id: number | null) => categories.find((c) => c.id === id)?.name

  function chooseMonth(change: Partial<TransactionMonth>) {
    if (!selected) return
    setErrorMessage(null)
    setSelected({ ...selected, ...change })
  }

  return (
    <section className="w-full max-w-3xl">
      <h2 className="text-lg font-semibold text-slate-900">Transactions</h2>

      {selected && (
        <div className="mt-4 flex gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Year
            <select
              value={selected.year}
              onChange={(event) => chooseMonth({ year: Number(event.target.value) })}
              className={inputClass}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Month
            <select
              value={selected.month}
              onChange={(event) => chooseMonth({ month: Number(event.target.value) })}
              className={inputClass}
            >
              {MONTH_NAMES.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {errorMessage && (
        <p role="alert" className="mt-3 min-h-5 text-sm text-red-700">
          {errorMessage}
        </p>
      )}

      {selected && transactions?.length === 0 && (
        <p className="mt-6 text-sm text-slate-500">
          No transactions in {MONTH_NAMES[selected.month - 1]} {selected.year}
        </p>
      )}

      {transactions && transactions.length > 0 && (
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="py-2 font-medium">Date</th>
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 font-medium">Category</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-900">
            {transactions.map((transaction) => (
              <tr key={transaction.id}>
                <td className="py-2 pr-3 whitespace-nowrap">{formatNorwegianDate(transaction.date)}</td>
                <td className="py-2 pr-3">{transaction.description}</td>
                <td className="py-2 pr-3">
                  {categoryName(transaction.categoryId) ?? (
                    <span className="text-slate-400">Uncategorized</span>
                  )}
                </td>
                <td className="py-2 text-right whitespace-nowrap tabular-nums">
                  {formatAmount(transaction.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
