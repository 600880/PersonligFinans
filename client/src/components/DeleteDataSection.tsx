import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import {
  deleteAllRules,
  deleteAllTransactions,
  deleteBankStatements,
  deleteYourUser,
  fetchBankStatements,
  fetchDeleteCounts,
  type DeleteCounts,
  type ListedBankStatement,
} from '../lib/api'
import { counted, formatCount } from '../lib/count'
import { formatNorwegianDate } from '../lib/date'
import { ErrorMessage, StatusMessage } from './Messages'
import { Field, inputClassName } from './TransactionForm'

interface DeleteDataSectionProps {
  // While an Upload is in progress nothing can be deleted, so Transactions don't keep appearing
  // after they were deleted.
  isUploading: boolean
  // Called after each delete, so the app's other pages show what is left.
  onDeleted: () => void
  // The Guest is shared by every visitor, so it can't be deleted.
  isGuest: boolean
  // Called once the User is deleted and this browser signed out, as after Sign out.
  onUserDeleted: () => void
}

// The delete whose question is open. One question is asked at a time.
type Confirming = 'bankStatements' | 'allTransactions' | 'allRules' | 'user'

// How a confirmed delete went: the status line saying what it deleted, or why it failed.
type DeleteOutcome = { ok: true; status: string } | { ok: false; message: string }

// The User page's one secondary button, Sign out's too.
export const secondaryButtonClass =
  'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:hover:bg-white'
const smallButtonClass =
  'rounded-lg px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300'
// Confirm delete, the one choice in a question that stands out.
const confirmButtonClass =
  'rounded-lg bg-red-600 px-2 py-1 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300'

