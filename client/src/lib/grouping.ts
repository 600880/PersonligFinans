import type { MonthSpending } from './api'
import { MONTHS_IN, periodLabel, periodOfMonth, periodValue, type Granularity } from './period'

// The months of a Span that one point of the trend covers: those of its Period that fall inside the
// Span. At the Span's edges that can be fewer than the `monthsInPeriod` the Period holds.
export interface MonthGroup {
  key: string
  label: string
  months: MonthSpending[]
  monthsInPeriod: number
}

// A Span's monthly Spending, in order, grouped into the trend's points: one per Period of the
// granularity, labelled like the Dashboard's Periods.
export function groupMonths(monthly: MonthSpending[], granularity: Granularity): MonthGroup[] {
  const groups: MonthGroup[] = []
  for (const month of monthly) {
    const period = periodOfMonth(month, granularity)
    const key = periodValue(period)
    const group = groups.at(-1)
    if (group?.key === key) group.months.push(month)
    else groups.push({ key, label: periodLabel(period), months: [month], monthsInPeriod: MONTHS_IN[granularity] })
  }
  return groups
}
