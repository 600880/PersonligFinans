import { todayIsoDate } from './date'

export interface TransactionFormValues {
  date: string
  description: string
  amountIn: string
  amountOut: string
  note: string
  categoryId: string
}

// The form a manually-entered Transaction starts from: today's date and nothing else.
export function emptyTransactionForm(): TransactionFormValues {
  return {
    date: todayIsoDate(),
    description: '',
    amountIn: '',
    amountOut: '',
    note: '',
    categoryId: '',
  }
}

export interface CreateTransactionRequest {
  date: string
  description: string
  amount: number
  note: string | null
  categoryId: number
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

// What to ask for the form's Possible duplicates: its date and signed Amount, or null until both
// the Date and a valid amount are filled in.
export function possibleDuplicateQuery(
  values: TransactionFormValues,
): { date: string; amount: number } | null {
  const amount = signedAmount(values)
  if (values.date.trim() === '' || amount === null) return null
  return { date: values.date, amount }
}

// In becomes a positive Amount, Out a negative one.
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
  }
}
