import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  addRule,
  deleteRule,
  editRule,
  fetchCategories,
  fetchRules,
  type CategorizationRule,
  type Category,
  type RuleFieldErrors,
} from '../lib/api'
import { useIsDark } from '../lib/appearance'
import { categoryColour } from '../lib/categoryColours'
import { CategorySwatch } from './CategorySwatch'
import { Count } from './Count'
import { ErrorMessage, StatusMessage } from './Messages'

function changedMessage(action: string, transactionsChanged: number) {
  const transactions = transactionsChanged === 1 ? 'transaction' : 'transactions'
  return `${action} ${transactionsChanged} ${transactions} changed category.`
}

// In the Norwegian alphabet, so Æ, Ø and Å come after Z whatever the browser's language.
function norwegian(a: string, b: string) {
  return a.localeCompare(b, 'nb', { sensitivity: 'accent' })
}

function byKeyword(a: CategorizationRule, b: CategorizationRule) {
  return norwegian(a.keyword, b.keyword)
}

// The column the table is sorted by, and which way, named as aria-sort names it.
type SortColumn = 'keyword' | 'category' | 'transactionCount'
interface RuleSort {
  column: SortColumn
  direction: 'ascending' | 'descending'
}

// Sorts by the column, and rules that tie on it by keyword A–Å whichever way the column goes.
function sortedRules(rules: CategorizationRule[], sort: RuleSort, categoryName: (id: number) => string) {
  const byColumn = {
    keyword: byKeyword,
    category: (a: CategorizationRule, b: CategorizationRule) =>
      norwegian(categoryName(a.categoryId), categoryName(b.categoryId)),
    transactionCount: (a: CategorizationRule, b: CategorizationRule) => a.transactionCount - b.transactionCount,
  }[sort.column]
  const direction = sort.direction === 'ascending' ? 1 : -1
  return [...rules].sort((a, b) => direction * byColumn(a, b) || byKeyword(a, b))
}

// Whether the keyword contains the search text, ignoring case and the text's surrounding spaces, the
// same as the search on Transactions. Æ, Ø and Å are letters of their own, so "o" never matches "ø".
function matchesSearch(rule: CategorizationRule, search: string) {
  return rule.keyword.toLowerCase().includes(search.trim().toLowerCase())
}

// The rule being edited inline, with the input as typed so far.
interface RuleEdit {
  id: number
  keyword: string
  categoryId: string
  fieldErrors: RuleFieldErrors
}

const inputClass = 'rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 font-normal'
// On a phone, each rule's row is laid out as a card, and its cells stack inside it.
const cardClass =
  'max-sm:flex max-sm:flex-col max-sm:gap-2 max-sm:rounded-lg max-sm:border max-sm:border-slate-200 max-sm:dark:border-slate-800 max-sm:bg-white max-sm:dark:bg-slate-900 max-sm:p-3'
// The actions last in a card, under a line that keeps them apart from what they act on.
const actionsCellClass =
  'py-2 text-right whitespace-nowrap max-sm:-mx-1 max-sm:flex max-sm:justify-end max-sm:gap-1 max-sm:border-t max-sm:border-slate-100 max-sm:dark:border-slate-800/60 max-sm:pt-2 max-sm:pb-0'
const countCellClass = 'py-2.5 pl-3 text-right whitespace-nowrap tabular-nums max-sm:block max-sm:p-0 max-sm:text-left'
const badgeClass = 'ml-1 inline-flex items-center rounded-md px-1.5 py-0.5 align-middle text-xs font-medium ring-1 ring-inset'
const smallButtonClass =
  'rounded-lg px-2 py-1 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-300 dark:disabled:text-slate-600'

