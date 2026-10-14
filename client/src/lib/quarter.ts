import type { Transaction, TransactionMonth } from './api'
import { matchesCategory } from './categoryFilter'
import { monthOfDate, sameMonth } from './month'
import type { Period } from './period'

export type Quarter = Extract<Period, { granularity: 'quarter' }>

// The quarter's three months, in order.
export function monthsOfQuarter({ year, quarter }: Quarter): TransactionMonth[] {
  return [1, 2, 3].map((n) => ({ year, month: 3 * (quarter - 1) + n }))
}

// The month a quarter leads to, since Transactions are listed by month or year. It is picked from
// the quarter's months that are also in `allowed` (which may be a whole Span): the first of them
// with a Transaction matching the Category filter, else the first of them, else the quarter's first
// month. `transactions` are those of the quarter's year.
export function firstMonthWithTransactions(
  quarter: Quarter,
  allowed: TransactionMonth[],
  categoryFilter: string,
  transactions: Transaction[],
): TransactionMonth {
  const months = monthsOfQuarter(quarter).filter((month) => allowed.some((a) => sameMonth(a, month)))
  const hasMatch = (month: TransactionMonth) =>
    transactions.some((t) => sameMonth(monthOfDate(t.date), month) && matchesCategory(t, categoryFilter))
  return months.find(hasMatch) ?? months[0] ?? monthsOfQuarter(quarter)[0]
}