// The User's deletes, least destructive first, one card each: the ticked Bank Statements with their
// Transactions, or every Transaction, then every Categorization Rule. Each asks for confirmation with
// exact counts. One status line, beside the heading, for whichever delete ran last, stays until the
// next action.
// Last, in a red card, Delete your User, which asks for the password instead and ends on the landing
// page.
export function DeleteDataSection({ isUploading, onDeleted, isGuest, onUserDeleted }: DeleteDataSectionProps) {
  const headingId = useId()
  const bankStatementListId = useId()
  // Null until loaded, so "There are no Bank Statements." never shows before they are.
  const [bankStatements, setBankStatements] = useState<ListedBankStatement[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  // Null until loaded, and the deletes they count stay disabled until then, or when counting again
  // fails, so no question asks with a count from before the last delete.
  const [counts, setCounts] = useState<DeleteCounts | null>(null)
  const [countsFailed, setCountsFailed] = useState(false)
  // Bumped after a delete, to list and count what is left.
  const [dataVersion, setDataVersion] = useState(0)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set())
  // Collapsed each time the User page opens, and left as it is after a delete.
  const [isListOpen, setIsListOpen] = useState(false)
  const [confirming, setConfirming] = useState<Confirming | null>(null)
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
  }, [isUploading, dataVersion])

  // Counted again whenever the list is loaded, so the next question counts what is there now.
  useEffect(() => {
    let ignore = false
    fetchDeleteCounts()
      .then((loaded) => {
        if (ignore) return
        setCounts(loaded)
        setCountsFailed(false)
      })
      .catch(() => {
        if (ignore) return
        setCounts(null)
        setCountsFailed(true)
      })
    return () => {
      ignore = true
    }
  }, [isUploading, dataVersion])

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

  function ask(question: Confirming) {
    clearMessages()
    setConfirming(question)
  }

  // In list order, which is what the counts and the request are made from.
  const selected = (bankStatements ?? []).filter((s) => selectedIds.has(s.id))
  const selectedTransactions = selected.reduce((sum, s) => sum + s.transactionCount, 0)
  const transactionCount = counts?.transactionCount ?? 0
  const ruleCount = counts?.ruleCount ?? 0
  const ruleCategorizedTransactionCount = counts?.ruleCategorizedTransactionCount ?? 0
  // "(4)", or "(4, 2 selected)" once something is ticked.
  const bankStatementsCounted =
    bankStatements &&
    ` (${formatCount(bankStatements.length)}${selected.length > 0 ? `, ${formatCount(selected.length)} selected` : ''})`

  // Runs the confirmed delete, then lists and counts again either way: a delete may be refused
  // because of a change made elsewhere, as by another visitor using the Guest, and the next question
  // should count what is there now. A failed one changes nothing, keeping the ticks for another try.
  async function confirmDelete(run: () => Promise<DeleteOutcome>) {
    setIsDeleting(true)
    const result = await run().finally(() => setIsDeleting(false))
    setConfirming(null)
    // One delete changes what another counts, as deleting every Transaction leaves none for deleting
    // the rules to make Uncategorized, so every delete waits to be counted again.
    setCounts(null)
    setDataVersion((version) => version + 1)
    if (result.ok) {
      setStatusMessage(result.status)
      setSelectedIds(new Set())
      onDeleted()
    } else {
      setErrorMessage(result.message)
    }
  }

  const confirmDeleteBankStatements = () =>
    confirmDelete(async () => {
      const result = await deleteBankStatements(selected.map((s) => s.id))
      return result.ok ? { ok: true, status: `${counted(result.bankStatementsDeleted, 'Bank Statement')} deleted.` } : result
    })

  const confirmDeleteAllTransactions = () =>
    confirmDelete(async () => {
      const result = await deleteAllTransactions()
      return result.ok ? { ok: true, status: `${counted(result.transactionsDeleted, 'Transaction')} deleted.` } : result
    })

  const confirmDeleteAllRules = () =>
    confirmDelete(async () => {
      const result = await deleteAllRules()
      return result.ok ? { ok: true, status: `${counted(result.rulesDeleted, 'Categorization Rule')} deleted.` } : result
    })

  // Each delete's button stays disabled while any question is open, during an Upload and while
  // deleting.
  const isBusy = isUploading || confirming !== null || isDeleting

  return (
    <section aria-labelledby={headingId} className="mt-8 flex flex-col gap-3">
      {/* The status line keeps its place beside the heading, or under it on a phone, so the cards never
          move when it comes or goes. */}
      <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start max-sm:gap-3">
        <h3 id={headingId} className="text-base font-semibold text-slate-900">
          Delete data
        </h3>
        {errorMessage ? <ErrorMessage>{errorMessage}</ErrorMessage> : <StatusMessage message={statusMessage} />}
      </div>
      {isUploading && <p className="text-sm text-slate-600">Deleting waits for the Upload in progress to finish.</p>}

      {/* Imported Transactions go only with their whole Bank Statement, so Delete selected deletes
          ticked Bank Statements and Delete all deletes every Bank Statement too. Delete all's question
          deliberately counts only the Transactions. */}
      <Card title="Delete Transactions">
        {loadFailed ? (
          <ErrorMessage>Could not load the Bank Statements.</ErrorMessage>
        ) : bankStatements?.length === 0 ? (
          <p className="text-sm text-slate-600">There are no Bank Statements.</p>
        ) : (
          // Collapsed until asked for, and the ticks stay while it is. Counted once loaded.
          <>
            <button
              type="button"
              aria-expanded={isListOpen}
              aria-controls={bankStatementListId}
              disabled={bankStatements === null}
              onClick={() => setIsListOpen((open) => !open)}
              className="-my-1 -ml-2 flex items-center gap-1.5 self-start rounded-lg px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span aria-hidden="true" className={`text-xs transition-transform ${isListOpen ? 'rotate-90' : ''}`}>
                ▶
              </span>
              Bank Statements{bankStatementsCounted}
            </button>
            {isListOpen && bankStatements && (
              <ul id={bankStatementListId} className="divide-y divide-slate-200">
                {bankStatements.map((statement) => (
                  <li key={statement.id}>
                    {/* On a phone the details wrap under one another beside the checkbox. */}
                    <label className="flex items-center gap-3 py-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(statement.id)}
                        disabled={confirming === 'bankStatements' || isDeleting}
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
          </>
        )}

        {countsFailed && <ErrorMessage>Could not count the Transactions.</ErrorMessage>}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={selected.length === 0 || isBusy}
            onClick={() => ask('bankStatements')}
            className={secondaryButtonClass}
          >
            Delete selected
          </button>
          <button
            type="button"
            disabled={transactionCount === 0 || isBusy}
            onClick={() => ask('allTransactions')}
            className={secondaryButtonClass}
          >
            Delete all
          </button>
        </div>
        {confirming === 'bankStatements' && (
          <ConfirmDelete
            isUploading={isUploading}
            isDeleting={isDeleting}
            onConfirm={() => void confirmDeleteBankStatements()}
            onCancel={() => setConfirming(null)}
          >
            Delete {counted(selected.length, 'Bank Statement')} and {selected.length === 1 ? 'its' : 'their'}{' '}
            {counted(selectedTransactions, 'Transaction')}?
          </ConfirmDelete>
        )}
        {confirming === 'allTransactions' && (
          <ConfirmDelete
            isUploading={isUploading}
            isDeleting={isDeleting}
            onConfirm={() => void confirmDeleteAllTransactions()}
            onCancel={() => setConfirming(null)}
          >
            Delete all {counted(transactionCount, 'Transaction')}?
          </ConfirmDelete>
        )}
      </Card>

      {/* Locked Transactions keep their Category, and the Categories stay. */}
      <Card title="Delete Categorization Rules" description="Transactions that aren't Locked become Uncategorized.">
        {countsFailed && <ErrorMessage>Could not count the Categorization Rules.</ErrorMessage>}
        <button
          type="button"
          disabled={ruleCount === 0 || isBusy}
          onClick={() => ask('allRules')}
          className={`self-start ${secondaryButtonClass}`}
        >
          Delete all
        </button>
        {confirming === 'allRules' && (
          <ConfirmDelete
            isUploading={isUploading}
            isDeleting={isDeleting}
            onConfirm={() => void confirmDeleteAllRules()}
            onCancel={() => setConfirming(null)}
          >
            Delete all {counted(ruleCount, 'Categorization Rule')}?
            {/* Left out when no Transaction would change, rather than saying 0 will. */}
            {ruleCategorizedTransactionCount > 0 &&
              ` ${counted(ruleCategorizedTransactionCount, 'Transaction')} will become Uncategorized.`}
          </ConfirmDelete>
        )}
      </Card>

      {/* Shown to the Guest too, disabled with no explanation, so the Guest sees what a signed-up User
          can do. */}
      <Card title="Delete your User" description="Your User and all personal data." isDanger>
        <button
          type="button"
          disabled={isGuest || isBusy}
          onClick={() => ask('user')}
          className="self-start rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300 disabled:shadow-none"
        >
          Delete user and all data
        </button>
        {confirming === 'user' && (
          <ConfirmDeleteYourUser
            isUploading={isUploading}
            onDeleted={onUserDeleted}
            onCancel={() => setConfirming(null)}
          />
        )}
      </Card>
    </section>
  )
}

interface CardProps {
  title: string
  // A short grey line under the title.
  description?: string
  // Red-tinted, for the one delete that takes everything.
  isDanger?: boolean
  children: ReactNode
}

// One delete's card, its own region named by its title: the title and its line, then the content and
// the buttons, all evenly spaced.
function Card({ title, description, isDanger = false, children }: CardProps) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className={`flex flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm ${isDanger ? 'border-red-200' : 'border-slate-200'}`}
    >
      <div>
        <h4 id={headingId} className="text-sm font-semibold text-slate-900">
          {title}
        </h4>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {children}
    </section>
  )
}

interface ConfirmDeleteYourUserProps {
  isUploading: boolean
  onDeleted: () => void
  onCancel: () => void
}

// Delete your User's question, which asks for the password, so that someone using an open tab can't
// delete the User. A wrong password or a locked email is shown here, keeping the question open.
function ConfirmDeleteYourUser({ isUploading, onDeleted, onCancel }: ConfirmDeleteYourUserProps) {
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | undefined>()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setPasswordError(undefined)
    setErrorMessage(null)
    setIsDeleting(true)
    const result = await deleteYourUser(password)
    // Deleted, the app unmounts and shows the landing page.
    if (result.ok) {
      onDeleted()
      return
    }
    setIsDeleting(false)
    setPasswordError(result.fieldErrors.password)
    setErrorMessage(result.message)
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg bg-red-50 p-3 text-sm"
    >
      <p className="text-red-800">Delete your User and all its data for good? Enter your password to confirm.</p>
      {errorMessage && <ErrorMessage>{errorMessage}</ErrorMessage>}
      <div className="max-w-sm max-sm:max-w-none">
        <Field label="Password" error={passwordError}>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={`bg-white ${inputClassName}`}
          />
        </Field>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="submit" disabled={isDeleting || isUploading} className={confirmButtonClass}>
          Confirm delete
        </button>
        <button type="button" disabled={isDeleting} onClick={onCancel} className={smallButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  )
}

interface ConfirmDeleteProps {
  // The question, with the exact counts of what goes.
  children: ReactNode
  isUploading: boolean
  isDeleting: boolean
  onConfirm: () => void
  onCancel: () => void
}

// A delete's question, under the button that asked it.
function ConfirmDelete({ children, isUploading, isDeleting, onConfirm, onCancel }: ConfirmDeleteProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg bg-red-50 p-3 text-sm">
      <span className="mr-auto text-red-800">{children}</span>
      <button type="button" disabled={isDeleting || isUploading} onClick={onConfirm} className={confirmButtonClass}>
        Confirm delete
      </button>
      <button type="button" disabled={isDeleting} onClick={onCancel} className={smallButtonClass}>
        Cancel
      </button>
    </div>
  )
}
