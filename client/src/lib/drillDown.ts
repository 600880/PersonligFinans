import type { Transaction, TransactionMonth } from './api'
import { matchesCategory } from './categoryFilter'
import type { Period } from './period'

export type Quarter = Extract<Period, { granularity: 'quarter' }>

// The quarter's three months, in order.
export function monthsOfQuarter({ year, quarter }: Quarter): TransactionMonth[] {
  return [1, 2, 3].map((n) => ({ year, month: 3 * (quarter - 1) + n }))
}

// The month a quarter leads to, since Transactions are listed by month or year: the earliest of its
// allowed months with a Transaction matching the Category filter, or the earliest allowed month when
// none has one. `allowed` may hold months outside the quarter, such as a whole Span's; only the
// quarter's count, and its first month stands in if none of them is allowed. `transactions` are the
// quarter's year's.
export function quarterMonth(
  quarter: Quarter,
  allowed: TransactionMonth[],
  categoryFilter: string,
  transactions: Transaction[],
): TransactionMonth {
  const isAllowed = (m: TransactionMonth) => allowed.some((a) => a.year === m.year && a.month === m.month)
  const months = monthsOfQuarter(quarter).filter(isAllowed)
  // Dates are ISO, e.g. "2026-02-14".
  const hasMatch = ({ year, month }: TransactionMonth) =>
    transactions.some(
      (t) => t.date.startsWith(`${year}-${String(month).padStart(2, '0')}-`) && matchesCategory(t, categoryFilter),
    )
  return months.find(hasMatch) ?? months[0] ?? monthsOfQuarter(quarter)[0]
}
