import { useEffect, useState, type FormEvent } from 'react'
import { addCategory, fetchCategories, type Category, type CategoryFieldErrors } from '../lib/api'

function byName(a: Category, b: Category) {
  return a.name.localeCompare(b.name)
}

const inputClass = 'rounded-lg border border-slate-300 px-3 py-2 font-normal'

// Every Category in the order the API lists them, alphabetically, with what uses it, and a form to
// add one.
export function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<CategoryFieldErrors>({})
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
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
