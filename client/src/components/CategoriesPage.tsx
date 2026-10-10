import { useEffect, useState, type FormEvent } from 'react'
import {
  addCategory,
  deleteCategory,
  editCategory,
  fetchCategories,
  type Category,
  type CategoryFieldErrors,
} from '../lib/api'

function byName(a: Category, b: Category) {
  return a.name.localeCompare(b.name)
}

// The Category being edited inline, with the input as typed so far.
interface CategoryEdit {
  id: number
  name: string
  description: string
  fieldErrors: CategoryFieldErrors
}

const inputClass = 'rounded-lg border border-slate-300 px-3 py-2 font-normal'
const smallButtonClass =
  'rounded-lg px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300'

function BuiltInBadge() {
  return (
    <>
      {' '}
      <span
        title="Built-in Category: can't be renamed or deleted"
        className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600"
      >
        Built-in
      </span>
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

// Every Category in the order the API lists them, alphabetically, with what uses it, and a form to
// add one. Each can be edited inline, and one that isn't Built-in can be deleted after a confirmation.
// Deleting one in use asks for a replacement Category, which its Transactions and rules move to.
export function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<CategoryFieldErrors>({})
  // The id of the Category whose delete is waiting for confirmation.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null)
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
        categories.map((c) => (c.id === result.category.id ? result.category : c)).sort(byName),
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
    setReplacementId('')
    setConfirmingDeleteId(category.id)
  }

  // A Category in use moves to the chosen replacement; one nothing uses is simply deleted.
  async function handleDelete(category: Category) {
    if (isSaving) return
    const replacement = isInUse(category) ? Number(replacementId) : undefined
    if (replacement === 0) return

    setIsSaving(true)
    setStatusMessage(null)
    setErrorMessage(null)
    setFieldErrors({})

    const result = await deleteCategory(category.id, { replacementCategoryId: replacement }).finally(() =>
      setIsSaving(false),
    )
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
      setCategories((current) => [...current, result.category].sort(byName))
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
      <h2 className="text-lg font-semibold text-slate-900">Categories</h2>

      <form className="mt-4 flex items-start gap-3" onSubmit={handleAdd}>
        <div className="flex w-40 flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-describedby="category-name-error"
              className={inputClass}
            />
          </label>
          <span id="category-name-error" className="text-xs text-red-600">
            {fieldErrors.name}
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Description
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              aria-describedby="category-description-error"
              className={inputClass}
            />
          </label>
          <span id="category-description-error" className="text-xs text-red-600">
            {fieldErrors.description}
          </span>
        </div>
        <button
          type="submit"
          disabled={isSaving}
          className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Add category
        </button>
      </form>

      {errorMessage ? (
        <p role="alert" className="mt-3 min-h-5 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : (
        <p role="status" className="mt-3 h-5 text-sm text-emerald-700">
          {statusMessage}
        </p>
      )}

      <table className="mt-2 w-full text-left text-sm">
        <thead className="text-slate-500">
          <tr>
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Description</th>
            <th className="py-2 text-right font-medium">Transactions</th>
            <th className="py-2 text-right font-medium">Rules</th>
            <th className="py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 text-slate-900">
          {categories.map((category) =>
            edit?.id === category.id ? (
              <tr key={category.id} className="align-top">
                <td className="py-2 pr-3">
                  {category.builtIn ? (
                    <div className="py-2 whitespace-nowrap">
                      {category.name}
                      <BuiltInBadge />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <input
                        aria-label="Name"
                        value={edit.name}
                        onChange={(event) => setEdit({ ...edit, name: event.target.value })}
                        aria-describedby={`category-${category.id}-name-error`}
                        className={inputClass}
                      />
                      <span id={`category-${category.id}-name-error`} className="text-xs text-red-600">
                        {edit.fieldErrors.name}
                      </span>
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <div className="flex flex-col gap-1">
                    <input
                      aria-label="Description"
                      value={edit.description}
                      onChange={(event) => setEdit({ ...edit, description: event.target.value })}
                      aria-describedby={`category-${category.id}-description-error`}
                      className={inputClass}
                    />
                    <span id={`category-${category.id}-description-error`} className="text-xs text-red-600">
                      {edit.fieldErrors.description}
                    </span>
                  </div>
                </td>
                <td className="py-2 pl-3 text-right tabular-nums">{category.transactionCount}</td>
                <td className="py-2 pl-3 text-right tabular-nums">{category.ruleCount}</td>
                <td className="py-2 text-right whitespace-nowrap">
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
              <tr key={category.id} className="align-top">
                <td className="py-2 pr-3 whitespace-nowrap">
                  {category.name}
                  {category.builtIn && <BuiltInBadge />}
                </td>
                <td className="py-2 pr-3 text-slate-600">{category.description}</td>
                <td className="py-2 pl-3 text-right tabular-nums">{category.transactionCount}</td>
                <td className="py-2 pl-3 text-right tabular-nums">{category.ruleCount}</td>
                <td className="py-2 pl-3 text-right whitespace-nowrap">
                  {confirmingDeleteId === category.id ? (
                    <>
                      <span className="mr-1 text-slate-700">Delete {category.name}?</span>
                      {isInUse(category) && (
                        <label className="mr-1 text-slate-700">
                          Move its transactions and rules to{' '}
                          <select
                            value={replacementId}
                            onChange={(event) => setReplacementId(event.target.value)}
                            className="rounded-lg border border-slate-300 px-2 py-1"
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
                        </label>
                      )}
                      <button
                        type="button"
                        disabled={isSaving || (isInUse(category) && replacementId === '')}
                        onClick={() => handleDelete(category)}
                        className={smallButtonClass}
                      >
                        Confirm delete
                      </button>
                      <button type="button" onClick={() => setConfirmingDeleteId(null)} className={smallButtonClass}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => startEdit(category)} className={smallButtonClass}>
                        Edit
                      </button>
                      {!category.builtIn && (
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => startDelete(category)}
                          className={smallButtonClass}
                        >
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </section>
  )
}
