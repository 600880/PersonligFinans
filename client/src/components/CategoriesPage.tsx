import { useEffect, useState } from 'react'
import { fetchCategories, fetchPalette, type Category } from '../lib/api'
import { useIsDark } from '../lib/appearance'
import { categoryColour } from '../lib/categoryColours'
import { formatCount } from '../lib/count'
import { CategoryDeleteDialog, type CategoryDeleted } from './CategoryDeleteDialog'
import { CategoryDialog } from './CategoryDialog'
import { CategorySwatch } from './CategorySwatch'
import type { Palette } from './ColourPicker'
import { Count } from './Count'
import { ErrorMessage, StatusMessage } from './Messages'
import type { TransactionsTarget } from './TransactionsPage'

// The API's order: the Built-in Categories first, kept in the order they were served (they can't
// be renamed or added), then the rest by name in the Norwegian alphabet, ignoring case.
function inListOrder(categories: Category[]) {
  return [
    ...categories.filter((c) => c.builtIn),
    ...categories
      .filter((c) => !c.builtIn)
      .sort((a, b) => a.name.localeCompare(b.name, 'nb', { sensitivity: 'accent' })),
  ]
}

// The Category dialog that is open: for adding a Category, editing one, or deleting one.
type OpenDialog = { kind: 'add' } | { kind: 'edit'; category: Category } | { kind: 'delete'; category: Category }

const smallButtonClass =
  'rounded-lg px-2 py-1 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-300 dark:disabled:text-slate-600'

// On a phone each row is laid out as a card instead: the name and badge, then the description, then
// the counts with the actions beside them. The row wraps, so on a narrow screen with large counts
// the actions move under the counts rather than pushing the card wider than the screen.
const rowClass =
  'align-top max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-4 max-sm:gap-y-1.5 max-sm:px-4 max-sm:py-3'
const nameCellClass = 'py-3 pr-3 pl-4 max-sm:basis-full max-sm:min-w-0 max-sm:p-0'
const descriptionCellClass = 'py-3 pr-3 max-sm:basis-full max-sm:min-w-0 max-sm:p-0 max-sm:wrap-anywhere'
const transactionCountCellClass = 'py-3 pl-3 text-right whitespace-nowrap tabular-nums max-sm:p-0 max-sm:text-left'
const ruleCountCellClass = 'py-3 pl-3 text-right whitespace-nowrap tabular-nums max-sm:p-0 max-sm:text-left'
const actionsCellClass = 'py-2 pr-4 pl-3 text-right whitespace-nowrap max-sm:ml-auto max-sm:p-0'

function BuiltInBadge() {
  return (
    <>
      {' '}
      <span
        title="Built-in Category: can't be renamed or deleted"
        className="shrink-0 rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-400"
      >
        Built-in
      </span>
    </>
  )
}

// The swatch, in the colour the Dashboard draws the Category in, name and Built-in badge that start
// a Category's row. The spaces keep them apart when read out.
function CategoryLabel({ category, colour }: { category: Category; colour: string }) {
  return (
    <span className="flex items-center gap-2">
      <CategorySwatch colour={colour} name={category.name} />{' '}
      <span className="font-medium sm:whitespace-nowrap max-sm:min-w-0 max-sm:wrap-anywhere">{category.name}</span>
      {category.builtIn && <BuiltInBadge />}
    </span>
  )
}

function changedMessage(action: string, transactionsChanged: number) {
  const transactions = transactionsChanged === 1 ? 'transaction' : 'transactions'
  return `${action} ${transactionsChanged} ${transactions} changed category.`
}

