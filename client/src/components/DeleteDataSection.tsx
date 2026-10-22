import { useEffect, useId, useState } from 'react'
import { deleteBankStatements, fetchBankStatements, type ListedBankStatement } from '../lib/api'
import { counted } from '../lib/count'
import { formatNorwegianDate } from '../lib/date'
import { ErrorMessage, StatusMessage } from './Messages'

interface DeleteDataSectionProps {
  // While an Upload is in progress nothing can be deleted, so Transactions don't keep appearing
  // after they were deleted.
  isUploading: boolean
  // Called after each delete, so the app's other pages show what is left.
  onDeleted: () => void
}

const buttonClass =
  'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60'
const smallButtonClass =
  'rounded-lg px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300'

// The User's deletes, least destructive first: the ticked Bank Statements with their Transactions.
// Each asks for confirmation with exact counts. One status line, for whichever delete ran last,
// stays until the next action.
export function DeleteDataSection({ isUploading, onDeleted }: DeleteDataSectionProps) {
  const headingId = useId()
  const bankStatementsHeadingId = useId()
  // Null until loaded, so "There are no Bank Statements." never shows before they are.
  const [bankStatements, setBankStatements] = useState<ListedBankStatement[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  // Bumped after a delete, to list what is left.
  const [listVersion, setListVersion] = useState(0)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set())
  const [isConfirming, setIsConfirming] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Loaded again when an Upload starts or finishes, so the Bank Statements it imported are listed
  // once it is done. Ticks stay on those still listed.
  useEffect(() => {
    let ignore = false
    fetchBankStatements()
      .then((loaded) => {
        if (ignore) return
        setBankStatements(loaded)
        setLoadFailed(false)
        setSelectedIds((selected) => new Set(loaded.filter((s) => selected.has(s.id)).map((s) => s.id)))
      })
      .catch(() => {
        if (!ignore) setLoadFailed(true)
      })
    return () => {
      ignore = true
    }
  }, [isUploading, listVersion])

  function clearMessages() {
    setStatusMessage(null)
    setErrorMessage(null)
  }

  function toggle(id: number) {
    clearMessages()
    setSelectedIds((selected) => {
      const next = new Set(selected)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  // In list order, which is what the counts and the request are made from.
  const selected = (bankStatements ?? []).filter((s) => selectedIds.has(s.id))
  const selectedTransactions = selected.reduce((sum, s) => sum + s.transactionCount, 0)

  // Changes nothing when it fails, keeping the list and the ticks for another try.
  async function confirmDelete() {
    setIsDeleting(true)
    const result = await deleteBankStatements(selected.map((s) => s.id)).finally(() => setIsDeleting(false))
    setIsConfirming(false)
    if (result.ok) {
      setStatusMessage(`${counted(result.bankStatementsDeleted, 'Bank Statement')} deleted.`)
      setSelectedIds(new Set())
      setListVersion((version) => version + 1)
      onDeleted()
    } else {
      setErrorMessage(result.message)
    }
  }

  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h3 id={headingId} className="text-base font-semibold text-slate-900">
        Delete data
      </h3>
      {isUploading && (
        <p className="mt-1 text-sm text-slate-600">Deleting waits for the Upload in progress to finish.</p>
      )}
      {errorMessage ? (
        <ErrorMessage className="mt-3">{errorMessage}</ErrorMessage>
      ) : (
        <StatusMessage message={statusMessage} className="mt-3" />
      )}

      <section
        aria-labelledby={bankStatementsHeadingId}
        className="mt-2 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"
      >
        <h4 id={bankStatementsHeadingId} className="text-sm font-semibold text-slate-900">
          Bank Statements
        </h4>
        {loadFailed ? (
          <ErrorMessage className="mt-3">Could not load the Bank Statements.</ErrorMessage>
        ) : bankStatements?.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">There are no Bank Statements.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-200">
            {bankStatements?.map((statement) => (
              <li key={statement.id}>
                {/* On a phone the details wrap under one another beside the checkbox. */}
                <label className="flex items-center gap-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(statement.id)}
                    disabled={isConfirming || isDeleting}
                    onChange={() => toggle(statement.id)}
                    className="size-4 shrink-0"
                  />
                  <span className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-0.5">
                    <span className="font-medium text-slate-900 tabular-nums">{statement.accountNumber}</span>
                    <span className="tabular-nums">
                      {formatNorwegianDate(statement.periodStart)}–{formatNorwegianDate(statement.periodEnd)}
                    </span>
                    <span className="text-slate-500">Imported {formatNorwegianDate(statement.importedOn)}</span>
                    <span className="tabular-nums sm:ml-auto">{counted(statement.transactionCount, 'Transaction')}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          disabled={selected.length === 0 || isUploading || isConfirming || isDeleting}
          onClick={() => {
            clearMessages()
            setIsConfirming(true)
          }}
          className={`mt-3 ${buttonClass}`}
        >
          Delete selected
        </button>
        {isConfirming && (
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm">
            <span className="mr-auto text-red-800">
              Delete {counted(selected.length, 'Bank Statement')} and {selected.length === 1 ? 'its' : 'their'}{' '}
              {counted(selectedTransactions, 'Transaction')}?
            </span>
            <button
              type="button"
              disabled={isDeleting || isUploading}
              onClick={() => void confirmDelete()}
              className={smallButtonClass}
            >
              Confirm delete
            </button>
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => setIsConfirming(false)}
              className={smallButtonClass}
            >
              Cancel
            </button>
          </div>
        )}
      </section>
    </section>
  )
}
