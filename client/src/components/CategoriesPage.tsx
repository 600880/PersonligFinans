import { useEffect, useState, type FormEvent } from 'react'
import {
  addCategory,
  deleteCategory,
  editCategory,
  fetchCategories,
  type Category,
  type CategoryFieldErrors,
  type DeleteCategoryChoice,
} from '../lib/api'
import { useIsDark } from '../lib/appearance'
import { categoryColour } from '../lib/categoryColours'
import { formatCount, plural } from '../lib/count'
import { CategorySwatch } from './CategorySwatch'
import { ErrorMessage, StatusMessage } from './Messages'

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

// The Category being edited inline, with the input as typed so far.
interface CategoryEdit {
  id: number
  name: string
  description: string
  fieldErrors: CategoryFieldErrors
}

const inputClass = 'rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 font-normal'
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
// A delete waiting for its choice takes a line of its own under the counts on a phone.
const confirmingActionsCellClass =
  'py-2 pr-4 pl-3 text-right whitespace-nowrap max-sm:basis-full max-sm:p-0 max-sm:pt-1 max-sm:text-left max-sm:whitespace-normal'

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

// A count with what it counts beside it. The noun is shown on a phone, where the column headers are
// hidden, and read out everywhere.
function Count({ count, noun }: { count: number; noun: string }) {
  return (
    <>
      {formatCount(count)}{' '}
      <span className="text-slate-500 dark:text-slate-400 sm:sr-only">{plural(count, noun)}</span>
    </>
  )
}

function changedMessage(action: string, transactionsChanged: number) {
  const transactions = transactionsChanged === 1 ? 'transaction' : 'transactions'
  return `${action} ${transactionsChanged} ${transactions} changed category.`
}

function isInUse(category: Category) {
  return category.transactionCount > 0 || category.ruleCount > 0
}