// Every Category in the order the API lists them, Built-in ones first, with what uses it, and a button
// that adds one in a dialog. Each can be edited in the same dialog, and one that isn't Built-in can be
// deleted in a dialog of its own, which asks first; a Built-in one shows Delete disabled.
// A nonzero Transactions count opens the Transactions page on that Category's latest year.
export function CategoriesPage({ onOpenTransactions }: { onOpenTransactions: (target: TransactionsTarget) => void }) {
  const dark = useIsDark()
  const [categories, setCategories] = useState<Category[]>([])
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  const [palette, setPalette] = useState<Palette>('loading')

  useEffect(() => {
    let ignore = false
    fetchCategories()
      .then((loaded) => {
        if (!ignore) setCategories(loaded)
      })
      .catch(() => {
        if (!ignore) setErrorMessage('Could not load the categories.')
      })
    // For the Category dialog's colour picker, which says so itself if it fails.
    fetchPalette()
      .then((loaded) => {
        if (!ignore) setPalette(loaded)
      })
      .catch(() => {
        if (!ignore) setPalette('failed')
      })
    return () => {
      ignore = true
    }
  }, [])

  // A dialog starts a new action, so the messages about earlier ones go. The dialog shows its own
  // errors.
  function openDialog(opened: OpenDialog) {
    setStatusMessage(null)
    setErrorMessage(null)
    setDialog(opened)
  }

  // A save that finishes after its dialog was cancelled still happened, so it is listed and told,
  // but leaves alone any dialog opened since.
  function handleSaved(saved: OpenDialog, category: Category) {
    setCategories((current) =>
      inListOrder(
        saved.kind === 'add' ? [...current, category] : current.map((c) => (c.id === category.id ? category : c)),
      ),
    )
    setDialog((open) => (open === saved ? null : open))
    setStatusMessage(saved.kind === 'add' ? 'Category added.' : 'Category updated.')
  }

  // Like a save, a delete that finishes after its dialog was cancelled still happened, so it is
  // taken off the list and told, but leaves alone any dialog opened since.
  function handleDeleted(deleting: Extract<OpenDialog, { kind: 'delete' }>, deleted: CategoryDeleted) {
    const { category } = deleting
    const { choice, alreadyDeleted, transactionsChanged } = deleted
    const replacement = choice.kind === 'moveToReplacement' ? choice.replacementCategoryId : null
    // The replacement now has everything that used the deleted Category.
    setCategories((categories) =>
      categories
        .filter((c) => c.id !== category.id)
        .map((c) =>
          c.id === replacement && !alreadyDeleted
            ? {
                ...c,
                transactionCount: c.transactionCount + category.transactionCount,
                ruleCount: c.ruleCount + category.ruleCount,
              }
            : c,
        ),
    )
    setDialog((open) => (open === deleting ? null : open))
    setStatusMessage(
      alreadyDeleted ? 'The category was already deleted.' : changedMessage('Category deleted.', transactionsChanged),
    )
    // The remaining rules may have given its Transactions to other Categories, so the counts are
    // reloaded. Until then, or if that fails, the list just lacks the deleted Category.
    if (choice.kind === 'deleteRules' && !alreadyDeleted) {
      fetchCategories()
        .then(setCategories)
        .catch(() => {})
    }
  }

  return (
    <section className="w-full max-w-2xl">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Categories</h2>
        <button
          type="button"
          onClick={() => openDialog({ kind: 'add' })}
          className="rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-sm font-medium text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-300"
        >
          Add category
        </button>
      </div>

      {errorMessage ? (
        <ErrorMessage className="mt-3">{errorMessage}</ErrorMessage>
      ) : (
        <StatusMessage message={statusMessage} className="mt-3" />
      )}

      {dialog?.kind === 'delete' ? (
        <CategoryDeleteDialog
          category={dialog.category}
          categories={categories}
          onCancel={() => setDialog(null)}
          onDeleted={(deleted) => handleDeleted(dialog, deleted)}
        />
      ) : (
        dialog && (
          <CategoryDialog
            category={dialog.kind === 'edit' ? dialog.category : undefined}
            categories={categories}
            palette={palette}
            onCancel={() => setDialog(null)}
            onSaved={(category) => handleSaved(dialog, category)}
          />
        )
      )}

      {categories.length > 0 && (
        <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
          {/* On a phone each row is a card instead, its column headers hidden, so the list never runs
              wider than the screen. */}
          <table className="w-full text-left text-sm max-sm:block">
            <thead className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 max-sm:hidden">
              <tr>
                <th className="py-2.5 pr-3 pl-4 font-medium">Name</th>
                <th className="py-2.5 pr-3 font-medium">Description</th>
                <th className="py-2.5 pl-3 text-right font-medium">Transactions</th>
                <th className="py-2.5 pl-3 text-right font-medium">Rules</th>
                <th className="py-2.5 pr-4 pl-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-900 dark:text-slate-100 max-sm:block">
              {categories.map((category) => (
                <tr key={category.id} className={rowClass}>
                  <td className={nameCellClass}>
                    <CategoryLabel category={category} colour={categoryColour(category.id, categories, dark)} />
                  </td>
                  <td className={`${descriptionCellClass} text-slate-600 dark:text-slate-400`}>{category.description}</td>
                  <td className={transactionCountCellClass}>
                    {/* A zero count stays plain text, so it never opens an empty page. */}
                    {category.transactionCount > 0 ? (
                      <button
                        type="button"
                        aria-label={`Show transactions in ${category.name} (${formatCount(category.transactionCount)})`}
                        onClick={() =>
                          onOpenTransactions({ period: 'latestYearWithTransactions', categoryId: category.id })
                        }
                        className="font-medium underline decoration-slate-300 dark:decoration-slate-600 underline-offset-2 hover:decoration-current"
                      >
                        <Count count={category.transactionCount} noun="transaction" />
                      </button>
                    ) : (
                      <Count count={category.transactionCount} noun="transaction" />
                    )}
                  </td>
                  <td className={ruleCountCellClass}>
                    <Count count={category.ruleCount} noun="rule" />
                  </td>
                  <td className={actionsCellClass}>
                    <button
                      type="button"
                      onClick={() => openDialog({ kind: 'edit', category })}
                      className={smallButtonClass}
                    >
                      Edit
                    </button>
                    {/* A Built-in Category's Delete is shown disabled, so every row offers the same actions. */}
                    <button
                      type="button"
                      title={category.builtIn ? "Built-in Categories can't be deleted" : undefined}
                      disabled={category.builtIn}
                      onClick={() => openDialog({ kind: 'delete', category })}
                      className={smallButtonClass}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
