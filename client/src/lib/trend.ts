import type { MonthSpending, SpendingSlice } from './api'
import { groupMonths } from './grouping'
import { percent } from './percent'
import type { Granularity, Period } from './period'

// Identifies the Total row of the trend, and its line.
export const TOTAL_ROW = 'total'

// Identifies a Category's row of the trend, and its line, or Uncategorized's when categoryId is null.
export function categoryRow(categoryId: number | null): string {
  return categoryId === null ? 'uncategorized' : String(categoryId)
}

// One point of the trend: a Period of the Span, with the Spending of Total and of each Category of the
// trend, and the Savings and Income beside it, as NOK per month, keyed by row. `monthsCovered` is how
// many of the `monthsInPeriod` months of its Period fall inside the Span.
export interface TrendPoint {
  period: Period
  key: string
  label: string
  monthsCovered: number
  monthsInPeriod: number
  values: Record<string, number>
}

// The figures of a point's months, by Category: what each cost, and beside them what Savings put
// aside and Income received, each its months netted together. Only positive figures are kept, so a
// Category, Savings or Income that nets the other way or to zero over the months has none.
interface NetFigures {
  spending: Map<number | null, number>
  savings: Map<number | null, number>
  income: Map<number | null, number>
}

function netFigures(months: MonthSpending[]): NetFigures {
  const positiveNets = (slices: (SpendingSlice | null)[]) => {
    const sums = new Map<number | null, number>()
    for (const slice of slices) {
      if (slice) sums.set(slice.categoryId, (sums.get(slice.categoryId) ?? 0) + slice.amount)
    }
    return new Map([...sums].filter(([, amount]) => amount > 0))
  }
  return {
    spending: positiveNets(months.flatMap((month) => month.slices)),
    savings: positiveNets(months.map((month) => month.savings)),
    income: positiveNets(months.map((month) => month.income)),
  }
}

// The Categories of a Span's trend at a granularity: those with Spending in some point, null for
// Uncategorized, largest Spending summed over the points first, then Savings and Income, each when it
// has a figure in some point.
export function trendCategories(monthly: MonthSpending[], granularity: Granularity): (number | null)[] {
  const points = groupMonths(monthly, granularity).map((group) => netFigures(group.months))
  const sums = new Map<number | null, number>()
  for (const { spending } of points) {
    for (const [categoryId, amount] of spending) sums.set(categoryId, (sums.get(categoryId) ?? 0) + amount)
  }
  const besides = new Set([
    ...points.flatMap(({ savings }) => [...savings.keys()]),
    ...points.flatMap(({ income }) => [...income.keys()]),
  ])
  return [...[...sums].sort(([, a], [, b]) => b - a).map(([categoryId]) => categoryId), ...besides]
}

// The trend's points for a Span's monthly Spending, one per Period of the granularity, in order.
// Each point has a value for Total and every Category of the trend, 0 when it had no figure there.
// Each Category is netted over the point's months, so a refund reduces the Spending of its Period
// whichever month it lands in. Total is the sum of the Categories' Spending, never the Savings or
// Income beside it. Each value is divided by the months the point covers, so that partial points at
// the Span's edges compare with full ones.
export function trendPoints(monthly: MonthSpending[], granularity: Granularity): TrendPoint[] {
  const categories = trendCategories(monthly, granularity)
  return groupMonths(monthly, granularity).map((group) => {
    const monthsCovered = group.months.length
    const { spending, savings, income } = netFigures(group.months)
    const total = [...spending.values()].reduce((sum, amount) => sum + amount, 0)
    const values: Record<string, number> = { [TOTAL_ROW]: total / monthsCovered }
    for (const categoryId of categories) {
      const figure = spending.get(categoryId) ?? savings.get(categoryId) ?? income.get(categoryId) ?? 0
      values[categoryRow(categoryId)] = figure / monthsCovered
    }
    const { period, key, label, monthsInPeriod } = group
    return { period, key, label, monthsCovered, monthsInPeriod, values }
  })
}

// " (2 of 3 months)" for a point covering only part of its quarter or year, otherwise "".
export function coverageNote({ monthsCovered, monthsInPeriod }: TrendPoint): string {
  return monthsCovered < monthsInPeriod ? ` (${monthsCovered} of ${monthsInPeriod} months)` : ''
}

// The change from the first point's monthly value to the last's, e.g. "▲ +12,3 %" or "▼ −8,0 %".
// Positive means a larger figure. "New" when there was none at first, "−100 %" when there is none at
// last, "–" when there was none at all, and no arrow or sign when the change rounds to zero.
export function formatChange(first: number, last: number): string {
  if (first === 0) return last === 0 ? '–' : 'New'
  if (last === 0) return '−100 %'
  const change = (last - first) / first
  const size = percent.format(Math.abs(change))
  if (size === percent.format(0)) return size
  return change > 0 ? `▲ +${size}` : `▼ −${size}`
}
