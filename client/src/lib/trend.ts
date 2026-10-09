import type { MonthSpending } from './api'
import { periodLabel, periodOfMonth } from './period'

// One point of the trend: a stretch of the Span, labelled like the Dashboard's Periods, with its
// Spending as kr per month. Every point is one month for now.
export interface TrendPoint {
  key: string
  label: string
  total: number
}

const percent = new Intl.NumberFormat('nb-NO', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
})

// The trend's points for a Span's monthly Spending, in order.
export function trendPoints(monthly: MonthSpending[]): TrendPoint[] {
  return monthly.map((month) => ({
    key: `${month.year}-${month.month}`,
    label: periodLabel(periodOfMonth(month, 'month')),
    total: month.slices.reduce((sum, slice) => sum + slice.amount, 0),
  }))
}

// The change from the first point's monthly value to the last's, e.g. "▲ +12,3 %" or "▼ −8,0 %".
// Positive means more Spending. "New" when there was none at first, "–" when there was none at all.
export function formatChange(first: number, last: number): string {
  if (first === 0) return last === 0 ? '–' : 'New'
  if (last === 0) return '▼ −100 %'
  const change = percent.format((last - first) / first)
  if (change.startsWith('+')) return `▲ ${change}`
  if (change.startsWith('−') || change.startsWith('-')) return `▼ ${change}`
  return change
}
