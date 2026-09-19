import { useId, useState, type ReactNode } from 'react'
import { todayIsoDate } from '../lib/date'
import {
  isTransactionFormValid,
  type TransactionFormValues,
} from '../lib/transactionForm'

const CATEGORY_OPTIONS = ['Other'] as const

const inputClassName =
  'rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none'

function emptyForm(): TransactionFormValues {
  return {
    date: todayIsoDate(),
    description: '',
    amountIn: '',
    amountOut: '',
    reference: '',
    category: CATEGORY_OPTIONS[0],
  }
}

interface FieldProps {
  label: string
  children: ReactNode
}

function Field({ label, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
      {label}
      {children}
    </label>
  )
}

interface AddTransactionModalProps {
  onCancel: () => void
}

export function AddTransactionModal({ onCancel }: AddTransactionModalProps) {
  const [values, setValues] = useState<TransactionFormValues>(emptyForm)
  const headingId = useId()

  function updateField<K extends keyof TransactionFormValues>(
    key: K,
    value: TransactionFormValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }))
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

        <form className="mt-4 flex flex-col gap-4">
          <Field label="Date">
            <input
              type="date"
              value={values.date}
              onChange={(e) => updateField('date', e.target.value)}
              className={inputClassName}
            />
          </Field>

          <Field label="Description">
            <input
              type="text"
              value={values.description}
              onChange={(e) => updateField('description', e.target.value)}
              className={inputClassName}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="In">
              <input
                type="number"
                min="0"
                value={values.amountIn}
                onChange={(e) => updateField('amountIn', e.target.value)}
                className={inputClassName}
              />
            </Field>

            <Field label="Out">
              <input
                type="number"
                min="0"
                value={values.amountOut}
                onChange={(e) => updateField('amountOut', e.target.value)}
                className={inputClassName}
              />
            </Field>
          </div>

          <Field label="Reference">
            <input
              type="text"
              value={values.reference}
              onChange={(e) => updateField('reference', e.target.value)}
              className={inputClassName}
            />
          </Field>

          <Field label="Category">
            <select
              value={values.category}
              onChange={(e) => updateField('category', e.target.value)}
              className={inputClassName}
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
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
              type="button"
              disabled={!isTransactionFormValid(values)}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
