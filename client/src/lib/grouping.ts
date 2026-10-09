import type { MonthSpending } from './api'
import { periodLabel, periodOfMonth, periodValue } from './period'

// The calendar stretch each point of the trend covers.
type Unit = 'month' | 'quarter' | 'half-year'

// A Span of up to this many months gets a point per month, and up to the next a point per quarter.
// Longer Spans get a point per half-year.
const MONTHLY_UP_TO = 12
const QUARTERLY_UP_TO = 36

const MONTHS_IN: Record<Unit, number> = { month: 1, quarter: 3, 'half-year': 6 }

// The months of a Span that one point of the trend covers: those of its calendar month, quarter or
// half-year that fall inside the Span. At the Span's edges that can be fewer than `monthsInUnit`.
export interface MonthGroup {
  key: string
  label: string
  months: MonthSpending[]
  monthsInUnit: number
}

function unitOf(spanMonths: number): Unit {
  if (spanMonths <= MONTHLY_UP_TO) return 'month'
  if (spanMonths <= QUARTERLY_UP_TO) return 'quarter'
  return 'half-year'
}

// Identifies and labels the unit holding the month: "2026-9" and "September 2026", "2026-Q3" and
// "Q3 2026" as for the Dashboard's Periods, or "2026-H2" and "H2 2026".
function unitHolding(month: MonthSpending, unit: Unit) {
  if (unit === 'half-year') {
    const half = month.month <= 6 ? 1 : 2
    return { key: `${month.year}-H${half}`, label: `H${half} ${month.year}` }
  }
  const period = periodOfMonth(month, unit)
  return { key: periodValue(period), label: periodLabel(period) }
}

// A Span's monthly Spending, in order, grouped into the trend's points: one per month for a Span of
// 2–12 months, per calendar quarter for 13–36 months and per calendar half-year for longer ones.
export function groupMonths(monthly: MonthSpending[]): MonthGroup[] {
  const unit = unitOf(monthly.length)
  const groups: MonthGroup[] = []
  for (const month of monthly) {
    const { key, label } = unitHolding(month, unit)
    const group = groups.at(-1)
    if (group?.key === key) group.months.push(month)
    else groups.push({ key, label, months: [month], monthsInUnit: MONTHS_IN[unit] })
  }
  return groups
}