// Every Category in the order the API lists them, Built-in ones first, with what uses it, and a form to
// add one. Each can be edited inline, and one that isn't Built-in can be deleted after a confirmation;
// a Built-in one shows Delete disabled.
// Deleting one in use asks for a choice: a replacement Category, which its Transactions and rules
// move to, or to delete its rules, leaving its Transactions to the remaining rules, or Uncategorized.
export function CategoriesPage() {
  const dark = useIsDark()
  const [categories, setCategories] = useState<Category[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<CategoryFieldErrors>({})
  // The id of the Category whose delete is waiting for confirmation.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null)
  // How a Category in use is to be deleted, as the radios show it; null until chosen. Moving needs a
  // replacement too, so the choice is only complete once one is.
  const [deleteMode, setDeleteMode] = useState<'moveToReplacement' | 'deleteRules' | null>(null)
  // The replacement chosen for a Category in use, as the select's value; '' until one is chosen.
  const [replacementId, setReplacementId] = useState('')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [edit, setEdit] = useState<CategoryEdit | null>(null)

  useEffect(() => {
    let ignore = false
    fetchCategories()
      .then((loaded) => {
        if (!ignore) setCategories(loaded)
      })
      .catch(() => {
        if (!ignore) setErrorMessage('Could not load the categories.')
      })
    return () => {
      ignore = true
    }
  }, [])

  function startEdit(category: Category) {
    setConfirmingDeleteId(null)
    setEdit({ id: category.id, name: category.name, description: category.description, fieldErrors: {} })
  }

  function cancelEdit() {
    setEdit(null)
    setErrorMessage(null)
  }

  // A Built-in Category's name can't be edited, so it is sent unchanged.
  async function handleSave(current: CategoryEdit) {
    if (isSaving) return

    setIsSaving(true)
    setEdit({ ...current, fieldErrors: {} })
    setFieldErrors({})
    setStatusMessage(null)
    setErrorMessage(null)

    const result = await editCategory(current.id, {
      name: current.name.trim(),
      description: current.description.trim(),
    }).finally(() => setIsSaving(false))

    if (result.ok) {
      setCategories((categories) =>
        inListOrder(categories.map((c) => (c.id === result.category.id ? result.category : c))),
      )
      setEdit((open) => (open?.id === current.id ? null : open))
      setStatusMessage('Category updated.')
    } else {
      // An edit cancelled while it was saving stays closed.
      setEdit((open) => (open?.id === current.id ? { ...current, fieldErrors: result.fieldErrors } : open))
      setErrorMessage(result.message)
    }
  }

  function startDelete(category: Category) {
    setDeleteMode(null)
    setReplacementId('')
    setConfirmingDeleteId(category.id)
  }

  // What the delete is to do: nothing for a Category nothing uses, and for one in use what was
  // chosen, or null while no valid choice is made.
  function deleteChoice(category: Category): DeleteCategoryChoice | null {
    if (!isInUse(category)) return { kind: 'unused' }
    if (deleteMode === 'deleteRules') return { kind: 'deleteRules' }
    if (deleteMode === 'moveToReplacement' && replacementId !== '') {
      return { kind: 'moveToReplacement', replacementCategoryId: Number(replacementId) }
    }
    return null
  }

  async function handleDelete(category: Category) {
    if (isSaving) return
    const choice = deleteChoice(category)
    if (!choice) return
    const replacement = choice.kind === 'moveToReplacement' ? choice.replacementCategoryId : null

    setIsSaving(true)
    setStatusMessage(null)
    setErrorMessage(null)
    setFieldErrors({})

    const result = await deleteCategory(category.id, choice).finally(() => setIsSaving(false))
    setConfirmingDeleteId(null)

    if (result.ok) {
      // The replacement now has everything that used the deleted Category.
      setCategories((categories) =>
        categories
          .filter((c) => c.id !== category.id)
          .map((c) =>
            c.id === replacement && !result.alreadyDeleted
              ? {
                  ...c,
                  transactionCount: c.transactionCount + category.transactionCount,
                  ruleCount: c.ruleCount + category.ruleCount,
                }
              : c,
          ),
      )
      setStatusMessage(
        result.alreadyDeleted
          ? 'The category was already deleted.'
          : changedMessage('Category deleted.', result.transactionsChanged),
      )
      // The remaining rules may have given its Transactions to other Categories, so the counts are
      // reloaded. Until then, or if that fails, the list just lacks the deleted Category.
      if (choice.kind === 'deleteRules' && !result.alreadyDeleted) {
        fetchCategories()
          .then(setCategories)
          .catch(() => {})
      }
    } else {
      setErrorMessage(result.message)
    }
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault()
    if (isSaving) return

    setIsSaving(true)
    setFieldErrors({})
    setStatusMessage(null)
    setErrorMessage(null)

    const result = await addCategory({ name: name.trim(), description: description.trim() }).finally(() =>
      setIsSaving(false),
    )

    if (result.ok) {
      setCategories((current) => inListOrder([...current, result.category]))
      setName('')
      setDescription('')
      setStatusMessage('Category added.')
    } else {
      setFieldErrors(result.fieldErrors)
      setErrorMessage(result.message)
    }
  }

  return (
    <section className="w-full max-w-2xl">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Categories</h2>

      <form className="mt-4 flex items-start gap-3 max-sm:flex-col max-sm:items-stretch" onSubmit={handleAdd}>
        <div className="flex w-40 flex-col gap-1 max-sm:w-auto">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-describedby="category-name-error"
              className={inputClass}
            />
          </label>
          <span id="category-name-error" className="text-xs text-red-600 dark:text-red-300">
            {fieldErrors.name}
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
            Description
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              aria-describedby="category-description-error"
              className={inputClass}
            />
          </label>
          <span id="category-description-error" className="text-xs text-red-600 dark:text-red-300">
            {fieldErrors.description}
          </span>
        </div>
        <button
          type="submit"
          disabled={isSaving}
          className="mt-6 rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-sm font-medium text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-300 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 max-sm:mt-0 max-sm:self-start"
        >
          Add category
        </button>
      </form>

      {errorMessage ? (
        <ErrorMessage className="mt-3">{errorMessage}</ErrorMessage>
      ) : (
        <StatusMessage message={statusMessage} className="mt-3" />
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
              {categories.map((category) =>
                edit?.id === category.id ? (
                  <tr key={category.id} className={rowClass}>
                    <td className={nameCellClass}>
                      {category.builtIn ? (
                        <div className="py-2">
                          <CategoryLabel category={category} colour={categoryColour(category.id, categories, dark)} />
                        </div>
                      ) : (
                        <div className="flex items-start gap-2">
                          <span className="flex h-9.5 items-center">
                            <CategorySwatch colour={categoryColour(category.id, categories, dark)} name={category.name} />
                          </span>
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <input
                              aria-label="Name"
                              value={edit.name}
                              onChange={(event) => setEdit({ ...edit, name: event.target.value })}
                              aria-describedby={`category-${category.id}-name-error`}
                              className={`${inputClass} w-full min-w-0`}
                            />
                            <span id={`category-${category.id}-name-error`} className="text-xs text-red-600 dark:text-red-300">
                              {edit.fieldErrors.name}
                            </span>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className={descriptionCellClass}>
                      <div className="flex flex-col gap-1">
                        <input
                          aria-label="Description"
                          value={edit.description}
                          onChange={(event) => setEdit({ ...edit, description: event.target.value })}
                          aria-describedby={`category-${category.id}-description-error`}
                          className={`${inputClass} w-full min-w-0`}
                        />
                        <span id={`category-${category.id}-description-error`} className="text-xs text-red-600 dark:text-red-300">
                          {edit.fieldErrors.description}
                        </span>
                      </div>
                    </td>
                    <td className={`${transactionCountCellClass} sm:pt-5`}>
                      <Count count={category.transactionCount} noun="transaction" />
                    </td>
                    <td className={`${ruleCountCellClass} sm:pt-5`}>
                      <Count count={category.ruleCount} noun="rule" />
                    </td>
                    <td className={`${actionsCellClass} sm:pt-4`}>
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
                  <tr key={category.id} className={rowClass}>
                    <td className={nameCellClass}>
                      <CategoryLabel category={category} colour={categoryColour(category.id, categories, dark)} />
                    </td>
                    <td className={`${descriptionCellClass} text-slate-600 dark:text-slate-400`}>{category.description}</td>
                    <td className={transactionCountCellClass}>
                      <Count count={category.transactionCount} noun="transaction" />
                    </td>
                    <td className={ruleCountCellClass}>
                      <Count count={category.ruleCount} noun="rule" />
                    </td>
                    {confirmingDeleteId === category.id ? (
                      <td className={confirmingActionsCellClass}>
                        {isInUse(category) ? (
                          <fieldset className="mr-1 inline-flex flex-col items-start gap-1 text-left whitespace-normal text-slate-700 dark:text-slate-300">
                            <legend className="mb-1">Delete {category.name}?</legend>
                            <div className="flex flex-wrap items-center gap-1">
                              <label className="flex items-center gap-1">
                                <input
                                  type="radio"
                                  name={`delete-${category.id}`}
                                  checked={deleteMode === 'moveToReplacement'}
                                  onChange={() => setDeleteMode('moveToReplacement')}
                                />
                                Move its transactions and rules to
                              </label>
                              {/* Choosing a replacement also chooses to move. */}
                              <select
                                aria-label="Move its transactions and rules to"
                                value={replacementId}
                                onChange={(event) => {
                                  setReplacementId(event.target.value)
                                  setDeleteMode('moveToReplacement')
                                }}
                                className="max-w-full rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1"
                              >
                                <option value="">Choose a category</option>
                                {categories
                                  .filter((c) => c.id !== category.id)
                                  .map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                              </select>
                            </div>
                            <label className="flex items-center gap-1">
                              <input
                                type="radio"
                                name={`delete-${category.id}`}
                                checked={deleteMode === 'deleteRules'}
                                onChange={() => setDeleteMode('deleteRules')}
                              />
                              Delete its rules and leave its transactions Uncategorized unless another rule matches them
                            </label>
                          </fieldset>
                        ) : (
                          <span className="mr-1 text-slate-700 dark:text-slate-300">Delete {category.name}?</span>
                        )}
                        <button
                          type="button"
                          disabled={isSaving || deleteChoice(category) === null}
                          onClick={() => handleDelete(category)}
                          className={smallButtonClass}
                        >
                          Confirm delete
                        </button>
                        <button type="button" onClick={() => setConfirmingDeleteId(null)} className={smallButtonClass}>
                          Cancel
                        </button>
                      </td>
                    ) : (
                      <td className={actionsCellClass}>
                        <button type="button" onClick={() => startEdit(category)} className={smallButtonClass}>
                          Edit
                        </button>
                        {/* A Built-in Category's Delete is shown disabled, so every row offers the same actions. */}
                        <button
                          type="button"
                          title={category.builtIn ? "Built-in Categories can't be deleted" : undefined}
                          disabled={category.builtIn || isSaving}
                          onClick={() => startDelete(category)}
                          className={smallButtonClass}
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
