import { useEffect, useState } from 'react'
import { fetchCategories, type Category } from '../lib/api'

// Every Category in the order the API lists them, alphabetically, with what uses it.
export function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
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

  return (
    <section className="w-full max-w-2xl">
      <h2 className="text-lg font-semibold text-slate-900">Categories</h2>

      {errorMessage && (
        <p role="alert" className="mt-3 min-h-5 text-sm text-red-700">
          {errorMessage}
        </p>
      )}

      <table className="mt-4 w-full text-left text-sm">
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
