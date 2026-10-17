export interface TransactionFormValues {
  date: string
  description: string
  amountIn: string
  amountOut: string
  note: string
  categoryId: string
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

export function isTransactionFormValid(values: TransactionFormValues): boolean {
  if (values.date.trim() === '') return false
  if (values.description.trim() === '') return false
  if (values.categoryId === '') return false

  const inFilled = values.amountIn.trim() !== ''
  const outFilled = values.amountOut.trim() !== ''
  if (inFilled === outFilled) return false // exactly one must be filled

  const amount = inFilled ? values.amountIn : values.amountOut
  return isPositiveAmount(amount)
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
