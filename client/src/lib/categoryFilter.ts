import type { Transaction } from './api'

// The Category filter's value: '' for all Categories, UNCATEGORIZED, or a Category's id.
export const UNCATEGORIZED = 'uncategorized'

// The filter for one Category, for Uncategorized when categoryId is null, or for all Categories.
export function categoryFilterOf(categoryId: number | null | 'all') {
  if (categoryId === 'all') return ''
  return categoryId === null ? UNCATEGORIZED : String(categoryId)
}

// Whether a Transaction, or anything else with a Category such as a Categorization Rule, passes the filter.
export function matchesCategory(item: Pick<Transaction, 'categoryId'>, categoryFilter: string) {
  if (categoryFilter === '') return true
  if (categoryFilter === UNCATEGORIZED) return item.categoryId === null
  return item.categoryId === Number(categoryFilter)
}
