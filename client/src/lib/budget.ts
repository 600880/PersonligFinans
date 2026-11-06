import type { Category } from './api'
import type { Granularity } from './period'

// The Built-in Categories that never have a Budget: money received, and money put aside.
const NEVER_BUDGETED = ['Income', 'Savings']

// Whether the Category can have a Budget, as every one but Income and Savings can.
export function canHaveBudget(category: Category): boolean {
  return !(category.builtIn && NEVER_BUDGETED.includes(category.name))
}

// How many months of Budget a Period of each Granularity counts.
export const MONTHS_IN_PERIOD: Record<Granularity, number> = { month: 1, quarter: 3, year: 12 }

// The Period's overall Budget left: every Budget for the months in the Period, minus the Spending of
// every Category that can have a Budget and of Uncategorized, so Savings never counts, whether or not
// its slice is among those given.
export function overallBudgetLeft(
  slices: { categoryId: number | null; amount: number }[],
  categories: Category[],
  months: number,
): number {
  const budgeted = categories.reduce((sum, c) => sum + c.budget, 0) * months
  const spent = slices
    .filter(({ categoryId }) => {
      const category = categories.find((c) => c.id === categoryId)
      return !category || canHaveBudget(category)
    })
    .reduce((sum, { amount }) => sum + amount, 0)
  return budgeted - spent
}
