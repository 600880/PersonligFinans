import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  createTransaction,
  fetchCategories,
  type Category,
  type FieldErrors,
} from '../lib/api'
import {
  isTransactionFormValid,
  toCreateTransactionRequest,
  type TransactionFormValues,
} from '../lib/transactionForm'

const inputClassName =
  'rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none'

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

interface TransactionFormProps {
  initialValues: TransactionFormValues
  disabled?: boolean
  secondaryAction: { label: string; onClick: () => void }
  onSaved: () => void
}

// The fields, validation and Save of a manually-entered Transaction, shared by every place that
// records one so they can never drift apart. initialValues is read once, when the form mounts:
// give the form a new key to start it over. disabled keeps the fields and Save from being used,
// e.g. while a Receipt is still being read. secondaryAction is the button beside Save, such as
// Add transaction's Cancel, and stays usable while disabled. onSaved is called once the server
// has recorded the Transaction.
export function TransactionForm({
  initialValues,
  disabled = false,
  secondaryAction,
  onSaved,
}: TransactionFormProps) {
  const [values, setValues] = useState<TransactionFormValues>(initialValues)
  const [categories, setCategories] = useState<Category[]>([])
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const canSave = isTransactionFormValid(values) && !isSaving && !disabled

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
    if (!canSave) return

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
    <>
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
            disabled={disabled}
            onChange={(e) => updateField('date', e.target.value)}
            className={inputClassName}
          />
        </Field>

        <Field label="Description" error={fieldErrors.description}>
          <input
            type="text"
            maxLength={200}
            value={values.description}
            disabled={disabled}
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
                disabled={disabled}
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
                disabled={disabled}
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
            disabled={disabled}
            onChange={(e) => updateField('note', e.target.value)}
            className={inputClassName}
          />
        </Field>

        <Field label="Category" error={fieldErrors.categoryId}>
          <select
            value={values.categoryId}
            disabled={disabled}
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
            onClick={secondaryAction.onClick}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            {secondaryAction.label}
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </>
  )
}
