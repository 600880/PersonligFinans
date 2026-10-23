import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { formatAmount } from '../lib/amount'
import {
  createTransaction,
  fetchCategories,
  fetchFolders,
  fetchPossibleDuplicates,
  type Category,
  type FieldErrors,
  type Folder,
  type PossibleDuplicate,
} from '../lib/api'
import { formatNorwegianDate } from '../lib/date'
import {
  IN_NO_FOLDER,
  NOT_BOOKMARKED,
  isTransactionFormValid,
  possibleDuplicateQuery,
  toCreateTransactionRequest,
  type PossibleDuplicateQuery,
  type TransactionFormValues,
} from '../lib/transactionForm'

export const inputClassName =
  'rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-slate-500 dark:focus:border-slate-400 focus:outline-none'

interface FieldProps {
  label: string
  error?: string
  children: ReactNode
}

// A labelled input with its validation error under it.
export function Field({ label, error, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
      {label}
      {children}
      {error && <span className="text-xs font-normal text-red-600 dark:text-red-300">{error}</span>}
    </label>
  )
}

// How long typing in the Date or amount must pause before the form asks for Possible duplicates.
const POSSIBLE_DUPLICATE_DELAY_MS = 300

// The Possible duplicates of what the form holds: none until the Date and a valid amount are filled
// in, and then those the server answered for exactly that date and Amount. An answer for values the
// form no longer holds is never shown, and a failed check shows none.
function usePossibleDuplicates(values: TransactionFormValues): PossibleDuplicate[] {
  const query = possibleDuplicateQuery(values)
  const date = query?.date ?? null
  const amount = query?.amount ?? null
  // The answer remembers what it was asked, so that it is only shown while the form still holds it.
  const [answer, setAnswer] = useState<
    (PossibleDuplicateQuery & { possibleDuplicates: PossibleDuplicate[] }) | null
  >(null)

  useEffect(() => {
    if (date === null || amount === null) return
    let ignore = false
    const timer = setTimeout(() => {
      fetchPossibleDuplicates({ date, amount })
        .then((possibleDuplicates) => {
          if (!ignore) setAnswer({ date, amount, possibleDuplicates })
        })
        // A failed check only means no notice: it never stands in the way of saving.
        .catch(() => {})
    }, POSSIBLE_DUPLICATE_DELAY_MS)
    return () => {
      ignore = true
      clearTimeout(timer)
    }
  }, [date, amount])

  return answer !== null && answer.date === date && answer.amount === amount
    ? answer.possibleDuplicates
    : []
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
// has recorded the Transaction, along with its Bookmark when one was chosen. The Bookmark is "-"
// until the user chooses otherwise, and can only be chosen once the Folders are loaded; failing to
// load them never keeps Save from being used. Under the fields, a notice lists the Possible
// duplicates of the date and Amount entered; it only warns and never keeps Save from being used.
export function TransactionForm({
  initialValues,
  disabled = false,
  secondaryAction,
  onSaved,
}: TransactionFormProps) {
  const [values, setValues] = useState<TransactionFormValues>(initialValues)
  const [categories, setCategories] = useState<Category[]>([])
  // The User's Folders, in the API's order; null until loaded.
  const [folders, setFolders] = useState<Folder[] | null>(null)
  const [foldersLoadError, setFoldersLoadError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const canSave = isTransactionFormValid(values) && !isSaving && !disabled
  const possibleDuplicates = usePossibleDuplicates(values)
  const possibleDuplicatesHeadingId = useId()

  useEffect(() => {
    let ignore = false
    fetchCategories()
      .then((loaded) => {
        if (!ignore) setCategories(loaded)
      })
      .catch(() => {
        if (!ignore) setErrorMessage('Could not load categories.')
      })
    fetchFolders()
      .then((loaded) => {
        if (!ignore) setFolders(loaded)
      })
      .catch(() => {
        if (!ignore) setFoldersLoadError('Could not load folders.')
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

        <Field label="Bookmark" error={fieldErrors.bookmark ?? foldersLoadError ?? undefined}>
          <select
            value={values.bookmark}
            disabled={disabled || folders === null}
            onChange={(e) => updateField('bookmark', e.target.value)}
            className={inputClassName}
          >
            <option value={NOT_BOOKMARKED}>-</option>
            {folders !== null && (
              <>
                <option value={IN_NO_FOLDER}>Bookmarks</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </>
            )}
          </select>
        </Field>

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

        {possibleDuplicates.length > 0 && (
          <section
            aria-labelledby={possibleDuplicatesHeadingId}
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            <h3 id={possibleDuplicatesHeadingId} className="font-medium">
              {possibleDuplicates.length === 1 ? 'Possible duplicate' : 'Possible duplicates'}
            </h3>
            <ul className="mt-1 flex flex-col gap-1">
              {possibleDuplicates.map((possibleDuplicate) => (
                <li key={possibleDuplicate.id} className="flex gap-3">
                  <span className="whitespace-nowrap">{formatNorwegianDate(possibleDuplicate.date)}</span>
                  <span className="min-w-0 flex-1 break-words">{possibleDuplicate.description}</span>
                  <span className="whitespace-nowrap tabular-nums">{formatAmount(possibleDuplicate.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

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
