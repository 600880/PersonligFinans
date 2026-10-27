import { useEffect, useState, type FormEvent } from 'react'
import { deleteRule, previewDeletingRule, type CategorizationRule, type Category, type RulePreview } from '../lib/api'
import { counted } from '../lib/count'
import { Dialog } from './Dialog'
import { ErrorMessage } from './Messages'
import { RuleChangePreview } from './RuleChangePreview'

// What a delete did, once the server has answered.
export interface RuleDeleted {
  // The rule was gone before this delete, so nothing changed.
  alreadyDeleted: boolean
  transactionsChanged: number
}

interface RuleDeleteDialogProps {
  // The rule to delete, one that categorizes Transactions.
  rule: CategorizationRule
  // Every Category, to name each changed Transaction's old and new Category by.
  categories: Category[]
  onCancel: () => void
  onDeleted: (deleted: RuleDeleted) => void
}

// Asks before deleting a rule that categorizes Transactions. It says how many, and previews what the
// delete would change: the Transactions left Uncategorized, and those another rule gives its
// Category. The preview is asked for once, on opening. Until it answers, or when it can't be had, as
// for a rule deleted elsewhere, the dialog asks without it. A refused delete keeps the dialog open,
// showing why.
export function RuleDeleteDialog({ rule, categories, onCancel, onDeleted }: RuleDeleteDialogProps) {
  const [preview, setPreview] = useState<RulePreview | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    previewDeletingRule(rule.id)
      // A failed preview only means none is shown: it never stands in the way of deleting.
      .catch(() => null)
      .then((preview) => {
        if (!ignore) setPreview(preview)
      })
    return () => {
      ignore = true
    }
  }, [rule.id])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (isDeleting) return

    setIsDeleting(true)
    setErrorMessage(null)

    const result = await deleteRule(rule.id).finally(() => setIsDeleting(false))

    if (result.ok) {
      onDeleted({ alreadyDeleted: result.alreadyDeleted, transactionsChanged: result.transactionsChanged })
    } else {
      setErrorMessage(result.message)
    }
  }

  return (
    <Dialog title={`Delete the rule “${rule.keyword}”?`} onCancel={onCancel}>
      {errorMessage && <ErrorMessage className="mt-3">{errorMessage}</ErrorMessage>}

      <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">
        It categorizes {counted(rule.transactionCount, 'transaction')}.
      </p>
      {preview && <RuleChangePreview preview={preview} categories={categories} />}

      <form className="mt-6 flex justify-end gap-3" onSubmit={handleSubmit}>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isDeleting}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300 dark:disabled:bg-red-950/60 dark:disabled:text-red-800"
        >
          {isDeleting ? 'Deleting…' : 'Confirm delete'}
        </button>
      </form>
    </Dialog>
  )
}
