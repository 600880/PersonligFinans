import { useEffect, useState } from 'react'
import { deleteCategory, fetchCategories, type Category } from '../lib/api'

function changedMessage(action: string, transactionsChanged: number) {
  const transactions = transactionsChanged === 1 ? 'transaction' : 'transactions'
  return `${action} ${transactionsChanged} ${transactions} changed category.`
}

const smallButtonClass =
  'rounded-lg px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300'

// Every Category in the order the API lists them, alphabetically, with what uses it. A Category that
// isn't Built-in can be deleted after a confirmation.
export function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [isSaving, setIsSaving] = useState(false)
  // The id of the Category whose delete is waiting for confirmation.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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

  async function handleDelete(category: Category) {
    if (isSaving) return

    setIsSaving(true)
    setStatusMessage(null)
    setErrorMessage(null)

    const result = await deleteCategory(category.id).finally(() => setIsSaving(false))
    setConfirmingDeleteId(null)

    if (result.ok) {
      setCategories((categories) => categories.filter((c) => c.id !== category.id))
      setStatusMessage(
        result.alreadyDeleted
          ? 'The category was already deleted.'
          : changedMessage('Category deleted.', result.transactionsChanged),
      )
    } else {
      setErrorMessage(result.message)
    }
  }

  return (
    <section className="w-full max-w-2xl">
      <h2 className="text-lg font-semibold text-slate-900">Categories</h2>

      {errorMessage ? (
        <p role="alert" className="mt-3 min-h-5 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : (
        <p role="status" className="mt-3 h-5 text-sm text-emerald-700">
          {statusMessage}
        </p>
      )}

      <table className="mt-4 w-full text-left text-sm">
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
          {categories.map((category) => (
            <tr key={category.id} className="align-top">
              <td className="py-2 pr-3 whitespace-nowrap">
                {category.name}
                {category.builtIn && (
                  <>
                    {' '}
                    <span
                      title="Built-in Category: can't be renamed or deleted"
                      className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600"
                    >
                      Built-in
                    </span>
                  </>
                )}
              </td>
              <td className="py-2 pr-3 text-slate-600">{category.description}</td>
              <td className="py-2 pl-3 text-right tabular-nums">{category.transactionCount}</td>
              <td className="py-2 pl-3 text-right tabular-nums">{category.ruleCount}</td>
              <td className="py-2 pl-3 text-right whitespace-nowrap">
                {category.builtIn ? null : confirmingDeleteId === category.id ? (
                  <>
                    <span className="mr-1 text-slate-700">Delete {category.name}?</span>
                    <button
                      type="button"
                      disabled={isSaving}
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
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => setConfirmingDeleteId(category.id)}
                    className={smallButtonClass}
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
