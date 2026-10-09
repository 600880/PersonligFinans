import type { TransactionMonth } from './api'
import { MONTH_NAMES } from './month'

export type Granularity = 'year' | 'quarter' | 'month'

export const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: 'year', label: 'Year' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'month', label: 'Month' },
]

// A calendar year, a calendar quarter (Q1 = January–March) or a month.
export type Period =
  | { granularity: 'year'; year: number }
  | { granularity: 'quarter'; year: number; quarter: number }
  | { granularity: 'month'; year: number; month: number }

function quarterOf(month: number) {
  return Math.ceil(month / 3)
}

// The Period of the given granularity that contains the month.
export function periodOfMonth({ year, month }: TransactionMonth, granularity: Granularity): Period {
  switch (granularity) {
    case 'year':
      return { granularity, year }
    case 'quarter':
      return { granularity, year, quarter: quarterOf(month) }
    case 'month':
      return { granularity, year, month }
  }
}

function contains(period: Period, month: TransactionMonth) {
  return periodValue(periodOfMonth(month, period.granularity)) === periodValue(period)
}

// Identifies a Period, e.g. "2026", "2026-Q3" or "2026-9".
export function periodValue(period: Period) {
  switch (period.granularity) {
    case 'year':
      return String(period.year)
    case 'quarter':
      return `${period.year}-Q${period.quarter}`
    case 'month':
      return `${period.year}-${period.month}`
  }
}

// The Period as the Spending endpoint's query parameters.
export function periodQuery(period: Period) {
  switch (period.granularity) {
    case 'year':
      return `year=${period.year}`
    case 'quarter':
      return `year=${period.year}&quarter=${period.quarter}`
    case 'month':
      return `year=${period.year}&month=${period.month}`
  }
}

// "2026", "Q3 2026" or "September 2026".
export function periodLabel(period: Period) {
  switch (period.granularity) {
    case 'year':
      return String(period.year)
    case 'quarter':
      return `Q${period.quarter} ${period.year}`
    case 'month':
      return `${MONTH_NAMES[period.month - 1]} ${period.year}`
  }
}

// The Periods of the given granularity that contain any of the months, in the months' order.
export function periodsOfMonths(months: TransactionMonth[], granularity: Granularity): Period[] {
  const periods = new Map<string, Period>()
  for (const month of months) {
    const period = periodOfMonth(month, granularity)
    if (!periods.has(periodValue(period))) periods.set(periodValue(period), period)
  }
  return [...periods.values()]
}

// The Period of the new granularity for the one being viewed: the latest one with data inside
// it when finer, the one containing it when coarser. Both are the Period of the new granularity
// that holds the latest month with Transactions inside the current Period. `months` is newest first.
export function switchGranularity(period: Period, granularity: Granularity, months: TransactionMonth[]): Period {
  const latest = months.find((month) => contains(period, month)) ?? firstMonthOf(period)
  return periodOfMonth(latest, granularity)
}

function firstMonthOf(period: Period): TransactionMonth {
  switch (period.granularity) {
    case 'year':
      return { year: period.year, month: 1 }
    case 'quarter':
      return { year: period.year, month: 3 * (period.quarter - 1) + 1 }
    case 'month':
      return { year: period.year, month: period.month }
  }
}
