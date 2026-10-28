import { useId, useState } from 'react'
import { formatAmount } from '../lib/amount'
import type { Category, RulePreview } from '../lib/api'
import { categoryName } from '../lib/categoryName'
import { counted, formatCount } from '../lib/count'
import { formatNorwegianDate } from '../lib/date'

// "Would change 14 transactions", or that nothing would.
function summary({ changedCount }: RulePreview) {
  return changedCount === 0 ? 'Nothing would change' : `Would change ${counted(changedCount, 'transaction')}`
}

// What deleting a rule would do: the summary, and the Transactions it would change, listed once
// asked for, each with its old → new Category among the categories.
export function RuleChangePreview({ preview, categories }: { preview: RulePreview; categories: Category[] }) {
  const [isListOpen, setIsListOpen] = useState(false)
  const listId = useId()
  const { changedCount, changes } = preview

  return (
    <section aria-label="Preview" className="mt-2 text-sm text-slate-600 dark:text-slate-400">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p>{summary(preview)}</p>
        {changes.length > 0 && (
          <button
            type="button"
            aria-expanded={isListOpen}
            aria-controls={listId}
            onClick={() => setIsListOpen((open) => !open)}
            className="-my-1 flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <span aria-hidden="true" className={`text-xs transition-transform ${isListOpen ? 'rotate-90' : ''}`}>
              ▶
            </span>
            {isListOpen ? 'Hide transactions' : 'Show transactions'}
          </button>
        )}
      </div>
      {isListOpen && changes.length > 0 && (
        <div id={listId} className="mt-2 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
          {/* On a phone each Transaction's details wrap under one another. */}
          <ul className="flex flex-col gap-1">
            {changes.map((change) => (
              <li key={change.id} className="flex flex-wrap gap-x-3">
                <span className="whitespace-nowrap tabular-nums">{formatNorwegianDate(change.date)}</span>
                <span className="min-w-0 flex-1 break-words text-slate-900 dark:text-slate-100">{change.description}</span>
                <span className="whitespace-nowrap tabular-nums">{formatAmount(change.amount)}</span>
                <span className="basis-full sm:basis-auto">
                  {categoryName(change.fromCategoryId, categories)} → {categoryName(change.toCategoryId, categories)}
                </span>
              </li>
            ))}
          </ul>
          {changedCount > changes.length && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              The {formatCount(changes.length)} newest of {formatCount(changedCount)}.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
