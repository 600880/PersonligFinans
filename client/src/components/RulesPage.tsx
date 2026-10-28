import { useEffect, useState } from 'react'
import { fetchCategories, fetchRules, type CategorizationRule, type Category } from '../lib/api'
import { useIsDark } from '../lib/appearance'
import { categoryColour } from '../lib/categoryColours'
import { categoryFilterOf, matchesCategory } from '../lib/categoryFilter'
import { norwegian } from '../lib/norwegian'
import { CategorySwatch } from './CategorySwatch'
import { ErrorMessage, StatusMessage } from './Messages'
import { panelClass, panelHeadClass, toolbarSelectClass } from './panel'
import { RuleDeleteDialog, type RuleDeleted } from './RuleDeleteDialog'
import { RuleDialog, type RuleSaved } from './RuleDialog'
import { SortableHeading, type Sort } from './SortableHeading'
import { ToolbarSearch } from './ToolbarSearch'

function changedMessage(action: string, transactionsChanged: number) {
  const transactions = transactionsChanged === 1 ? 'transaction' : 'transactions'
  return `${action} ${transactionsChanged} ${transactions} changed category.`
}

function byKeyword(a: CategorizationRule, b: CategorizationRule) {
  return norwegian(a.keyword, b.keyword)
}

// The columns the table can be sorted by.
type SortColumn = 'keyword' | 'category'

// Sorts by the column, and rules that tie on it by keyword A–Å whichever way the column goes.
function sortedRules(rules: CategorizationRule[], sort: Sort<SortColumn>, categoryName: (id: number) => string) {
  const byColumn = {
    keyword: byKeyword,
    category: (a: CategorizationRule, b: CategorizationRule) =>
      norwegian(categoryName(a.categoryId), categoryName(b.categoryId)),
  }[sort.column]
  const direction = sort.direction === 'ascending' ? 1 : -1
  return [...rules].sort((a, b) => direction * byColumn(a, b) || byKeyword(a, b))
}

// Whether the keyword contains the search text, ignoring case and the text's surrounding spaces, the
// same as the search on Transactions. Æ, Ø and Å are letters of their own, so "o" never matches "ø".
function matchesSearch(rule: CategorizationRule, search: string) {
  return rule.keyword.toLowerCase().includes(search.trim().toLowerCase())
}

// The rule dialog that is open: for adding a rule, or editing one.
type OpenRuleDialog = { kind: 'add' } | { kind: 'edit'; rule: CategorizationRule }

// On a phone each rule's row is laid out as a card inside the panel instead, ruled off from the next as
// the Categories' rows are, and its cells stack inside it.
const rowClass = 'max-sm:flex max-sm:flex-col max-sm:gap-2 max-sm:px-4 max-sm:py-3'
const keywordCellClass = 'py-3 pr-3 pl-4 font-medium break-words max-sm:block max-sm:p-0'
const categoryCellClass = 'py-3 pr-3 text-slate-700 dark:text-slate-300 max-sm:block max-sm:p-0'
// The actions last in a card, at its right as they are in the table.
const actionsCellClass =
  'py-2 pr-4 pl-3 text-right whitespace-nowrap max-sm:flex max-sm:justify-end max-sm:gap-1 max-sm:p-0'
const badgeClass = 'ml-1 inline-flex items-center rounded-md px-1.5 py-0.5 align-middle text-xs font-medium ring-1 ring-inset'
const smallButtonClass =
  'rounded-lg px-2 py-1 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-300 dark:disabled:text-slate-600'

// A rule's Category: a swatch, in the colour the Dashboard draws it in, and its name.
function RuleCategory({ name, colour }: { name: string; colour: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <CategorySwatch colour={colour} name={name} />
      {name}
    </span>
  )
}

// Where the Rules page opens when reached from a Category's rule count: filtered to that Category.
export interface RulesTarget {
  categoryId: number
}

