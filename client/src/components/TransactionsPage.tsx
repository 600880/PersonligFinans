import { useEffect, useState } from 'react'
import {
  changeTransactionCategory,
  fetchCategories,
  fetchTransactionMonths,
  fetchTransactionsOfMonth,
  type Category,
  type Transaction,
  type TransactionMonth,
} from '../lib/api'
import { formatAmount } from '../lib/amount'
import { formatNorwegianDate } from '../lib/date'
import { currentMonth, MONTH_NAMES } from '../lib/month'

const LOAD_ERROR = 'Could not load the transactions.'

const inputClass = 'rounded-lg border border-slate-300 px-3 py-2 font-normal'
const categorySelectClass =
  'rounded-lg border border-slate-300 px-2 py-1 disabled:cursor-not-allowed disabled:bg-slate-100'

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
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // The Transactions whose Category is being saved. Their selects are disabled until it is, so a
  // failed save never goes back over a later choice.
  const [savingIds, setSavingIds] = useState<ReadonlySet<number>>(new Set())

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

  function chooseMonth(change: Partial<TransactionMonth>) {
    if (!selected) return
    setStatusMessage(null)
    setErrorMessage(null)
    setSelected({ ...selected, ...change })
  }

  function showCategory(id: number, categoryId: number | null) {
    setLoaded(
      (current) =>
        current && {
          ...current,
          transactions: current.transactions.map((t) => (t.id === id ? { ...t, categoryId } : t)),
        },
    )
  }

  function setSaving(id: number, saving: boolean) {
    setSavingIds((current) => {
      const next = new Set(current)
      if (saving) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // Shows the chosen Category at once, and goes back to the previous one when saving fails, so the
  // page never keeps a Category that wasn't saved.
  async function changeCategory(transaction: Transaction, categoryId: number) {
    setStatusMessage(null)
    setErrorMessage(null)
    setSaving(transaction.id, true)
    showCategory(transaction.id, categoryId)

    const result = await changeTransactionCategory(transaction.id, categoryId).finally(() =>
      setSaving(transaction.id, false),
    )

    if (result.ok) {
      showCategory(transaction.id, result.transaction.categoryId)
      setStatusMessage('Category changed')
    } else {
      showCategory(transaction.id, transaction.categoryId)
      setErrorMessage(result.message)
    }
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

      {errorMessage ? (
        <p role="alert" className="mt-3 min-h-5 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : (
        <p role="status" className="mt-3 h-5 text-sm text-emerald-700">
          {statusMessage}
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
                  <select
                    aria-label={`Category for ${transaction.description}`}
                    value={transaction.categoryId ?? ''}
                    disabled={savingIds.has(transaction.id)}
                    onChange={(event) => changeCategory(transaction, Number(event.target.value))}
                    className={`${categorySelectClass} ${
                      transaction.categoryId === null ? 'text-slate-400' : 'text-slate-900'
                    }`}
                  >
                    {transaction.categoryId === null && (
                      <option value="" disabled>
                        Uncategorized
                      </option>
                    )}
                    {categories.map((category) => (
                      <option key={category.id} value={category.id} className="text-slate-900">
                        {category.name}
                      </option>
                    ))}
                  </select>
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
