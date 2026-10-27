import type { Transaction, TransactionMonth } from './api'
import { matchesCategory } from './categoryFilter'

// The latest year with a Transaction matching the Category filter, or undefined when none has one.
// The years are those of `months`, newest first, and are loaded one at a time with `transactionsOf`,
// so no year older than the one found is loaded.
export async function latestYearWithTransactions(
  months: TransactionMonth[],
  categoryFilter: string,
  transactionsOf: (year: number) => Promise<Transaction[]>,
): Promise<number | undefined> {
  for (const year of new Set(months.map((m) => m.year))) {
    const transactions = await transactionsOf(year)
    if (transactions.some((t) => matchesCategory(t, categoryFilter))) return year
  }
  return undefined
}
