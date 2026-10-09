import type { MonthSpending } from './api'
import { percent } from './percent'
import { periodLabel, periodOfMonth } from './period'
import { monthValue } from './span'

// One point of the trend: a stretch of the Span, labelled like the Dashboard's Periods, with its
// Spending as NOK per month. Every point is one month for now.
export interface TrendPoint {
  key: string
  label: string
  total: number
}

// The trend's points for a Span's monthly Spending, in order.
export function trendPoints(monthly: MonthSpending[]): TrendPoint[] {
  return monthly.map((month) => ({
    key: monthValue(month),
    label: periodLabel(periodOfMonth(month, 'month')),
    total: month.slices.reduce((sum, slice) => sum + slice.amount, 0),
  }))
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
