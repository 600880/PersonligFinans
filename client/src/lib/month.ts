import type { TransactionMonth } from './api'

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function currentMonth(): TransactionMonth {
  const today = new Date()
  return { year: today.getFullYear(), month: today.getMonth() + 1 }
}

export function sameMonth(a: TransactionMonth, b: TransactionMonth) {
  return a.year === b.year && a.month === b.month
}

// The month an ISO date, such as "2026-02-14", falls in.
export function monthOfDate(isoDate: string): TransactionMonth {
  return { year: Number(isoDate.slice(0, 4)), month: Number(isoDate.slice(5, 7)) }
}
