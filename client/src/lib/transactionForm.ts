import type { ReceiptSuggestion } from './api'
import { todayIsoDate } from './date'

// The Bookmark's values for "-", leaving the Transaction not bookmarked, and for "Bookmarks", the
// bookmarks in no Folder. A Folder's value is its id.
export const NOT_BOOKMARKED = ''
export const IN_NO_FOLDER = 'bookmarks'

export interface TransactionFormValues {
  date: string
  description: string
  amountIn: string
  amountOut: string
  categoryId: string
  bookmark: string
  note: string
}

// The form a manually-entered Transaction starts from: today's date, not bookmarked, and nothing else.
export function emptyTransactionForm(): TransactionFormValues {
  return {
    date: todayIsoDate(),
    description: '',
    amountIn: '',
    amountOut: '',
    categoryId: '',
    bookmark: NOT_BOOKMARKED,
    note: '',
  }
}

// The form a Receipt's Transaction starts from: what was read on the Receipt, with today's date if
// none was, a purchase in Out and a refund in In, and every field that wasn't suggested empty. The
// Bookmark and the Note are the user's alone, so they always start as "-" and empty.
export function suggestedTransactionForm(suggestion: ReceiptSuggestion): TransactionFormValues {
  const { date, description, amount, categoryId } = suggestion
  const magnitude = amount === null ? '' : Math.abs(amount).toFixed(2)
  return {
    date: date ?? todayIsoDate(),
    description: description ?? '',
    amountIn: amount !== null && amount > 0 ? magnitude : '',
    amountOut: amount !== null && amount < 0 ? magnitude : '',
    categoryId: categoryId === null ? '' : String(categoryId),
    bookmark: NOT_BOOKMARKED,
    note: '',
  }
}

// bookmark is left out to leave the Transaction not bookmarked; its folderId is null for "Bookmarks".
export interface CreateTransactionRequest {
  date: string
  description: string
  amount: number
  note: string | null
  categoryId: number
  bookmark?: { folderId: number | null }
}

// A positive amount with at most two decimals, e.g. "100" or "249.90".
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/

function isPositiveAmount(value: string): boolean {
  const trimmed = value.trim()
  return AMOUNT_PATTERN.test(trimmed) && Number(trimmed) > 0
}

// The signed Amount In or Out holds, or null unless exactly one of them holds a valid amount.
function signedAmount(values: TransactionFormValues): number | null {
  const inFilled = values.amountIn.trim() !== ''
  const outFilled = values.amountOut.trim() !== ''
  if (inFilled === outFilled) return null // exactly one must be filled

  const amount = inFilled ? values.amountIn : values.amountOut
  if (!isPositiveAmount(amount)) return null
  return inFilled ? Number(amount.trim()) : -Number(amount.trim())
}

export function isTransactionFormValid(values: TransactionFormValues): boolean {
  if (values.date.trim() === '') return false
  if (values.description.trim() === '') return false
  if (values.categoryId === '') return false
  return signedAmount(values) !== null
}

// What the Possible duplicates are asked for: a date and a signed Amount.
export interface PossibleDuplicateQuery {
  date: string
  amount: number
}

// The form's date and signed Amount, or null until both the Date and a valid amount are filled in.
export function possibleDuplicateQuery(values: TransactionFormValues): PossibleDuplicateQuery | null {
  const amount = signedAmount(values)
  if (values.date.trim() === '' || amount === null) return null
  return { date: values.date, amount }
}

// In becomes a positive Amount, Out a negative one. "-" sends no bookmark.
export function toCreateTransactionRequest(values: TransactionFormValues): CreateTransactionRequest {
  const isIn = values.amountIn.trim() !== ''
  const magnitude = Number((isIn ? values.amountIn : values.amountOut).trim())
  const note = values.note.trim()

  return {
    date: values.date,
    description: values.description.trim(),
    amount: isIn ? magnitude : -magnitude,
    note: note === '' ? null : note,
    categoryId: Number(values.categoryId),
    ...(values.bookmark !== NOT_BOOKMARKED && {
      bookmark: { folderId: values.bookmark === IN_NO_FOLDER ? null : Number(values.bookmark) },
    }),
  }
}
