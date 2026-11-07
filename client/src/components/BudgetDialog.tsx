import { useId, useState, type FormEvent } from 'react'
import { saveBudgets, type Category } from '../lib/api'
import { useIsDark } from '../lib/appearance'
import { canHaveBudget } from '../lib/budget'
import { categoryColour } from '../lib/categoryColours'
import { CategorySwatch } from './CategorySwatch'
import { Dialog } from './Dialog'
import { ErrorMessage } from './Messages'
import { inputClassName } from './TransactionForm'

// The largest Budget the server accepts, in whole kroner.
const MAX_BUDGET = 10_000_000

// Shown by an input whose Budget is refused at Save.
const INVALID_BUDGET = `Enter a whole number from 0 to ${new Intl.NumberFormat('nb-NO').format(MAX_BUDGET)}.`

// What was typed as a Budget in whole kroner: empty is 0, and anything but a whole number from 0 to
// MAX_BUDGET is null.
function parseBudget(typed: string): number | null {
  const trimmed = typed.trim()
  if (trimmed === '') return 0
  if (!/^\d+$/.test(trimmed)) return null
  const budget = Number(trimmed)
  return budget <= MAX_BUDGET ? budget : null
}

interface BudgetDialogProps {
  // Every Category, as the categories endpoint lists them.
  categories: Category[]
  onCancel: () => void
  // Every Category once the Budgets are saved, as the save returns them.
  onSaved: (categories: Category[]) => void
}

// Sets the Budget of every Category but Income and Savings, in whole kroner per month, listed in the
// order the Categories come in, each showing its current Budget. Reset puts every input at 0, which
// is saved only by Save, so Cancel still keeps the Budgets as they were. Save checks every input,
// then sends every listed Category's Budget at once.
export function BudgetDialog({ categories, onCancel, onSaved }: BudgetDialogProps) {
  const id = useId()
  const dark = useIsDark()
  const listed = categories.filter(canHaveBudget)
  // What is typed in each input, by Category id.
  const [typed, setTyped] = useState(() => new Map(listed.map((c) => [c.id, String(c.budget)])))
  // The Categories whose input was refused at the last Save.
  const [invalid, setInvalid] = useState<Set<number>>(new Set())
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Keeps what was typed as the Category's Budget, checked only at Save.
  function setTypedBudget(categoryId: number, value: string) {
    setTyped((current) => new Map(current).set(categoryId, value))
  }

  // Puts every input at 0, and clears their messages. Nothing is saved until Save.
  function reset() {
    setTyped(new Map(listed.map((c) => [c.id, '0'])))
    setInvalid(new Set())
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (isSaving) return

    const budgets = listed.map((c) => ({ categoryId: c.id, budget: parseBudget(typed.get(c.id) ?? '') }))
    const refused = new Set(budgets.filter((b) => b.budget === null).map((b) => b.categoryId))
    setInvalid(refused)
    setErrorMessage(null)
    if (refused.size > 0) return

    setIsSaving(true)
    const result = await saveBudgets(budgets.map((b) => ({ categoryId: b.categoryId, budget: b.budget! }))).finally(
      () => setIsSaving(false),
    )

    if (result.ok) onSaved(result.categories)
    else setErrorMessage(result.message)
  }

  return (
    <Dialog title="Set monthly budget" onCancel={onCancel}>
      {errorMessage && <ErrorMessage className="mt-3">{errorMessage}</ErrorMessage>}

      <form className="mt-4 flex flex-col gap-3" onSubmit={handleSubmit} noValidate>
        {listed.map((category) => {
          const errorId = `${id}-${category.id}-error`
          const refused = invalid.has(category.id)
          return (
            <div key={category.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                  <CategorySwatch colour={categoryColour(category.id, categories, dark)} />
                  <span className="min-w-0 flex-1 truncate">{category.name}</span>
                  <input
                    value={typed.get(category.id) ?? ''}
                    onChange={(event) => setTypedBudget(category.id, event.target.value)}
                    inputMode="numeric"
                    aria-invalid={refused || undefined}
                    aria-describedby={refused ? errorId : undefined}
                    className={`${inputClassName} w-28 text-right tabular-nums`}
                  />
                </label>
                <span aria-hidden="true" className="text-sm text-slate-500 dark:text-slate-400">
                  kr
                </span>
              </div>
              {refused && (
                <span id={errorId} className="text-right text-xs text-red-600 dark:text-red-300">
                  {INVALID_BUDGET}
                </span>
              )}
            </div>
          )
        })}

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Reset
          </button>
          <div className="ml-auto flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-sm font-medium text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-300 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  )
}
