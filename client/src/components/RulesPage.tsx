import { useEffect, useState, type FormEvent } from 'react'
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
import { ErrorMessage, StatusMessage } from './Messages'

function changedMessage(action: string, transactionsChanged: number) {
  const transactions = transactionsChanged === 1 ? 'transaction' : 'transactions'
  return `${action} ${transactionsChanged} ${transactions} changed category.`
}

function byKeyword(a: CategorizationRule, b: CategorizationRule) {
  return a.keyword.localeCompare(b.keyword)
}

// The rule being edited inline, with the input as typed so far.
interface RuleEdit {
  id: number
  keyword: string
  categoryId: string
  fieldErrors: RuleFieldErrors
}

const inputClass = 'rounded-lg border border-slate-300 px-3 py-2 font-normal'
const smallButtonClass =
  'rounded-lg px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300'

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

  const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? ''

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
      setRules((current) => [...current, result.rule].sort(byKeyword))
      setKeyword('')
      setCategoryId('')
      setStatusMessage(changedMessage('Rule added.', result.transactionsChanged))
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
      setRules((rules) => rules.map((r) => (r.id === result.rule.id ? result.rule : r)).sort(byKeyword))
      setEdit(null)
      setStatusMessage(changedMessage('Rule updated.', result.transactionsChanged))
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
    } else {
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
              className={inputClass}
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
        <ErrorMessage className="mt-3">{errorMessage}</ErrorMessage>
      ) : (
        <StatusMessage message={statusMessage} className="mt-3" />
      )}

      <table className="mt-2 w-full text-left text-sm">
        <thead className="text-slate-500">
          <tr>
            <th className="py-2 font-medium">Keyword</th>
            <th className="py-2 font-medium">Category</th>
            <th className="py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 text-slate-900">
          {rules.map((rule) =>
            edit?.id === rule.id ? (
              <tr key={rule.id} className="align-top">
                <td className="py-2 pr-3">
                  <div className="flex flex-col gap-1">
                    <input
                      aria-label="Keyword"
                      value={edit.keyword}
                      onChange={(event) => setEdit({ ...edit, keyword: event.target.value })}
                      aria-describedby={`rule-${rule.id}-keyword-error`}
                      className={inputClass}
                    />
                    <span id={`rule-${rule.id}-keyword-error`} className="text-xs text-red-600">
                      {edit.fieldErrors.keyword}
                    </span>
                  </div>
                </td>
                <td className="py-2 pr-3">
                  <div className="flex flex-col gap-1">
                    <select
                      aria-label="Category"
                      value={edit.categoryId}
                      onChange={(event) => setEdit({ ...edit, categoryId: event.target.value })}
                      aria-describedby={`rule-${rule.id}-category-error`}
                      className={inputClass}
                    >
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                    <span id={`rule-${rule.id}-category-error`} className="text-xs text-red-600">
                      {edit.fieldErrors.categoryId}
                    </span>
                  </div>
                </td>
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
              <tr key={rule.id}>
                <td className="py-2">
                  {rule.keyword}
                  {rule.aiGenerated && (
                    <>
                      {' '}
                      <span
                        title="AI-generated rule"
                        className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-700"
                      >
                        AI
                      </span>
                    </>
                  )}
                </td>
                <td className="py-2">{categoryName(rule.categoryId)}</td>
                <td className="py-2 text-right whitespace-nowrap">
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
    </section>
  )
}
