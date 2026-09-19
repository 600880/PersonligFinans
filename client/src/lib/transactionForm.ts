export interface TransactionFormValues {
  date: string
  description: string
  amountIn: string
  amountOut: string
  reference: string
  category: string
}

function isNonNegativeAmount(value: string): boolean {
  if (value.trim() === '') return false
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0
}

export function isTransactionFormValid(values: TransactionFormValues): boolean {
  if (values.date.trim() === '') return false
  if (values.category.trim() === '') return false

  const inFilled = values.amountIn.trim() !== ''
  const outFilled = values.amountOut.trim() !== ''
  if (inFilled === outFilled) return false // exactly one must be filled

  const amount = inFilled ? values.amountIn : values.amountOut
  return isNonNegativeAmount(amount)
}
