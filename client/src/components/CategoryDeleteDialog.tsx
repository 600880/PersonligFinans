import { useState, type FormEvent } from 'react'
import { deleteCategory, type Category, type DeleteCategoryChoice } from '../lib/api'
import { counted } from '../lib/count'
import { Dialog } from './Dialog'
import { ErrorMessage } from './Messages'
import { inputClassName } from './TransactionForm'

// What a delete did, once the server has answered.
export interface CategoryDeleted {
  choice: DeleteCategoryChoice
  // The Category was gone before this delete, so nothing changed.
  alreadyDeleted: boolean
  transactionsChanged: number
}

interface CategoryDeleteDialogProps {
  // The Category to delete, never a Built-in one.
  category: Category
  // Every listed Category, the one being deleted included, to choose its replacement from.
  categories: Category[]
  onCancel: () => void
  onDeleted: (deleted: CategoryDeleted) => void
}

function isInUse(category: Category) {
  return category.transactionCount > 0 || category.ruleCount > 0
}

// Asks before deleting a Category. One nothing uses is deleted on confirming. One in use says how
// many Transactions and rules it has, and needs a choice first: a replacement Category, which its
// Transactions and rules move to, or to delete its rules, leaving its Transactions to the remaining
// rules, or Uncategorized. A refused delete keeps the dialog open with the choice made, showing why.
export function CategoryDeleteDialog({ category, categories, onCancel, onDeleted }: CategoryDeleteDialogProps) {
  // How a Category in use is to be deleted, as the radios show it; null until chosen. Moving needs a
  // replacement too, so the choice is only complete once one is.
  const [mode, setMode] = useState<'moveToReplacement' | 'deleteRules' | null>(null)
  // The replacement chosen, as the select's value; '' until one is chosen.
  const [replacementId, setReplacementId] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const inUse = isInUse(category)

  // What the delete is to do: nothing for a Category nothing uses, and for one in use what was
  // chosen, or null while no complete choice is made.
  function deleteChoice(): DeleteCategoryChoice | null {
    if (!inUse) return { kind: 'unused' }
    if (mode === 'deleteRules') return { kind: 'deleteRules' }
    if (mode === 'moveToReplacement' && replacementId !== '') {
      return { kind: 'moveToReplacement', replacementCategoryId: Number(replacementId) }
    }
    return null
  }
  const choice = deleteChoice()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (isDeleting || !choice) return

    setIsDeleting(true)
    setErrorMessage(null)

    const result = await deleteCategory(category.id, choice).finally(() => setIsDeleting(false))

    if (result.ok) {
      onDeleted({ choice, alreadyDeleted: result.alreadyDeleted, transactionsChanged: result.transactionsChanged })
    } else {
      setErrorMessage(result.message)
    }
  }

  return (
    <Dialog title={`Delete ${category.name}?`} onCancel={onCancel}>
      {errorMessage && <ErrorMessage className="mt-3">{errorMessage}</ErrorMessage>}

      <form className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
        {inUse && (
          <fieldset className="flex flex-col gap-3 text-sm text-slate-700 dark:text-slate-300">
            {/* What is at stake, which the choices below say what to do with. */}
            <legend className="mb-3">
              {category.name} has {counted(category.transactionCount, 'transaction')} and{' '}
              {counted(category.ruleCount, 'rule')}.
            </legend>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="delete"
                  checked={mode === 'moveToReplacement'}
                  onChange={() => setMode('moveToReplacement')}
                />
                Move its transactions and rules to
              </label>
              {/* Choosing a replacement also chooses to move. */}
              <select
                aria-label="Move its transactions and rules to"
                value={replacementId}
                onChange={(event) => {
                  setReplacementId(event.target.value)
                  setMode('moveToReplacement')
                }}
                className={`${inputClassName} max-w-full bg-white dark:bg-slate-900`}
              >
                <option value="">Choose a category</option>
                {categories
                  .filter((c) => c.id !== category.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="delete"
                checked={mode === 'deleteRules'}
                onChange={() => setMode('deleteRules')}
                className="mt-0.5"
              />
              Delete its rules and leave its transactions Uncategorized unless another rule matches them
            </label>
          </fieldset>
        )}

        <div className="mt-2 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isDeleting || !choice}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300 dark:disabled:bg-red-950/60 dark:disabled:text-red-800"
          >
            {isDeleting ? 'Deleting…' : 'Confirm delete'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
