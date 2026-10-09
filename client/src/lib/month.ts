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
