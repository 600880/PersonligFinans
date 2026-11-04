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

// One point of the trend: a Period of the Span, with the figures of Total and of each Category of the
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
// aside and Income received, each its months netted together to the øre, below zero when it nets the
// other way. A Category, Savings or Income that nets to zero over the months has none. `total` is the
// sum of every Category's figure, never Savings or Income.
interface NetFigures {
  spending: Map<number | null, number>
  savings: Map<number | null, number>
  income: Map<number | null, number>
  total: number
}

// An amount rounded to the øre, so that Amounts which cancel leave exactly zero rather than what adding
// them up as fractions leaves over, and never minus zero.
function roundToOre(amount: number): number {
  return Math.round(amount * 100) / 100 || 0
}

function netFigures(months: MonthSpending[]): NetFigures {
  const nets = (slices: (SpendingSlice | null)[]) => {
    const sums = new Map<number | null, number>()
    for (const slice of slices) {
      if (slice) sums.set(slice.categoryId, (sums.get(slice.categoryId) ?? 0) + slice.amount)
    }
    return new Map(
      [...sums].map(([categoryId, amount]) => [categoryId, roundToOre(amount)] as const).filter(([, amount]) => amount !== 0),
    )
  }
  const spending = nets(months.flatMap((month) => month.slices))
  return {
    spending,
    savings: nets(months.map((month) => month.savings)),
    income: nets(months.map((month) => month.income)),
    total: roundToOre([...spending.values()].reduce((sum, amount) => sum + amount, 0)),
  }
}

// The Categories of a Span's trend at a granularity: those with Spending in some point, above zero or
// below it, null for Uncategorized, ordered by their Spending summed over the points, largest first,
// then Savings and Income, each when it has a figure in some point.
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
// Each Category, Savings and Income is netted over the point's months, so a refund reduces the
// Spending of its Period whichever month it lands in, and one that nets the other way is below zero.
// Total is the sum of every Category's Spending, never the Savings or Income beside it, so a refund in
// one Category lowers it, and it can fall below zero. Each value is divided by the months the point
// covers, so that partial points at the Span's edges compare with full ones.
export function trendPoints(monthly: MonthSpending[], granularity: Granularity): TrendPoint[] {
  const categories = trendCategories(monthly, granularity)
  return groupMonths(monthly, granularity).map((group) => {
    const monthsCovered = group.months.length
    const { spending, savings, income, total } = netFigures(group.months)
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
// It is measured against the size of the first figure, so positive means a larger figure even when the
// first is below zero: −300 → 900 is "▲ +400,0 %", and a figure that falls to zero is "▼ −100,0 %" from
// above it and "▲ +100,0 %" from below it. "New" when there was none at first, "–" when there was none
// at all, and no arrow or sign when the change rounds to zero.
export function formatChange(first: number, last: number): string {
  if (first === 0) return last === 0 ? '–' : 'New'
  const change = (last - first) / Math.abs(first)
  const size = percent.format(Math.abs(change))
  if (size === percent.format(0)) return size
  return change > 0 ? `▲ +${size}` : `▼ −${size}`
}
