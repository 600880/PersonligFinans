import type { MonthSpending } from './api'
import { percent } from './percent'
import { periodLabel, periodOfMonth } from './period'
import { monthValue } from './span'

// Identifies the Total row of the trend, and its line.
export const TOTAL_ROW = 'total'

// Identifies a Category's row of the trend, and its line, or Uncategorized's when categoryId is null.
export function categoryRow(categoryId: number | null): string {
  return categoryId === null ? 'uncategorized' : String(categoryId)
}

// One point of the trend: a stretch of the Span, labelled like the Dashboard's Periods, with the
// Spending of Total and of each Category in the Span as NOK per month, keyed by row. Every point is
// one month for now.
export interface TrendPoint {
  key: string
  label: string
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

// The trend's points for a Span's monthly Spending, in order. Each point has a value for Total and
// every Category in the Span, 0 when it had no Spending there.
export function trendPoints(monthly: MonthSpending[]): TrendPoint[] {
  const rows = [TOTAL_ROW, ...trendCategories(monthly).map(categoryRow)]
  return monthly.map((month) => {
    const values: Record<string, number> = Object.fromEntries(rows.map((row) => [row, 0]))
    for (const { categoryId, amount } of month.slices) {
      values[categoryRow(categoryId)] += amount
      values[TOTAL_ROW] += amount
    }
    return { key: monthValue(month), label: periodLabel(periodOfMonth(month, 'month')), values }
  })
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