// A column heading that sorts the table by its column, A–Å or lowest first, and then the other way
// each time it is clicked again. The arrow shows which way; aria-sort says it.
function SortableHeading({
  column,
  sort,
  onSort,
  className,
  children,
}: {
  column: SortColumn
  sort: RuleSort
  onSort: (column: SortColumn) => void
  className: string
  children: string
}) {
  const direction = sort.column === column ? sort.direction : null
  return (
    <th aria-sort={direction ?? 'none'} className={className}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1 rounded font-medium hover:text-slate-900 dark:hover:text-slate-100 ${direction ? 'text-slate-900 dark:text-slate-100' : ''}`}
      >
        {children}
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
          className={`h-4 w-4 ${direction ? '' : 'text-slate-300 dark:text-slate-600'}`}
        >
          {direction === 'ascending' ? (
            <path d="M4.22 9.78a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1-1.06 1.06L8 7.06 5.28 9.78a.75.75 0 0 1-1.06 0Z" />
          ) : direction === 'descending' ? (
            <path d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" />
          ) : (
            <path d="M5.22 10.22a.75.75 0 0 1 1.06 0L8 11.94l1.72-1.72a.75.75 0 1 1 1.06 1.06l-2.25 2.25a.75.75 0 0 1-1.06 0l-2.25-2.25a.75.75 0 0 1 0-1.06ZM10.78 5.78a.75.75 0 0 1-1.06 0L8 4.06 6.28 5.78a.75.75 0 0 1-1.06-1.06l2.25-2.25a.75.75 0 0 1 1.06 0l2.25 2.25a.75.75 0 0 1 0 1.06Z" />
          )}
        </svg>
      </button>
    </th>
  )
}

// A rule's Category: a swatch, in the colour the Dashboard draws it in, and its name.
function RuleCategory({ name, colour }: { name: string; colour: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <CategorySwatch colour={colour} name={name} />
      {name}
    </span>
  )
}

export function RulesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [rules, setRules] = useState<CategorizationRule[]>([])
  const [keyword, setKeyword] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<RuleFieldErrors>({})
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [edit, setEdit] = useState<RuleEdit | null>(null)
  const [newOnly, setNewOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<RuleSort>({ column: 'keyword', direction: 'ascending' })
  // Which recount is the latest, so an earlier one that answers late is ignored.
  const recount = useRef(0)

  useEffect(() => {
    let ignore = false
    Promise.all([fetchCategories(), fetchRules()])
      .then(([loadedCategories, loadedRules]) => {
        if (ignore) return
        setCategories(loadedCategories)
        setRules(loadedRules)
      })
      .catch(() => {
        if (!ignore) setErrorMessage('Could not load the rules.')
      })
    return () => {
      ignore = true
    }
  }, [])

  const dark = useIsDark()
  const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? ''
  const hasNewRules = rules.some((r) => r.isNew)
  // Sorted as shown rather than as kept, so a rule added or edited lands where the sort puts it.
  const shownRules = sortedRules(
    rules.filter((r) => (!newOnly || !hasNewRules || r.isNew) && matchesSearch(r, search)),
    sort,
    categoryName,
  )

  // Adding, editing or deleting a rule can move Transactions between the other rules too, as when a
  // longer keyword takes them from a shorter one, so every rule is counted again. Only the counts are
  // taken, so a rule added or deleted since is neither lost nor brought back. If counting fails, the
  // counts shown stay as they were.
  async function countRulesAgain() {
    const current = ++recount.current
    const counted = await fetchRules().catch(() => null)
    if (!counted || current !== recount.current) return
    const counts = new Map(counted.map((r) => [r.id, r.transactionCount]))
    setRules((rules) => rules.map((r) => ({ ...r, transactionCount: counts.get(r.id) ?? r.transactionCount })))
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault()
    if (isSaving) return

    setIsSaving(true)
    setFieldErrors({})
    setStatusMessage(null)
    setErrorMessage(null)

    const result = await addRule({
      keyword: keyword.trim(),
      categoryId: categoryId === '' ? null : Number(categoryId),
    }).finally(() => setIsSaving(false))

    if (result.ok) {
      setRules((current) => [...current, result.rule])
      setKeyword('')
      setCategoryId('')
      setStatusMessage(changedMessage('Rule added.', result.transactionsChanged))
      countRulesAgain()
    } else {
      setFieldErrors(result.fieldErrors)
      setErrorMessage(result.message)
    }
  }

  function startEdit(rule: CategorizationRule) {
    setEdit({ id: rule.id, keyword: rule.keyword, categoryId: String(rule.categoryId), fieldErrors: {} })
  }

  function cancelEdit() {
    setEdit(null)
    setErrorMessage(null)
  }

  // Changing the search may hide the rule being edited, so any open edit is cancelled, as on Transactions.
  // With no edit open, an error from an earlier add or delete stays.
  function chooseSearch(value: string) {
    if (edit) cancelEdit()
    setSearch(value)
  }

  // A column already sorted by turns the other way; another starts A–Å or lowest first. The rule being
  // edited may move out of sight, so any open edit is cancelled, as when the search changes.
  function chooseSort(column: SortColumn) {
    if (edit) cancelEdit()
    setSort((current) =>
      current.column === column
        ? { column, direction: current.direction === 'ascending' ? 'descending' : 'ascending' }
        : { column, direction: 'ascending' },
    )
  }

  async function handleSave(current: RuleEdit) {
    if (isSaving) return

    setIsSaving(true)
    setEdit({ ...current, fieldErrors: {} })
    setStatusMessage(null)
    setErrorMessage(null)

    const result = await editRule(current.id, {
      keyword: current.keyword.trim(),
      categoryId: current.categoryId === '' ? null : Number(current.categoryId),
    }).finally(() => setIsSaving(false))

    if (result.ok) {
      setRules((rules) => rules.map((r) => (r.id === result.rule.id ? result.rule : r)))
      setEdit(null)
      setStatusMessage(changedMessage('Rule updated.', result.transactionsChanged))
      countRulesAgain()
    } else {
      setEdit({ ...current, fieldErrors: result.fieldErrors })
      setErrorMessage(result.message)
    }
  }

  async function handleDelete(rule: CategorizationRule) {
    if (isSaving) return

    setIsSaving(true)
    setStatusMessage(null)
    setErrorMessage(null)

    const result = await deleteRule(rule.id).finally(() => setIsSaving(false))

    if (result.ok) {
      setRules((rules) => rules.filter((r) => r.id !== rule.id))
      setStatusMessage(
        result.alreadyDeleted
          ? 'The rule was already deleted.'
          : changedMessage('Rule deleted.', result.transactionsChanged),
      )
      if (!result.alreadyDeleted) countRulesAgain()
    } else {
      setErrorMessage(result.message)
    }
  }

  return (
    <section className="w-full max-w-3xl">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Categorization Rules</h2>

      <form className="mt-4 flex items-start gap-3 max-sm:flex-col max-sm:items-stretch" onSubmit={handleAdd}>
        <div className="flex flex-1 flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
            Keyword
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              aria-describedby="rule-keyword-error"
              className={inputClass}
            />
          </label>
          <span id="rule-keyword-error" className="text-xs text-red-600 dark:text-red-300">
            {fieldErrors.keyword}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
            Category
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              aria-describedby="rule-category-error"
              className={inputClass}
            >
              <option value="">Choose…</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <span id="rule-category-error" className="text-xs text-red-600 dark:text-red-300">
            {fieldErrors.categoryId}
          </span>
        </div>
        <button
          type="submit"
          disabled={isSaving}
          className="mt-6 rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-sm font-medium text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-300 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 max-sm:mt-0 max-sm:self-start"
        >
          Add rule
        </button>
      </form>

      {errorMessage ? (
        <ErrorMessage className="mt-3">{errorMessage}</ErrorMessage>
      ) : (
        <StatusMessage message={statusMessage} className="mt-3" />
      )}

      {/* A toolbar for the table below, smaller than the add form so the two never read as one form. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
          >
            <path d="M10.68 11.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06ZM11.5 7a4.5 4.5 0 1 0-9 0 4.5 4.5 0 0 0 9 0Z" />
          </svg>
          <input
            type="search"
            aria-label="Search"
            placeholder="Search keywords"
            value={search}
            onChange={(event) => chooseSearch(event.target.value)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 py-1.5 pr-3 pl-8 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
        </div>
        <label
          title={hasNewRules ? undefined : 'The last upload added no rules'}
          className={`ml-auto inline-flex shrink-0 items-center gap-2 text-sm ${hasNewRules ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 dark:text-slate-600'}`}
        >
          <input
            type="checkbox"
            checked={newOnly && hasNewRules}
            disabled={!hasNewRules}
            onChange={(event) => setNewOnly(event.target.checked)}
          />
          Show only new
        </label>
      </div>

      {search.trim() !== '' && shownRules.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">No rules match</p>
      ) : (
        /* On a phone each rule is a card of its own, keyword and badges, then its Category, then its
           actions, so nothing scrolls sideways or drops off the edge of the screen. */
        <table className="mt-3 w-full text-left text-sm max-sm:block">
          <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 max-sm:hidden">
            <tr>
              <SortableHeading column="keyword" sort={sort} onSort={chooseSort} className="py-2 pr-3">
                Keyword
              </SortableHeading>
              <SortableHeading column="category" sort={sort} onSort={chooseSort} className="py-2 pr-3">
                Category
              </SortableHeading>
              <SortableHeading column="transactionCount" sort={sort} onSort={chooseSort} className="py-2 pl-3 text-right">
                Transactions
              </SortableHeading>
              <th className="py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-900 dark:text-slate-100 max-sm:block max-sm:space-y-2 max-sm:divide-y-0">
            {shownRules.map((rule) =>
              edit?.id === rule.id ? (
                <tr key={rule.id} className={`align-top ${cardClass}`}>
                  <td className="py-2 pr-3 max-sm:block max-sm:p-0">
                    <div className="flex flex-col gap-1">
                      <input
                        aria-label="Keyword"
                        value={edit.keyword}
                        onChange={(event) => setEdit({ ...edit, keyword: event.target.value })}
                        aria-describedby={`rule-${rule.id}-keyword-error`}
                        className={`${inputClass} w-full min-w-0`}
                      />
                      <span id={`rule-${rule.id}-keyword-error`} className="text-xs text-red-600 dark:text-red-300">
                        {edit.fieldErrors.keyword}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 pr-3 max-sm:block max-sm:p-0">
                    <div className="flex flex-col gap-1">
                      <select
                        aria-label="Category"
                        value={edit.categoryId}
                        onChange={(event) => setEdit({ ...edit, categoryId: event.target.value })}
                        aria-describedby={`rule-${rule.id}-category-error`}
                        className={`${inputClass} w-full min-w-0`}
                      >
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                      <span id={`rule-${rule.id}-category-error`} className="text-xs text-red-600 dark:text-red-300">
                        {edit.fieldErrors.categoryId}
                      </span>
                    </div>
                  </td>
                  <td className={`${countCellClass} sm:pt-4`}>
                    <Count count={rule.transactionCount} noun="transaction" />
                  </td>
                  <td className={actionsCellClass}>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => handleSave(edit)}
                      className={smallButtonClass}
                    >
                      Save
                    </button>
                    <button type="button" onClick={cancelEdit} className={smallButtonClass}>
                      Cancel
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={rule.id} className={cardClass}>
                  <td className="py-2.5 pr-3 font-medium break-words max-sm:block max-sm:p-0">
                    {rule.keyword}
                    {rule.aiGenerated && (
                      <>
                        {' '}
                        <span
                          title="AI-generated rule"
                          className={`${badgeClass} bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 ring-violet-600/20 dark:ring-violet-400/30`}
                        >
                          AI
                        </span>
                      </>
                    )}
                    {rule.isNew && (
                      <>
                        {' '}
                        <span
                          title="Added by the last upload"
                          className={`${badgeClass} bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-600/20 dark:ring-emerald-400/30`}
                        >
                          New
                        </span>
                      </>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-slate-700 dark:text-slate-300 max-sm:block max-sm:p-0">
                    <RuleCategory
                      name={categoryName(rule.categoryId)}
                      colour={categoryColour(rule.categoryId, categories, dark)}
                    />
                  </td>
                  <td className={countCellClass}>
                    <Count count={rule.transactionCount} noun="transaction" />
                  </td>
                  <td className={actionsCellClass}>
                    <button type="button" onClick={() => startEdit(rule)} className={smallButtonClass}>
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => handleDelete(rule)}
                      className={smallButtonClass}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
    </section>
  )
}
