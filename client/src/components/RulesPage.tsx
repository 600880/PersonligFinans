import { useEffect, useState, type FormEvent } from 'react'
import {
  addRule,
  fetchCategories,
  fetchRules,
  type CategorizationRule,
  type Category,
  type RuleFieldErrors,
} from '../lib/api'

function changedMessage(action: string, transactionsChanged: number) {
  const transactions = transactionsChanged === 1 ? 'transaction' : 'transactions'
  return `${action} ${transactionsChanged} ${transactions} changed category.`
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

  useEffect(() => {
    void fetchCategories().then(setCategories)
    void fetchRules().then(setRules)
  }, [])

  const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? ''

  async function handleAdd(event: FormEvent) {
    event.preventDefault()
    setIsSaving(true)
    setStatusMessage(null)
    setErrorMessage(null)

    const result = await addRule({
      keyword: keyword.trim(),
      categoryId: categoryId === '' ? null : Number(categoryId),
    }).finally(() => setIsSaving(false))

    if (result.ok) {
      setRules((current) =>
        [...current, result.rule].sort((a, b) => a.keyword.localeCompare(b.keyword)),
      )
      setKeyword('')
      setCategoryId('')
      setFieldErrors({})
      setStatusMessage(changedMessage('Rule added.', result.transactionsChanged))
    } else {
      setFieldErrors(result.fieldErrors)
      setErrorMessage(result.message)
    }
  }

  return (
    <section className="w-full max-w-2xl">
      <h2 className="text-lg font-semibold text-slate-900">Categorization Rules</h2>

      <form className="mt-4 flex items-start gap-3" onSubmit={handleAdd}>
        <div className="flex flex-1 flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Keyword
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              aria-describedby="rule-keyword-error"
              className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
            />
          </label>
          <span id="rule-keyword-error" className="text-xs text-red-600">
            {fieldErrors.keyword}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Category
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              aria-describedby="rule-category-error"
              className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
            >
              <option value="">Choose…</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <span id="rule-category-error" className="text-xs text-red-600">
            {fieldErrors.categoryId}
          </span>
        </div>
        <button
          type="submit"
          disabled={isSaving}
          className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Add rule
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
            <th className="py-2 font-medium">Keyword</th>
            <th className="py-2 font-medium">Category</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 text-slate-900">
          {rules.map((rule) => (
            <tr key={rule.id}>
              <td className="py-2">{rule.keyword}</td>
              <td className="py-2">{categoryName(rule.categoryId)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
