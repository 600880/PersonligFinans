import { useCallback, useId, useState, type FormEvent } from 'react'
import {
  addRule,
  editRule,
  previewAddingRule,
  previewEditingRule,
  type CategorizationRule,
  type CategorizationRuleRequest,
  type Category,
  type RuleFieldErrors,
} from '../lib/api'
import { useRulePreview } from '../lib/useRulePreview'
import { Dialog } from './Dialog'
import { ErrorMessage } from './Messages'
import { RuleChangePreview } from './RuleChangePreview'
import { inputClassName } from './TransactionForm'

// The shortest keyword the server accepts, since a one-letter keyword would match nearly everything.
const KEYWORD_MIN_LENGTH = 2

// The request to preview for a keyword and Category as typed so far, or null while they could not be
// saved as one of the rules: the keyword is too short or is another rule's, ignoring case, or no
// Category is chosen. Anything else the server refuses is told by the preview itself.
function previewRequest(keyword: string, categoryId: string, otherRules: CategorizationRule[]) {
  const trimmed = keyword.trim()
  if (
    trimmed.length < KEYWORD_MIN_LENGTH ||
    categoryId === '' ||
    otherRules.some((r) => r.keyword.toLowerCase() === trimmed.toLowerCase())
  )
    return null
  return { keyword: trimmed, categoryId: Number(categoryId) }
}

// What a save did, once the server has answered.
export interface RuleSaved {
  rule: CategorizationRule
  transactionsChanged: number
}

interface RuleDialogProps {
  // The rule to edit, or none to add one.
  rule?: CategorizationRule
  // The Category a new rule starts on, as the Category filter holds it: '' for none, so the User
  // chooses one. Read on opening only.
  startingCategoryId?: string
  // Every rule, the edited one included, which the change would be made to.
  rules: CategorizationRule[]
  categories: Category[]
  onCancel: () => void
  onSaved: (saved: RuleSaved) => void
}

// Adds a Categorization Rule, or edits one, by its Keyword and Category, previewing what saving would
// change: the add preview for a new rule, and the edit preview for the edited one, whose own keyword is
// no other rule's. A new rule starts on the given Category, or on "Choose…" with none; an edited one
// starts filled in from the rule, so saving an AI-generated rule unchanged still removes its AI mark.
// Closing the dialog without saving discards what was typed and chosen.
export function RuleDialog({ rule, startingCategoryId = '', rules, categories, onCancel, onSaved }: RuleDialogProps) {
  const id = useId()
  const [keyword, setKeyword] = useState(rule?.keyword ?? '')
  const [categoryId, setCategoryId] = useState(rule ? String(rule.categoryId) : startingCategoryId)
  const [isSaving, setIsSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<RuleFieldErrors>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // The same function for as long as the dialog is open, so the preview hook only asks again when the
  // keyword, the Category or the rules change.
  const ruleId = rule?.id
  const askForPreview = useCallback(
    (request: CategorizationRuleRequest) =>
      ruleId === undefined ? previewAddingRule(request) : previewEditingRule(ruleId, request),
    [ruleId],
  )
  const preview = useRulePreview(
    previewRequest(keyword, categoryId, rules.filter((r) => r.id !== ruleId)),
    askForPreview,
    rules,
  )

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (isSaving) return

    setIsSaving(true)
    setFieldErrors({})
    setErrorMessage(null)

    const request = { keyword: keyword.trim(), categoryId: categoryId === '' ? null : Number(categoryId) }
    const result = await (ruleId === undefined ? addRule(request) : editRule(ruleId, request)).finally(() =>
      setIsSaving(false),
    )

    if (result.ok) {
      onSaved({ rule: result.rule, transactionsChanged: result.transactionsChanged })
    } else {
      setFieldErrors(result.fieldErrors)
      setErrorMessage(result.message)
    }
  }

  return (
    <Dialog title={rule ? 'Edit rule' : 'Add rule'} onCancel={onCancel}>
      {errorMessage && <ErrorMessage className="mt-3">{errorMessage}</ErrorMessage>}

      <form className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
            Keyword
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              autoFocus
              aria-describedby={`${id}-keyword-error`}
              className={inputClassName}
            />
          </label>
          <span id={`${id}-keyword-error`} className="text-xs text-red-600 dark:text-red-300">
            {fieldErrors.keyword}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
            Category
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              aria-describedby={`${id}-category-error`}
              className={inputClassName}
            >
              {/* An edited rule always has a Category, so only a new one can be left on none. */}
              {!rule && <option value="">Choose…</option>}
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <span id={`${id}-category-error`} className="text-xs text-red-600 dark:text-red-300">
            {fieldErrors.categoryId}
          </span>
        </div>

        {preview && <RuleChangePreview preview={preview} categories={categories} />}

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
            disabled={isSaving}
            className="rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-sm font-medium text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-300 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
