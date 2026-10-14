import type { MonthSpending } from './api'
import { groupMonths } from './grouping'
import { percent } from './percent'
import type { Granularity, Period } from './period'

// Identifies the Total row of the trend, and its line.
export const TOTAL_ROW = 'total'

// Identifies a Category's row of the trend, and its line, or Uncategorized's when categoryId is null.
export function categoryRow(categoryId: number | null): string {
  return categoryId === null ? 'uncategorized' : String(categoryId)
}

// One point of the trend: a Period of the Span, with the Spending of Total and of each Category in the
// Span as NOK per month, keyed by row. `monthsCovered` is how many of the `monthsInPeriod` months of
// its Period fall inside the Span.
export interface TrendPoint {
  period: Period
  key: string
  label: string
  monthsCovered: number
  monthsInPeriod: number
  values: Record<string, number>
}

// The Categories with Spending somewhere in a Span, null for Uncategorized, largest Spending over
// the Span first.
export function trendCategories(monthly: MonthSpending[]): (number | null)[] {
  const sums = new Map<number | null, number>()
  for (const { slices } of monthly) {
    for (const { categoryId, amount } of slices) sums.set(categoryId, (sums.get(categoryId) ?? 0) + amount)
  }
  return [...sums].sort(([, a], [, b]) => b - a).map(([categoryId]) => categoryId)
}

// The trend's points for a Span's monthly Spending, one per Period of the granularity, in order.
// Each point has a value for Total and every Category in the Span, 0 when it had no Spending there.
// Each value is the Spending divided by the months the point covers, so that partial points at the
// Span's edges compare with full ones.
export function trendPoints(monthly: MonthSpending[], granularity: Granularity): TrendPoint[] {
  const rows = [TOTAL_ROW, ...trendCategories(monthly).map(categoryRow)]
  return groupMonths(monthly, granularity).map((group) => {
    const monthsCovered = group.months.length
    const sums: Record<string, number> = Object.fromEntries(rows.map((row) => [row, 0]))
    for (const { categoryId, amount } of group.months.flatMap((month) => month.slices)) {
      sums[categoryRow(categoryId)] += amount
      sums[TOTAL_ROW] += amount
    }
    const values = Object.fromEntries(rows.map((row) => [row, sums[row] / monthsCovered]))
    const { period, key, label, monthsInPeriod } = group
    return { period, key, label, monthsCovered, monthsInPeriod, values }
  })
}

// " (2 of 3 months)" for a point covering only part of its quarter or year, otherwise "".
export function coverageNote({ monthsCovered, monthsInPeriod }: TrendPoint): string {
  return monthsCovered < monthsInPeriod ? ` (${monthsCovered} of ${monthsInPeriod} months)` : ''
}

// The change from the first point's monthly value to the last's, e.g. "▲ +12,3 %" or "▼ −8,0 %".
// Positive means more Spending. "New" when there was none at first, "−100 %" when there is none at
// last, "–" when there was none at all, and no arrow or sign when the change rounds to zero.
export function formatChange(first: number, last: number): string {
  if (first === 0) return last === 0 ? '–' : 'New'
  if (last === 0) return '−100 %'
  const change = (last - first) / first
  const size = percent.format(Math.abs(change))
  if (size === percent.format(0)) return size
  return change > 0 ? `▲ +${size}` : `▼ −${size}`
}
