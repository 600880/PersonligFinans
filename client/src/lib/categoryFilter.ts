import type { Transaction } from './api'

// The Category filter's value: '' for all Categories, UNCATEGORIZED, or a Category's id.
export const UNCATEGORIZED = 'uncategorized'

// The filter for one Category, or for Uncategorized when categoryId is null.
export function categoryFilterOf(categoryId: number | null) {
  return categoryId === null ? UNCATEGORIZED : String(categoryId)
}

export function matchesCategory(transaction: Transaction, categoryFilter: string) {
  if (categoryFilter === '') return true
  if (categoryFilter === UNCATEGORIZED) return transaction.categoryId === null
  return transaction.categoryId === Number(categoryFilter)
}
