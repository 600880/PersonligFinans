import type { MonthSpending } from './api'
import { groupMonths } from './grouping'
import { percent } from './percent'

// One point of the trend: a month, quarter or half-year of the Span, with its Spending as NOK per
// month. `monthsCovered` is how many of the `monthsInUnit` months of its unit fall inside the Span.
export interface TrendPoint {
  key: string
  label: string
  monthsCovered: number
  monthsInUnit: number
  total: number
}

// The trend's points for a Span's monthly Spending, in order. Each point's Spending is divided by
// the months it covers, so that partial points at the Span's edges compare with full ones.
export function trendPoints(monthly: MonthSpending[]): TrendPoint[] {
  return groupMonths(monthly).map((group) => {
    const spending = group.months
      .flatMap((month) => month.slices)
      .reduce((sum, slice) => sum + slice.amount, 0)
    return {
      key: group.key,
      label: group.label,
      monthsCovered: group.months.length,
      monthsInUnit: group.monthsInUnit,
      total: spending / group.months.length,
    }
  })
}

// " (2 of 3 months)" for a point covering only part of its quarter or half-year, otherwise "".
export function coverageNote({ monthsCovered, monthsInUnit }: TrendPoint): string {
  return monthsCovered < monthsInUnit ? ` (${monthsCovered} of ${monthsInUnit} months)` : ''
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
