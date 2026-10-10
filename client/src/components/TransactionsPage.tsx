import { useEffect, useState } from 'react'
import {
  changeTransactionCategory,
  fetchCategories,
  fetchTransactionMonths,
  fetchTransactions,
  type Category,
  type Transaction,
  type TransactionMonth,
  type YearOrMonth,
} from '../lib/api'
import { formatAmount } from '../lib/amount'
import { formatNorwegianDate } from '../lib/date'
import { currentMonth, MONTH_NAMES } from '../lib/month'
import { periodLabel, periodValue } from '../lib/period'

const LOAD_ERROR = 'Could not load the transactions.'

const inputClass = 'rounded-lg border border-slate-300 px-3 py-2 font-normal'
const categorySelectClass =
  'rounded-lg border border-slate-300 px-2 py-1 disabled:cursor-not-allowed disabled:bg-slate-100'

// A Period's Transactions, remembered with the Period they were loaded for.
interface LoadedPeriod {
  period: YearOrMonth
  transactions: Transaction[]
}

// The Category filter's value: '' for all Categories, UNCATEGORIZED, or a Category's id.
const UNCATEGORIZED = 'uncategorized'

function matchesCategory(transaction: Transaction, categoryFilter: string) {
  if (categoryFilter === '') return true
  if (categoryFilter === UNCATEGORIZED) return transaction.categoryId === null
  return transaction.categoryId === Number(categoryFilter)
}

// Whether the description contains the search text, ignoring case and the text's surrounding spaces.
// Æ, Ø and Å are letters of their own, so "o" never matches "ø".
function matchesSearch(transaction: Transaction, search: string) {
  return transaction.description.toLowerCase().includes(search.trim().toLowerCase())
}

export function TransactionsPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [monthsWithTransactions, setMonthsWithTransactions] = useState<TransactionMonth[]>([])
  // The chosen month or whole year. Null until the months are loaded, which decide the month the
  // page opens on.
  const [selected, setSelected] = useState<YearOrMonth | null>(null)
  const [loaded, setLoaded] = useState<LoadedPeriod | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // The Transactions whose Category is being saved. Their selects are disabled until it is, so a
  // failed save never goes back over a later choice.
  const [savingIds, setSavingIds] = useState<ReadonlySet<number>>(new Set())
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    let ignore = false
    Promise.all([fetchCategories(), fetchTransactionMonths()])
      .then(([loadedCategories, loadedMonths]) => {
        if (ignore) return
        setCategories(loadedCategories)
        setMonthsWithTransactions(loadedMonths)
        setSelected({ granularity: 'month', ...(loadedMonths[0] ?? currentMonth()) })
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
    fetchTransactions(selected)
      .then((transactions) => {
        if (!ignore) setLoaded({ period: selected, transactions })
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
    loaded && selected && periodValue(loaded.period) === periodValue(selected) ? loaded.transactions : null
  const isFiltering = categoryFilter !== '' || search.trim() !== ''
  const shownTransactions =
    transactions?.filter((t) => matchesCategory(t, categoryFilter) && matchesSearch(t, search)) ?? null

  function choosePeriod(period: YearOrMonth) {
    setStatusMessage(null)
    setErrorMessage(null)
    setSelected(period)
  }

  function showChange(id: number, change: Partial<Transaction>) {
    setLoaded(
      (current) =>
        current && {
          ...current,
          transactions: current.transactions.map((t) => (t.id === id ? { ...t, ...change } : t)),
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
  // page never keeps a Category that wasn't saved. The AI marker goes once the change is saved.
  async function changeCategory(transaction: Transaction, categoryId: number) {
    setStatusMessage(null)
    setErrorMessage(null)
    setSaving(transaction.id, true)
    showChange(transaction.id, { categoryId })

    const result = await changeTransactionCategory(transaction.id, categoryId).finally(() =>
      setSaving(transaction.id, false),
    )

    if (result.ok) {
      const { categoryId: savedCategoryId, aiPlacedInOther } = result.transaction
      showChange(transaction.id, { categoryId: savedCategoryId, aiPlacedInOther })
      setStatusMessage('Category changed')
    } else {
      showChange(transaction.id, { categoryId: transaction.categoryId })
      setErrorMessage(result.message)
    }
  }

  return (
    <section className="w-full max-w-3xl">
      <h2 className="text-lg font-semibold text-slate-900">Transactions</h2>

      {selected && (
        <div className="mt-4 flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Year
            <select
              value={selected.year}
              onChange={(event) => choosePeriod({ ...selected, year: Number(event.target.value) })}
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
              value={selected.granularity === 'month' ? selected.month : ''}
              onChange={(event) =>
                choosePeriod(
                  event.target.value === ''
                    ? { granularity: 'year', year: selected.year }
                    : { granularity: 'month', year: selected.year, month: Number(event.target.value) },
                )
              }
              className={inputClass}
            >
              <option value="">All months</option>
              {MONTH_NAMES.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Category
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className={inputClass}
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
              <option value={UNCATEGORIZED}>Uncategorized</option>
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
            Search
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className={inputClass}
            />
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

      {selected && shownTransactions?.length === 0 && (
        <p className="mt-6 text-sm text-slate-500">
          {isFiltering ? 'No transactions match' : `No transactions in ${periodLabel(selected)}`}
        </p>
      )}

      {shownTransactions && shownTransactions.length > 0 && (
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
            {shownTransactions.map((transaction) => (
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
                  {transaction.aiPlacedInOther && (
                    <>
                      {' '}
                      <span
                        title="AI-placed in Other"
                        className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-700"
                      >
                        AI
                      </span>
                    </>
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
