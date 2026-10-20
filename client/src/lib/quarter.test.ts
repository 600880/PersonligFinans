import { describe, expect, it } from 'vitest'
import type { Transaction } from './api'
import { firstMonthWithTransactions } from './quarter'

const q1 = { granularity: 'quarter', year: 2026, quarter: 1 } as const

function transaction(date: string, categoryId: number | null): Transaction {
  return { id: 1, date, description: 'Kiwi', amount: -100, note: null, categoryId, locked: false, imported: true, bookmarked: false }
}

// The months of a Span from `from` to `to` in 2026.
function span2026(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, i) => ({ year: 2026, month: from + i }))
}

// The Category filter for Groceries, as the Transactions page's Category filter has it.
const GROCERIES = '1'

describe('firstMonthWithTransactions', () => {
  it('skips months before the Span starts', () => {
    const transactions = [transaction('2026-01-10', 1), transaction('2026-03-05', 1)]

    expect(firstMonthWithTransactions(q1, span2026(2, 6), GROCERIES, transactions)).toEqual({ year: 2026, month: 3 })
  })

  it('skips months after the Span ends, falling back to the earliest month of the quarter in it', () => {
    const novemberToFebruary = [{ year: 2025, month: 11 }, { year: 2025, month: 12 }, ...span2026(1, 2)]

    expect(firstMonthWithTransactions(q1, novemberToFebruary, GROCERIES, [transaction('2026-03-05', 1)])).toEqual({
      year: 2026,
      month: 1,
    })
  })

  it('falls back to the earliest month inside the Span when none matches', () => {
    expect(firstMonthWithTransactions(q1, span2026(2, 6), GROCERIES, [transaction('2026-01-10', 1)])).toEqual({
      year: 2026,
      month: 2,
    })
  })

  it('matches any Transaction for all Categories', () => {
    const transactions = [transaction('2026-02-20', null)]

    expect(firstMonthWithTransactions(q1, span2026(1, 3), '', transactions)).toEqual({ year: 2026, month: 2 })
  })
})
