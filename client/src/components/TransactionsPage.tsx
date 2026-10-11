import { Fragment, useEffect, useState } from 'react'
import {
  changeTransactionCategory,
  deleteTransaction,
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
const smallButtonClass =
  'rounded-lg px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300'
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
  // The Transaction whose delete is waiting for confirmation, and whether that delete is being saved.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
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

  // The chosen year stays offered even once its last Transaction is deleted.
  const years = [
    ...new Set([
      currentMonth().year,
      ...(selected ? [selected.year] : []),
      ...monthsWithTransactions.map((m) => m.year),
    ]),
  ].sort((a, b) => b - a)
  const transactions =
    loaded && selected && periodValue(loaded.period) === periodValue(selected) ? loaded.transactions : null
  const isFiltering = categoryFilter !== '' || search.trim() !== ''
  const shownTransactions =
    transactions?.filter((t) => matchesCategory(t, categoryFilter) && matchesSearch(t, search)) ?? null

  function choosePeriod(period: YearOrMonth) {
    setStatusMessage(null)
    setErrorMessage(null)
    setConfirmingDeleteId(null)
    setSelected(period)
  }

  // Changing the filter or search may hide the row whose delete is waiting, so the confirmation
  // closes rather than coming back with the row later.
  function chooseCategoryFilter(value: string) {
    setConfirmingDeleteId(null)
    setCategoryFilter(value)
  }

  function chooseSearch(value: string) {
    setConfirmingDeleteId(null)
    setSearch(value)
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
  // page never keeps a Category that wasn't saved. Once saved, the row shows whether the server
  // now has it Locked.
  async function changeCategory(transaction: Transaction, categoryId: number) {
    setStatusMessage(null)
    setErrorMessage(null)
    setSaving(transaction.id, true)
    showChange(transaction.id, { categoryId })

    const result = await changeTransactionCategory(transaction.id, categoryId).finally(() =>
      setSaving(transaction.id, false),
    )

    if (result.ok) {
      const { categoryId: savedCategoryId, locked } = result.transaction
      showChange(transaction.id, { categoryId: savedCategoryId, locked })
      setStatusMessage('Category changed')
    } else {
      showChange(transaction.id, { categoryId: transaction.categoryId })
      setErrorMessage(result.message)
    }
  }

  function startDelete(transaction: Transaction) {
    setStatusMessage(null)
    setErrorMessage(null)
    setConfirmingDeleteId(transaction.id)
  }

  // Removes the row once deleted, staying on the chosen Period even when that leaves it empty, and
  // reloads the months, which may have lost one.
  async function confirmDelete(transaction: Transaction) {
    if (isDeleting) return

    setIsDeleting(true)
    const result = await deleteTransaction(transaction.id).finally(() => setIsDeleting(false))
    setConfirmingDeleteId(null)

    if (result.ok) {
      setLoaded(
        (current) =>
          current && { ...current, transactions: current.transactions.filter((t) => t.id !== transaction.id) },
      )
      setStatusMessage(result.alreadyDeleted ? 'The transaction was already deleted.' : 'Transaction deleted.')
      fetchTransactionMonths()
        .then(setMonthsWithTransactions)
        .catch(() => {})
    } else {
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
              onChange={(event) => chooseCategoryFilter(event.target.value)}
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
              onChange={(event) => chooseSearch(event.target.value)}
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
              <th className="py-2">
                <span className="sr-only">Delete</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-900">
            {shownTransactions.map((transaction) => (
              <Fragment key={transaction.id}>
                <tr>
                  <td className="py-2 pr-3 whitespace-nowrap">{formatNorwegianDate(transaction.date)}</td>
                  <td className="py-2 pr-3">{transaction.description}</td>
                  <td className="py-2 pr-3">
                    <select
                      aria-label={`Category for ${transaction.description}`}
                      value={transaction.categoryId ?? ''}
                      disabled={savingIds.has(transaction.id) || (isDeleting && confirmingDeleteId === transaction.id)}
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
                    {transaction.locked && (
                      <span
                        role="img"
                        aria-label="Locked"
                        title="Locked: rules won't change this Category"
                        className="ml-1.5 inline-block align-middle text-slate-400"
                      >
                        <svg viewBox="0 0 16 16" fill="currentColor" fillRule="evenodd" aria-hidden="true" className="h-3.5 w-3.5">
                          <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7H4a1.5 1.5 0 0 0-1.5 1.5v5A1.5 1.5 0 0 0 4 15h8a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 12 7h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 6V4.5a2 2 0 1 0-4 0V7h4Z" />
                        </svg>
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap tabular-nums">
                    {formatAmount(transaction.amount)}
                  </td>
                  <td className="py-2 pl-3 text-right">
                    <button
                      type="button"
                      aria-label={`Delete ${transaction.description}`}
                      title={transaction.imported ? "Imported Transactions can't be deleted" : undefined}
                      disabled={transaction.imported || isDeleting}
                      onClick={() => startDelete(transaction)}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor" fillRule="evenodd" aria-hidden="true" className="h-4 w-4">
                        <path d="M6.5 1A1.5 1.5 0 0 0 5 2.5V3H2.75a.75.75 0 0 0 0 1.5h.3l.63 9.06A1.5 1.5 0 0 0 5.18 15h5.64a1.5 1.5 0 0 0 1.5-1.44l.63-9.06h.3a.75.75 0 0 0 0-1.5H11v-.5A1.5 1.5 0 0 0 9.5 1h-3Zm3 2v-.5h-3V3h3ZM6.75 6.5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5a.75.75 0 0 1 .75-.75Zm3.25.75a.75.75 0 0 0-1.5 0v4.5a.75.75 0 0 0 1.5 0v-4.5Z" />
                      </svg>
                    </button>
                  </td>
                </tr>
                {confirmingDeleteId === transaction.id && (
                  <tr>
                    <td colSpan={5} className="pb-3">
                      <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg bg-red-50 px-3 py-2">
                        <span className="mr-auto text-red-800">
                          Delete "{transaction.description}" ({formatAmount(transaction.amount)} on{' '}
                          {formatNorwegianDate(transaction.date)})? This can't be undone.
                        </span>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => confirmDelete(transaction)}
                          className={smallButtonClass}
                        >
                          Confirm delete
                        </button>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => setConfirmingDeleteId(null)}
                          className={smallButtonClass}
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
