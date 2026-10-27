import { describe, expect, it } from 'vitest'
import type { Transaction } from './api'
import { UNCATEGORIZED } from './categoryFilter'
import { latestYearWithTransactions } from './year'

function transaction(date: string, categoryId: number | null): Transaction {
  return { id: 1, date, description: 'Kiwi', amount: -100, note: null, categoryId, locked: false, imported: true, bookmarked: false, hasReceipt: false }
}

// The months with Transactions, newest first, as the months endpoint lists them.
const months = [
  { year: 2026, month: 3 },
  { year: 2026, month: 1 },
  { year: 2025, month: 11 },
  { year: 2024, month: 5 },
]

// Groceries in 2026 and 2024, Uncategorized in 2025.
const transactionsByYear: Record<number, Transaction[]> = {
  2026: [transaction('2026-03-12', 13), transaction('2026-01-05', 1)],
  2025: [transaction('2025-11-20', null)],
  2024: [transaction('2024-05-08', 1)],
}

// Loads a year's Transactions, remembering which years were loaded.
function loader() {
  const loaded: number[] = []
  return {
    loaded,
    transactionsOf: async (year: number) => {
      loaded.push(year)
      return transactionsByYear[year] ?? []
    },
  }
}

// The Category filter for Groceries, as the Transactions page's Category filter has it.
const GROCERIES = '1'

describe('latestYearWithTransactions', () => {
  it('finds the latest year with a Transaction in the Category, loading no older year', async () => {
    const { loaded, transactionsOf } = loader()

    expect(await latestYearWithTransactions(months, GROCERIES, transactionsOf)).toBe(2026)
    expect(loaded).toEqual([2026])
  })

  it('finds an earlier year for Uncategorized when the later ones have none', async () => {
    const { loaded, transactionsOf } = loader()

    expect(await latestYearWithTransactions(months, UNCATEGORIZED, transactionsOf)).toBe(2025)
    expect(loaded).toEqual([2026, 2025])
  })

  it('is undefined when no year has a Transaction in the Category', async () => {
    const { transactionsOf } = loader()

    expect(await latestYearWithTransactions(months, '7', transactionsOf)).toBeUndefined()
  })
})