// Opens on all rules, or on the target's Category when given. The target is read on mount only, so the
// filter then changes like any other.
export function RulesPage({ target }: { target?: RulesTarget }) {
  const [categories, setCategories] = useState<Category[]>([])
  const [rules, setRules] = useState<CategorizationRule[]>([])
  // '' for all Categories, or a Category's id, as the Category filter on Transactions.
  const [categoryFilter, setCategoryFilter] = useState(() => (target ? categoryFilterOf(target.categoryId) : ''))
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [dialog, setDialog] = useState<OpenRuleDialog | null>(null)
  // The rule whose delete is being confirmed, or null while none is.
  const [deleting, setDeleting] = useState<CategorizationRule | null>(null)
  const [newOnly, setNewOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort<SortColumn>>({ column: 'keyword', direction: 'ascending' })

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
  const newOnlyDisabledReason = hasNewRules ? undefined : 'The last upload added no rules'
  // "Show only new" does nothing while it is disabled, so once no rule is New it is off, even if it was
  // ticked before.
  const isNewOnly = newOnly && hasNewRules
  const isFiltering = search.trim() !== '' || categoryFilter !== '' || isNewOnly
  // Sorted as shown rather than as kept, so a rule added or edited lands where the sort puts it.
  const shownRules = sortedRules(
    rules.filter((r) => (!isNewOnly || r.isNew) && matchesSearch(r, search) && matchesCategory(r, categoryFilter)),
    sort,
    categoryName,
  )

  // A dialog starts a new action, so the messages about earlier ones go. The dialog shows its own
  // errors.
  function openDialog(opened: OpenRuleDialog) {
    setStatusMessage(null)
    setErrorMessage(null)
    setDialog(opened)
  }

  // A save that finishes after its dialog was cancelled still happened, so it is listed and told,
  // but leaves alone any dialog opened since.
  function handleSaved(dialog: OpenRuleDialog, { rule, transactionsChanged }: RuleSaved) {
    setRules((rules) => (dialog.kind === 'add' ? [...rules, rule] : rules.map((r) => (r.id === rule.id ? rule : r))))
    setDialog((open) => (open === dialog ? null : open))
    setStatusMessage(changedMessage(dialog.kind === 'add' ? 'Rule added.' : 'Rule updated.', transactionsChanged))
  }

  // A column already sorted by turns the other way; another starts A–Å.
  function chooseSort(column: SortColumn) {
    setSort((current) =>
      current.column === column
        ? { column, direction: current.direction === 'ascending' ? 'descending' : 'ascending' }
        : { column, direction: 'ascending' },
    )
  }

  // Every delete is asked first, whatever the rule matches, and done by the confirmation. This says
  // what it did.
  function handleConfirmedDelete(rule: CategorizationRule, { alreadyDeleted, transactionsChanged }: RuleDeleted) {
    setDeleting(null)
    setErrorMessage(null)
    setRules((rules) => rules.filter((r) => r.id !== rule.id))
    setStatusMessage(
      alreadyDeleted ? 'The rule was already deleted.' : changedMessage('Rule deleted.', transactionsChanged),
    )
  }

  return (
    <section className="w-full max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Categorization Rules</h2>
        <button
          type="button"
          onClick={() => openDialog({ kind: 'add' })}
          className="rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-sm font-medium text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-300"
        >
          Add rule
        </button>
      </div>

      {errorMessage ? (
        <ErrorMessage className="mt-3">{errorMessage}</ErrorMessage>
      ) : (
        <StatusMessage message={statusMessage} className="mt-3" />
      )}

      {/* A toolbar for the table below. On a phone the search takes its own line, with the Category
          filter and "Show only new" under it. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <ToolbarSearch placeholder="Search keywords" value={search} onChange={setSearch} />
        <select
          aria-label="Filter by category"
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
          className={toolbarSelectClass}
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {/* Why it is disabled is on the label, so hovering the words says it too, and on the checkbox,
            so a screen reader says it. */}
        <label
          title={newOnlyDisabledReason}
          className={`ml-auto flex shrink-0 items-center gap-2 text-sm font-medium ${
            hasNewRules ? 'text-slate-700 dark:text-slate-300' : 'cursor-not-allowed text-slate-400 dark:text-slate-600'
          }`}
        >
          <input
            type="checkbox"
            checked={isNewOnly}
            disabled={!hasNewRules}
            title={newOnlyDisabledReason}
            onChange={(event) => setNewOnly(event.target.checked)}
            className="size-4 rounded border-slate-300 dark:border-slate-700 disabled:cursor-not-allowed"
          />
          Show only new
        </label>
      </div>

      {isFiltering && shownRules.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">No rules match</p>
      ) : (
        <div className={`mt-3 ${panelClass}`}>
          {/* On a phone each rule is a card instead, keyword and badges, then its Category, then its
              actions, so nothing scrolls sideways or drops off the edge of the screen. */}
          <table className="w-full text-left text-sm max-sm:block">
            <thead className={panelHeadClass}>
              <tr>
                <SortableHeading column="keyword" sort={sort} onSort={chooseSort} className="py-2.5 pr-3 pl-4">
                  Keyword
                </SortableHeading>
                <SortableHeading column="category" sort={sort} onSort={chooseSort} className="py-2.5 pr-3">
                  Category
                </SortableHeading>
                <th className="py-2.5 pr-4 pl-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-900 dark:text-slate-100 max-sm:block">
              {shownRules.map((rule) => (
                <tr key={rule.id} className={rowClass}>
                  <td className={keywordCellClass}>
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
                  <td className={categoryCellClass}>
                    <RuleCategory
                      name={categoryName(rule.categoryId)}
                      colour={categoryColour(rule.categoryId, categories, dark)}
                    />
                  </td>
                  <td className={actionsCellClass}>
                    <button type="button" onClick={() => openDialog({ kind: 'edit', rule })} className={smallButtonClass}>
                      Edit
                    </button>
                    <button type="button" onClick={() => setDeleting(rule)} className={smallButtonClass}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* The add dialog starts on the Category the list is filtered to as it opens, or on none while all
          are shown. */}
      {dialog && (
        <RuleDialog
          rule={dialog.kind === 'edit' ? dialog.rule : undefined}
          startingCategoryId={categoryFilter}
          categories={categories}
          onCancel={() => setDialog(null)}
          onSaved={(saved) => handleSaved(dialog, saved)}
        />
      )}

      {deleting && (
        <RuleDeleteDialog
          rule={deleting}
          categories={categories}
          onCancel={() => setDeleting(null)}
          onDeleted={(deleted) => handleConfirmedDelete(deleting, deleted)}
        />
      )}
    </section>
  )
}
