import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import {
  createTransaction,
  fetchCategories,
  type Category,
  type FieldErrors,
} from '../lib/api'
import { todayIsoDate } from '../lib/date'
import {
  isTransactionFormValid,
  toCreateTransactionRequest,
  type TransactionFormValues,
} from '../lib/transactionForm'

const inputClassName =
  'rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none'

function emptyForm(): TransactionFormValues {
  return {
    date: todayIsoDate(),
    description: '',
    amountIn: '',
    amountOut: '',
    note: '',
    categoryId: '',
  }
}

interface FieldProps {
  label: string
  error?: string
  children: ReactNode
}

function Field({ label, error, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
      {label}
      {children}
      {error && <span className="text-xs font-normal text-red-600">{error}</span>}
    </label>
  )
}

interface AddTransactionModalProps {
  onCancel: () => void
  onSaved: () => void
}

export function AddTransactionModal({ onCancel, onSaved }: AddTransactionModalProps) {
  const [values, setValues] = useState<TransactionFormValues>(emptyForm)
  const [categories, setCategories] = useState<Category[]>([])
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const headingId = useId()

  useEffect(() => {
    let ignore = false
    fetchCategories()
      .then((loaded) => {
        if (!ignore) setCategories(loaded)
      })
      .catch(() => {
        if (!ignore) setErrorMessage('Could not load categories.')
      })
    return () => {
      ignore = true
    }
  }, [])

  function updateField<K extends keyof TransactionFormValues>(
    key: K,
    value: TransactionFormValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!isTransactionFormValid(values) || isSaving) return

    setIsSaving(true)
    setFieldErrors({})
    setErrorMessage(null)
    const result = await createTransaction(toCreateTransactionRequest(values))
    setIsSaving(false)

    if (result.ok) {
      onSaved()
    } else {
      setFieldErrors(result.fieldErrors)
      setErrorMessage(result.message)
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 id={headingId} className="text-lg font-semibold text-slate-900">
          Add transaction
        </h2>

        {errorMessage && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        )}

        <form className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
          <Field label="Date" error={fieldErrors.date}>
            <input
              type="date"
              value={values.date}
              onChange={(e) => updateField('date', e.target.value)}
              className={inputClassName}
            />
          </Field>

          <Field label="Description" error={fieldErrors.description}>
            <input
              type="text"
              maxLength={200}
              value={values.description}
              onChange={(e) => updateField('description', e.target.value)}
              className={inputClassName}
            />
          </Field>

          <div className="flex flex-col gap-1">
            <div className="grid grid-cols-2 gap-4">
              <Field label="In">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={values.amountIn}
                  onChange={(e) => updateField('amountIn', e.target.value)}
                  className={inputClassName}
                />
              </Field>

              <Field label="Out">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={values.amountOut}
                  onChange={(e) => updateField('amountOut', e.target.value)}
                  className={inputClassName}
                />
              </Field>
            </div>
            {fieldErrors.amount && (
              <span className="text-xs text-red-600">{fieldErrors.amount}</span>
            )}
          </div>

          <Field label="Note" error={fieldErrors.note}>
            <input
              type="text"
              maxLength={256}
              value={values.note}
              onChange={(e) => updateField('note', e.target.value)}
              className={inputClassName}
            />
          </Field>

          <Field label="Category" error={fieldErrors.categoryId}>
            <select
              value={values.categoryId}
              onChange={(e) => updateField('categoryId', e.target.value)}
              className={inputClassName}
            >
              <option value="">Choose…</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="mt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isTransactionFormValid(values) || isSaving}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
